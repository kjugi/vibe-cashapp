const STORAGE_KEY = 'cashbook.cloud.v1'

export type UploadResult = 'uploaded' | 'skipped' | 'empty' | 'needs-restore' | 'offline' | 'failed'

export type CloudStatus =
  | { state: 'disconnected'; error: string | null }
  | {
      state: 'connected'
      lastUploadAt: string | null
      lastHash: string | null
      error: string | null
      needsRestore: boolean
      pushEnabled: boolean
    }

type Stored = {
  token: string
  disabled?: boolean
  lastUploadAt: string | null
  lastHash: string | null
  error: string | null
  needsRestore: boolean
  pushEnabled: boolean
}

type RemoteStatus = {
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

function envToken(): string {
  return import.meta.env.VITE_CASHBOOK_TOKEN?.trim() ?? ''
}

function apiBase(): string {
  return (import.meta.env.VITE_API_URL?.trim() ?? '').replace(/\/+$/, '')
}

export function cloudApiUrl(path: string): string {
  return `${apiBase()}${path}`
}

export function hasEnvToken(): boolean {
  return Boolean(envToken())
}

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Stored
      if (parsed.disabled) return null
      if (parsed.token) return parsed
    }
  } catch {
    /* ignore */
  }
  const token = envToken()
  if (!token) return null
  return {
    token,
    lastUploadAt: null,
    lastHash: null,
    error: connectError(),
    needsRestore: false,
    pushEnabled: false,
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

function readStatus(): CloudStatus {
  const stored = loadStored()
  if (!stored) return { state: 'disconnected', error: connectError() }
  return {
    state: 'connected',
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

export async function connect(token?: string): Promise<void> {
  const nextToken = (token ?? loadStored()?.token ?? envToken()).trim()
  if (!nextToken) throw new Error('Paste the CASHBOOK_TOKEN from the Vercel project.')
  setConnectError(null)
  saveStored({
    token: nextToken,
    lastUploadAt: loadStored()?.lastUploadAt ?? null,
    lastHash: loadStored()?.lastHash ?? null,
    error: null,
    needsRestore: false,
    pushEnabled: loadStored()?.pushEnabled ?? false,
  })
  const res = await apiFetch('/api/backup')
  if (!res.ok) {
    const message = await readError(res)
    saveStored({
      token: '',
      disabled: true,
      lastUploadAt: null,
      lastHash: null,
      error: null,
      needsRestore: false,
      pushEnabled: false,
    })
    setConnectError(message)
    throw new Error(message)
  }
  const remote = (await res.json()) as RemoteStatus
  patchStored({
    error: null,
    lastUploadAt: remote.lastBackupAt,
    lastHash: remote.lastBackupHash,
    needsRestore: false,
  })
}

export async function disconnect(): Promise<void> {
  setConnectError(null)
  saveStored({
    token: '',
    disabled: true,
    lastUploadAt: null,
    lastHash: null,
    error: null,
    needsRestore: false,
    pushEnabled: false,
  })
}

export function authHeaders(jsonBody = false): Headers {
  const stored = loadStored()
  if (!stored?.token) throw new Error('Connect cloud backup first.')
  const headers = new Headers()
  if (jsonBody) headers.set('Content-Type', 'application/json')
  headers.set('Authorization', `Bearer ${stored.token}`)
  return headers
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
      saveStored({
        token: '',
        disabled: true,
        lastUploadAt: null,
        lastHash: null,
        error: null,
        needsRestore: false,
        pushEnabled: false,
      })
      setConnectError('Token was rejected. Connect again.')
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
      patchStored({ error: null, lastHash: hash, lastUploadAt: payload.lastBackupAt ?? stored.lastUploadAt, needsRestore: false })
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
