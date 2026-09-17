export type PushSubscriptionJSON = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

export type CloudState = {
  googleSub: string
  email: string | null
  displayName: string | null
  lastBackupAt: string | null
  lastBackupBytes: number | null
  lastBackupHash: string | null
  lastBackupName: string | null
  lastPushAt: string | null
  subscriptions: PushSubscriptionJSON[]
}

export type GoogleProfile = {
  sub: string
  email: string | null
  name: string
}

type UserSlot = {
  state: CloudState
  latest: Uint8Array | null
  backups: Map<string, Uint8Array>
}

const memory = new Map<string, UserSlot>()

export function emptyState(profile: GoogleProfile): CloudState {
  return {
    googleSub: profile.sub,
    email: profile.email,
    displayName: profile.name,
    lastBackupAt: null,
    lastBackupBytes: null,
    lastBackupHash: null,
    lastBackupName: null,
    lastPushAt: null,
    subscriptions: [],
  }
}

function blobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)
}

function paths(userId: string) {
  const root = `cashbook/users/${userId}`
  return {
    state: `${root}/state.json`,
    latest: `${root}/latest.sqlite`,
    backups: `${root}/backups/`,
  }
}

export function backupFileName(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `cashbook-${y}-${m}-${d}-${hh}${mm}${ss}.sqlite`
}

async function blobPut(pathname: string, body: Buffer | string) {
  const { put } = await import('@vercel/blob')
  return put(pathname, body, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  })
}

async function blobGet(pathname: string): Promise<{ bytes: Uint8Array } | null> {
  const { get, BlobNotFoundError } = await import('@vercel/blob')
  try {
    const result = await get(pathname, { access: 'private', useCache: false })
    if (!result?.stream) return null
    const buffer = Buffer.from(await new Response(result.stream).arrayBuffer())
    return { bytes: new Uint8Array(buffer) }
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null
    const message = err instanceof Error ? err.message : String(err)
    if (/not found|404/i.test(message)) return null
    throw err
  }
}

async function blobList(prefix: string): Promise<string[]> {
  const { list } = await import('@vercel/blob')
  const listed = await list({ prefix })
  return listed.blobs.map((b) => b.pathname).sort()
}

async function blobDel(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) return
  const { del } = await import('@vercel/blob')
  await del(pathnames)
}

function parseState(bytes: Uint8Array, fallback: GoogleProfile): CloudState {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CloudState>
    return {
      ...emptyState(fallback),
      ...parsed,
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
    }
  } catch {
    return emptyState(fallback)
  }
}

export async function loadState(userId: string): Promise<CloudState | null> {
  if (!blobConfigured()) return memory.get(userId)?.state ?? null
  const found = await blobGet(paths(userId).state)
  if (!found) return null
  return parseState(found.bytes, { sub: userId, email: null, name: 'Google user' })
}

export async function saveState(userId: string, state: CloudState): Promise<void> {
  if (!blobConfigured()) {
    const slot = memory.get(userId) ?? { state: emptyState({ sub: userId, email: null, name: 'Google user' }), latest: null, backups: new Map() }
    slot.state = state
    memory.set(userId, slot)
    return
  }
  await blobPut(paths(userId).state, JSON.stringify(state))
}

export async function ensureUser(profile: GoogleProfile): Promise<CloudState> {
  const existing = await loadState(profile.sub)
  if (existing) {
    const next = {
      ...existing,
      email: profile.email ?? existing.email,
      displayName: profile.name || existing.displayName,
    }
    if (next.email !== existing.email || next.displayName !== existing.displayName) {
      await saveState(profile.sub, next)
    }
    return next
  }
  const state = emptyState(profile)
  await saveState(profile.sub, state)
  return state
}

export async function saveBackup(userId: string, bytes: Uint8Array, name: string, keep: number): Promise<void> {
  const { latest, backups } = paths(userId)
  if (!blobConfigured()) {
    const slot = memory.get(userId) ?? {
      state: emptyState({ sub: userId, email: null, name: 'Google user' }),
      latest: null,
      backups: new Map(),
    }
    slot.latest = bytes
    slot.backups.set(`${backups}${name}`, bytes)
    const names = [...slot.backups.keys()].sort()
    const extra = names.slice(0, Math.max(0, names.length - keep))
    for (const path of extra) slot.backups.delete(path)
    memory.set(userId, slot)
    return
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  await blobPut(latest, buffer)
  await blobPut(`${backups}${name}`, buffer)
  const names = (await blobList(backups)).filter((p) => p !== latest)
  const extra = names.slice(0, Math.max(0, names.length - keep))
  await blobDel(extra)
}

export async function loadLatestBackup(userId: string): Promise<Uint8Array | null> {
  if (!blobConfigured()) return memory.get(userId)?.latest ?? null
  const found = await blobGet(paths(userId).latest)
  return found?.bytes ?? null
}

export async function listUserIds(): Promise<string[]> {
  if (!blobConfigured()) return [...memory.keys()].sort()
  const pathnames = await blobList('cashbook/users/')
  const ids = new Set<string>()
  for (const pathname of pathnames) {
    const match = pathname.match(/^cashbook\/users\/([^/]+)\//)
    if (match?.[1]) ids.add(match[1])
  }
  return [...ids].sort()
}
