export type PushSubscriptionJSON = {
  endpoint: string
  expirationTime?: number | null
  keys: { p256dh: string; auth: string }
}

export type CloudState = {
  lastBackupAt: string | null
  lastBackupBytes: number | null
  lastBackupHash: string | null
  lastBackupName: string | null
  lastPushAt: string | null
  subscriptions: PushSubscriptionJSON[]
}

const STATE_PATH = 'cashbook/state.json'
const LATEST_PATH = 'cashbook/latest.sqlite'
const BACKUP_PREFIX = 'cashbook/backups/'

type Memory = {
  state: CloudState
  latest: Uint8Array | null
  backups: Map<string, Uint8Array>
}

const memory: Memory = {
  state: emptyState(),
  latest: null,
  backups: new Map(),
}

export function emptyState(): CloudState {
  return {
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

export async function loadState(): Promise<CloudState> {
  if (!blobConfigured()) return memory.state
  const found = await blobGet(STATE_PATH)
  if (!found) return emptyState()
  try {
    const parsed = JSON.parse(new TextDecoder().decode(found.bytes)) as Partial<CloudState>
    return {
      ...emptyState(),
      ...parsed,
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
    }
  } catch {
    return emptyState()
  }
}

export async function saveState(state: CloudState): Promise<void> {
  if (!blobConfigured()) {
    memory.state = state
    return
  }
  await blobPut(STATE_PATH, JSON.stringify(state))
}

export async function saveBackup(bytes: Uint8Array, name: string, keep: number): Promise<void> {
  if (!blobConfigured()) {
    memory.latest = bytes
    memory.backups.set(`${BACKUP_PREFIX}${name}`, bytes)
    const names = [...memory.backups.keys()].sort()
    const extra = names.slice(0, Math.max(0, names.length - keep))
    for (const path of extra) memory.backups.delete(path)
    return
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  await blobPut(LATEST_PATH, buffer)
  await blobPut(`${BACKUP_PREFIX}${name}`, buffer)
  const names = (await blobList(BACKUP_PREFIX)).filter((p) => p !== LATEST_PATH)
  const extra = names.slice(0, Math.max(0, names.length - keep))
  await blobDel(extra)
}

export async function loadLatestBackup(): Promise<Uint8Array | null> {
  if (!blobConfigured()) return memory.latest
  const found = await blobGet(LATEST_PATH)
  return found?.bytes ?? null
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
