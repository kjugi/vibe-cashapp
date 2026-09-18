const STORAGE_KEY = 'cashbook.cloud.v2'
const OAUTH_STATE_KEY = 'cashbook.google.state'

export type UploadResult = 'uploaded' | 'skipped' | 'empty' | 'needs-restore' | 'offline' | 'failed'

export type CloudStatus =
  | { state: 'unavailable' }
  | { state: 'disconnected'; error: string | null }
  | {
      state: 'connected'
      email: string | null
      displayName: string | null
      lastUploadAt: string | null
      lastHash: string | null
      error: string | null
      needsRestore: boolean
      pushEnabled: boolean
    }

type Stored = {
  token: string
  email: string | null
  displayName: string | null
  lastUploadAt: string | null
  lastHash: string | null
  error: string | null
  needsRestore: boolean
  pushEnabled: boolean
}

type RemoteStatus = {
  email?: string | null
  name?: string | null
  lastBackupAt: string | null
  lastBackupHash: string | null
  lastBackupName: string | null
  lastBackupBytes: number | null
  lastPushAt: string | null
  subscriptionCount: number
}

const listeners = new Set<() => void>()
let cachedStatus: CloudStatus | null = null
let uploadLock: Promise<UploadResult> | null = null

function apiBase(): string {
  return (import.meta.env.VITE_API_URL?.trim() ?? '').replace(/\/+$/, '')
}

export function cloudApiUrl(path: string): string {
  return `${apiBase()}${path}`
}

export function googleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? ''
}

export function googleConfigured(): boolean {
  return Boolean(googleClientId())
}

export function redirectUri(): string {
  const base = import.meta.env.BASE_URL || '/'
  const path = base.endsWith('/') ? base : `${base}/`
  return `${location.origin}${path}`
}

function randomState(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (!parsed.token) return null
    return parsed
  } catch {
    return null
  }
}

function saveStored(next: Stored | null): void {
  try {
    if (!next) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* quota */
  }
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

function emit(): void {
  cachedStatus = readStatus()
  for (const fn of listeners) fn()
}

function connectError(): string | null {
  try {
    return sessionStorage.getItem(`${STORAGE_KEY}.error`)
  } catch {
    return null
  }
}

function setConnectError(message: string | null): void {
  try {
    if (message) sessionStorage.setItem(`${STORAGE_KEY}.error`, message)
    else sessionStorage.removeItem(`${STORAGE_KEY}.error`)
  } catch {
    /* ignore */
  }
  cachedStatus = null
  emit()
}

function saveOauthState(state: string | null): void {
  try {
    if (!state) {
      sessionStorage.removeItem(OAUTH_STATE_KEY)
      localStorage.removeItem(OAUTH_STATE_KEY)
      return
    }
    sessionStorage.setItem(OAUTH_STATE_KEY, state)
    localStorage.setItem(OAUTH_STATE_KEY, state)
  } catch {
    /* ignore */
  }
}

function loadOauthState(): string | null {
  try {
    return sessionStorage.getItem(OAUTH_STATE_KEY) ?? localStorage.getItem(OAUTH_STATE_KEY)
  } catch {
    return null
  }
}

function readStatus(): CloudStatus {
  if (!googleConfigured()) return { state: 'unavailable' }
  const stored = loadStored()
  if (!stored) return { state: 'disconnected', error: connectError() }
  return {
    state: 'connected',
    email: stored.email,
    displayName: stored.displayName,
    lastUploadAt: stored.lastUploadAt,
    lastHash: stored.lastHash,
    error: stored.error,
    needsRestore: stored.needsRestore,
    pushEnabled: stored.pushEnabled,
  }
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const stored = loadStored()
  const headers = new Headers(init.headers)
  if (stored?.token) headers.set('Authorization', `Bearer ${stored.token}`)
  return fetch(cloudApiUrl(path), { ...init, headers })
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) return body.error
  } catch {
    /* text fallback */
  }
  try {
    const text = await res.text()
    if (text) return text
  } catch {
    /* ignore */
  }
  return `Server HTTP ${res.status}`
}

function stripOAuthParams(): void {
  const url = new URL(location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  url.searchParams.delete('scope')
  url.searchParams.delete('authuser')
  url.searchParams.delete('prompt')
  url.searchParams.delete('hd')
  url.searchParams.delete('error')
  url.searchParams.delete('error_description')
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

export function startGoogleSignIn(): void {
  const clientId = googleClientId()
  if (!clientId) throw new Error('Google sign-in is not configured in this build.')
  setConnectError(null)
  const state = randomState()
  saveOauthState(state)
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
    access_type: 'online',
  })
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}

export async function handleGoogleRedirect(opts: { empty?: boolean } = {}): Promise<boolean> {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const state = params.get('state')
  const oauthError = params.get('error')
  if (!code && !oauthError) return false

  const pending = loadOauthState()
  saveOauthState(null)
  stripOAuthParams()

  if (oauthError) {
    const message = params.get('error_description') || oauthError
    setConnectError(message)
    return false
  }

  if (!code) return false

  if (!pending || pending !== state) {
    setConnectError(
      'Google sign-in did not return to this app. On iPhone, connect from the Home Screen icon, not a Safari tab.',
    )
    return false
  }

  try {
    const res = await fetch(cloudApiUrl('/api/session'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri: redirectUri() }),
    })
    if (!res.ok) throw new Error(await readError(res))
    const payload = (await res.json()) as {
      token?: string
      email?: string | null
      name?: string | null
      lastBackupAt?: string | null
    }
    if (!payload.token) throw new Error('Server did not return a session.')
    setConnectError(null)
    saveStored({
      token: payload.token,
      email: payload.email ?? null,
      displayName: payload.name ?? null,
      lastUploadAt: payload.lastBackupAt ?? null,
      lastHash: null,
      error: null,
      needsRestore: Boolean(opts.empty && payload.lastBackupAt),
      pushEnabled: loadStored()?.pushEnabled ?? false,
    })
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setConnectError(message)
    saveStored(null)
    return false
  }
}

export async function disconnect(): Promise<void> {
  setConnectError(null)
  saveStored(null)
}

export function authHeaders(jsonBody = false): Headers {
  const stored = loadStored()
  if (!stored?.token) throw new Error('Sign in with Google first.')
  const headers = new Headers()
  if (jsonBody) headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${stored.token}`)
  return headers
}

function signOutOnAuthFailure(): void {
  saveStored(null)
  setConnectError('Session expired. Sign in with Google again.')
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
    const hash = await sha256Hex(bytes)
    if (!force && stored.needsRestore) return 'needs-restore'
    if (!force && stored.lastHash === hash) {
      patchStored({ error: null })
      return 'skipped'
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-Backup-Hash': hash,
    }
    if (empty) headers['X-Backup-Empty'] = '1'

    const res = await apiFetch('/api/backup', {
      method: 'POST',
      headers,
      body: empty ? undefined : new Blob([bytes as BlobPart]),
    })
    if (res.status === 401) {
      signOutOnAuthFailure()
      return 'failed'
    }
    if (!res.ok) {
      const message = await readError(res)
      patchStored({ error: message })
      return 'failed'
    }
    const payload = (await res.json()) as {
      result?: UploadResult | 'uploaded'
      lastBackupAt?: string | null
    }
    if (payload.result === 'needs-restore') {
      patchStored({ needsRestore: true, error: null, lastUploadAt: payload.lastBackupAt ?? stored.lastUploadAt })
      return 'needs-restore'
    }
    if (payload.result === 'empty') return 'empty'
    if (payload.result === 'skipped') {
      patchStored({
        error: null,
        lastHash: hash,
        lastUploadAt: payload.lastBackupAt ?? stored.lastUploadAt,
        needsRestore: false,
      })
      return 'skipped'
    }
    patchStored({
      error: null,
      lastHash: hash,
      lastUploadAt: payload.lastBackupAt ?? new Date().toISOString(),
      needsRestore: false,
    })
    return 'uploaded'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    patchStored({ error: message })
    return 'failed'
  }
}

export async function download(): Promise<Uint8Array> {
  const res = await apiFetch('/api/backup?download=1')
  if (res.status === 401) {
    signOutOnAuthFailure()
    throw new Error('Session expired. Sign in with Google again.')
  }
  if (!res.ok) throw new Error(await readError(res))
  return new Uint8Array(await res.arrayBuffer())
}

export async function markRestored(bytes: Uint8Array): Promise<void> {
  const hash = await sha256Hex(bytes)
  patchStored({
    lastHash: hash,
    lastUploadAt: new Date().toISOString(),
    needsRestore: false,
    error: null,
  })
}

export function setPushEnabled(enabled: boolean): void {
  patchStored({ pushEnabled: enabled })
}

export type { RemoteStatus }
