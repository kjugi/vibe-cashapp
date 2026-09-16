const STORAGE_KEY = 'cashbook.dropbox.v1'
const PKCE_KEY = 'cashbook.dropbox.pkce'
const REMOTE_PATH = '/cashbook.sqlite'
const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const API_URL = 'https://api.dropboxapi.com/2'
const CONTENT_URL = 'https://content.dropboxapi.com/2'

export type CloudStatus =
  | { state: 'unavailable' }
  | { state: 'disconnected'; error: string | null }
  | {
      state: 'connected'
      lastUploadAt: string | null
      error: string | null
      needsRestore: boolean
    }

export type UploadResult = 'uploaded' | 'skipped' | 'needs-restore' | 'offline' | 'failed'

type Stored = {
  refreshToken: string
  accessToken: string
  accessExpiresAt: number
  lastUploadAt: string | null
  lastHash: string | null
  error: string | null
  needsRestore: boolean
}

type PkcePending = { verifier: string; state: string }

const listeners = new Set<() => void>()
let cachedStatus: CloudStatus | null = null
let uploadLock: Promise<UploadResult> | null = null

function clientId(): string {
  return import.meta.env.VITE_DROPBOX_CLIENT_ID?.trim() ?? ''
}

export function redirectUri(): string {
  const base = import.meta.env.BASE_URL || '/'
  const path = base.endsWith('/') ? base : `${base}/`
  return `${location.origin}${path}`
}

function b64url(bytes: Uint8Array): string {
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomUrlSafe(byteCount: number): string {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return b64url(bytes)
}

async function sha256Bytes(data: BufferSource): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data))
}

async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = await sha256Bytes(bytes as BufferSource)
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (!parsed.refreshToken) return null
    return parsed
  } catch {
    return null
  }
}

function saveStored(next: Stored | null): void {
  if (!next) localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  cachedStatus = null
  emit()
}

function patchStored(partial: Partial<Stored>): Stored | null {
  const cur = loadStored()
  if (!cur) return null
  const next = { ...cur, ...partial }
  saveStored(next)
  return next
}

function loadPkce(): PkcePending | null {
  try {
    const raw = sessionStorage.getItem(PKCE_KEY) ?? localStorage.getItem(PKCE_KEY)
    return raw ? (JSON.parse(raw) as PkcePending) : null
  } catch {
    return null
  }
}

function savePkce(pending: PkcePending | null): void {
  if (!pending) {
    sessionStorage.removeItem(PKCE_KEY)
    localStorage.removeItem(PKCE_KEY)
    return
  }
  const raw = JSON.stringify(pending)
  sessionStorage.setItem(PKCE_KEY, raw)
  localStorage.setItem(PKCE_KEY, raw)
}

function connectError(): string | null {
  try {
    return sessionStorage.getItem(`${PKCE_KEY}.error`)
  } catch {
    return null
  }
}

function setConnectError(message: string | null): void {
  try {
    if (message) sessionStorage.setItem(`${PKCE_KEY}.error`, message)
    else sessionStorage.removeItem(`${PKCE_KEY}.error`)
  } catch {
    /* ignore quota */
  }
  cachedStatus = null
  emit()
}

function readStatus(): CloudStatus {
  if (!clientId()) return { state: 'unavailable' }
  const stored = loadStored()
  if (!stored) return { state: 'disconnected', error: connectError() }
  return {
    state: 'connected',
    lastUploadAt: stored.lastUploadAt,
    error: stored.error,
    needsRestore: stored.needsRestore,
  }
}

function emit(): void {
  cachedStatus = readStatus()
  for (const fn of listeners) fn()
}

export function subscribeCloud(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function status(): CloudStatus {
  if (!cachedStatus) cachedStatus = readStatus()
  return cachedStatus
}

function stripOAuthParams(): void {
  const url = new URL(location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  url.searchParams.delete('error')
  url.searchParams.delete('error_description')
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

async function tokenRequest(body: Record<string, string>): Promise<{
  access_token: string
  refresh_token?: string
  expires_in: number
}> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, client_id: clientId() }),
  })
  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (!res.ok || !json.access_token || json.expires_in == null) {
    throw new Error(json.error_description || json.error || `Dropbox token HTTP ${res.status}`)
  }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: json.expires_in,
  }
}

async function ensureAccessToken(): Promise<string> {
  const stored = loadStored()
  if (!stored) throw new Error('Dropbox is not connected.')
  if (stored.accessToken && stored.accessExpiresAt > Date.now() + 15_000) return stored.accessToken
  const tokens = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
  })
  const next: Stored = {
    ...stored,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? stored.refreshToken,
    accessExpiresAt: Date.now() + tokens.expires_in * 1000,
    error: null,
  }
  saveStored(next)
  return next.accessToken
}

async function dropboxFetch(url: string, init: RequestInit, retry = true): Promise<Response> {
  const token = await ensureAccessToken()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(url, { ...init, headers })
  if (res.status === 401 && retry) {
    const stored = loadStored()
    if (stored) {
      saveStored({ ...stored, accessExpiresAt: 0, accessToken: '' })
      return dropboxFetch(url, init, false)
    }
  }
  return res
}

async function dropboxJson<T>(url: string, body: unknown): Promise<{ ok: true; value: T } | { ok: false; status: number; tag?: string; text: string }> {
  const res = await dropboxFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    let tag: string | undefined
    try {
      const parsed = JSON.parse(text) as { error?: { '.tag'?: string }; error_summary?: string }
      tag = parsed.error?.['.tag'] ?? parsed.error_summary
    } catch {
      /* keep text */
    }
    return { ok: false, status: res.status, tag, text }
  }
  return { ok: true, value: (text ? JSON.parse(text) : null) as T }
}

function authErrorMessage(res: Response, text: string): string {
  if (res.status === 401) return 'Dropbox needs sign-in again.'
  try {
    const parsed = JSON.parse(text) as { error_summary?: string; error?: { '.tag'?: string } }
    return parsed.error_summary || parsed.error?.['.tag'] || `Dropbox HTTP ${res.status}`
  } catch {
    return text || `Dropbox HTTP ${res.status}`
  }
}

async function remoteExists(): Promise<boolean> {
  const result = await dropboxJson<{ '.tag'?: string }>(`${API_URL}/files/get_metadata`, {
    path: REMOTE_PATH,
  })
  if (result.ok) return true
  if (result.status === 409 && (result.tag === 'path' || /not_found/i.test(result.text))) return false
  throw new Error(result.text || `Dropbox metadata HTTP ${result.status}`)
}

async function putFile(bytes: Uint8Array): Promise<void> {
  const arg = JSON.stringify({ path: REMOTE_PATH, mode: 'overwrite', autorename: false, mute: true })
  const res = await dropboxFetch(`${CONTENT_URL}/files/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': arg,
    },
    body: new Blob([bytes as BlobPart]),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(authErrorMessage(res, text))
  }
}

export async function connect(): Promise<void> {
  if (!clientId()) throw new Error('Dropbox is not configured in this build.')
  setConnectError(null)
  const verifier = randomUrlSafe(32)
  const state = randomUrlSafe(16)
  savePkce({ verifier, state })
  const digest = await sha256Bytes(new TextEncoder().encode(verifier))
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    token_access_type: 'offline',
    code_challenge: b64url(digest),
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
    state,
  })
  location.assign(`${AUTH_URL}?${params}`)
}

export async function handleRedirect(): Promise<boolean> {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const state = params.get('state')
  const oauthError = params.get('error')
  if (!code && !oauthError) return false

  const pending = loadPkce()
  savePkce(null)
  stripOAuthParams()

  if (oauthError) {
    const message = params.get('error_description') || oauthError
    const stored = loadStored()
    if (stored) patchStored({ error: message })
    else setConnectError(message)
    return false
  }

  if (!code) return false

  if (!pending || pending.state !== state) {
    const err =
      'Dropbox sign-in did not return to this app. On iPhone, connect from the Home Screen icon, not a Safari tab.'
    const stored = loadStored()
    if (stored) patchStored({ error: err })
    else setConnectError(err)
    return false
  }

  try {
    const tokens = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: pending.verifier,
      redirect_uri: redirectUri(),
    })
    if (!tokens.refresh_token) throw new Error('Dropbox did not return a refresh token.')
    setConnectError(null)
    saveStored({
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessExpiresAt: Date.now() + tokens.expires_in * 1000,
      lastUploadAt: loadStored()?.lastUploadAt ?? null,
      lastHash: loadStored()?.lastHash ?? null,
      error: null,
      needsRestore: false,
    })
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stored = loadStored()
    if (stored) patchStored({ error: message })
    else setConnectError(message)
    return false
  }
}

export async function disconnect(): Promise<void> {
  const stored = loadStored()
  if (stored?.accessToken) {
    try {
      await fetch(`${API_URL}/auth/token/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${stored.accessToken}` },
      })
    } catch {
      /* still clear local tokens */
    }
  }
  savePkce(null)
  setConnectError(null)
  saveStored(null)
}

export async function maybeUpload(
  bytes: Uint8Array,
  empty: boolean,
  opts: { force?: boolean } = {},
): Promise<UploadResult> {
  if (uploadLock) return uploadLock
  const run = runUpload(bytes, empty, opts.force === true)
  uploadLock = run
  try {
    return await run
  } finally {
    uploadLock = null
  }
}

async function runUpload(bytes: Uint8Array, empty: boolean, force: boolean): Promise<UploadResult> {
  if (status().state !== 'connected') return 'skipped'
  if (!navigator.onLine) return 'offline'
  const stored = loadStored()
  if (!stored) return 'skipped'

  try {
    const hash = await contentHash(bytes)
    if (!force && stored.needsRestore) return 'needs-restore'

    if (!force && stored.lastHash === hash) {
      patchStored({ error: null, needsRestore: false })
      return 'skipped'
    }

    if (empty) {
      const exists = await remoteExists()
      if (exists) {
        patchStored({ needsRestore: true, error: null })
        return 'needs-restore'
      }
      return 'skipped'
    }

    await putFile(bytes)
    patchStored({
      lastHash: hash,
      lastUploadAt: new Date().toISOString(),
      error: null,
      needsRestore: false,
    })
    return 'uploaded'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('sign-in again') || message.includes('invalid_grant')) {
      saveStored(null)
      setConnectError(message)
    } else {
      patchStored({ error: message })
    }
    return 'failed'
  }
}

export async function download(): Promise<Uint8Array> {
  const res = await dropboxFetch(`${CONTENT_URL}/files/download`, {
    method: 'POST',
    headers: {
      'Dropbox-API-Arg': JSON.stringify({ path: REMOTE_PATH }),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(authErrorMessage(res, text))
  }
  return new Uint8Array(await res.arrayBuffer())
}

export async function markRestored(bytes: Uint8Array): Promise<void> {
  const hash = await contentHash(bytes)
  patchStored({
    lastHash: hash,
    lastUploadAt: new Date().toISOString(),
    needsRestore: false,
    error: null,
  })
}

export function clearNeedsRestore(): void {
  patchStored({ needsRestore: false })
}
