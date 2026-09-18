import { KEEP_CLOUD_BACKUPS, shouldSendBackupPush } from '../../shared/backup-policy.js'
import { googleConfigured, googleUserFromCode } from './google.js'
import { applyCors, json, preflight, requireCron } from './http.js'
import { sendBackupPushes, vapidPublicKey } from './push.js'
import { requireUser, signSession } from './session.js'
import {
  backupFileName,
  ensureUser,
  listUserIds,
  loadLatestBackup,
  loadState,
  saveBackup,
  saveState,
  type PushSubscriptionJSON,
} from './store.js'

const MAX_BYTES = 4 * 1024 * 1024

function isPushSub(value: unknown): value is PushSubscriptionJSON {
  if (!value || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  const keys = rec.keys as Record<string, unknown> | undefined
  return (
    typeof rec.endpoint === 'string' &&
    rec.endpoint.startsWith('https://') &&
    Boolean(keys) &&
    typeof keys?.p256dh === 'string' &&
    typeof keys?.auth === 'string'
  )
}

export async function handleSession(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request)
  if (!googleConfigured()) {
    return json(
      request,
      { error: 'Google sign-in is not configured on the server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' },
      503,
    )
  }

  if (request.method === 'GET') {
    const user = await requireUser(request)
    if (user instanceof Response) return user
    return json(request, {
      email: user.email,
      name: user.displayName,
      lastBackupAt: user.state.lastBackupAt,
    })
  }

  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(request, { error: 'Invalid JSON.' }, 400)
  }
  const rec = body as { code?: unknown; redirectUri?: unknown }
  if (typeof rec.code !== 'string' || !rec.code || typeof rec.redirectUri !== 'string' || !rec.redirectUri) {
    return json(request, { error: 'Missing Google authorization code.' }, 400)
  }
  try {
    const profile = await googleUserFromCode(rec.code, rec.redirectUri)
    const state = await ensureUser(profile)
    const token = await signSession(profile)
    return json(request, {
      token,
      email: state.email,
      name: state.displayName,
      lastBackupAt: state.lastBackupAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return json(request, { error: message }, 401)
  }
}

export async function handleBackup(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request)
  const user = await requireUser(request)
  if (user instanceof Response) return user

  if (request.method === 'GET') {
    const download = new URL(request.url).searchParams.get('download')
    if (download === '1' || download === 'true') {
      const bytes = await loadLatestBackup(user.userId)
      if (!bytes) return json(request, { error: 'No cloud backup yet.' }, 404)
      const filename = user.state.lastBackupName ?? 'cashbook.sqlite'
      const headers = applyCors(request, new Headers())
      headers.set('Content-Type', 'application/octet-stream')
      headers.set('Content-Disposition', `attachment; filename="${filename}"`)
      headers.set('Content-Length', String(bytes.byteLength))
      return new Response(Buffer.from(bytes), { status: 200, headers })
    }
    return json(request, {
      email: user.email,
      name: user.displayName,
      lastBackupAt: user.state.lastBackupAt,
      lastBackupBytes: user.state.lastBackupBytes,
      lastBackupHash: user.state.lastBackupHash,
      lastBackupName: user.state.lastBackupName,
      lastPushAt: user.state.lastPushAt,
      subscriptionCount: user.state.subscriptions.length,
    })
  }

  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)

  const empty = request.headers.get('x-backup-empty') === '1'
  const hash = request.headers.get('x-backup-hash')
  const state = user.state

  if (empty) {
    if (state.lastBackupAt) return json(request, { result: 'needs-restore', lastBackupAt: state.lastBackupAt })
    return json(request, { result: 'empty' })
  }

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0) return json(request, { error: 'Empty file.' }, 400)
  if (bytes.byteLength > MAX_BYTES) return json(request, { error: 'Backup is larger than 4 MB.' }, 413)

  if (hash && state.lastBackupHash === hash) {
    return json(request, { result: 'skipped', lastBackupAt: state.lastBackupAt, hash })
  }

  const fileName = backupFileName()
  await saveBackup(user.userId, bytes, fileName, KEEP_CLOUD_BACKUPS)
  const next = {
    ...state,
    lastBackupAt: new Date().toISOString(),
    lastBackupBytes: bytes.byteLength,
    lastBackupHash: hash,
    lastBackupName: fileName,
  }
  await saveState(user.userId, next)
  return json(request, { result: 'uploaded', lastBackupAt: next.lastBackupAt, name: fileName, bytes: bytes.byteLength })
}

export async function handlePush(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request)

  if (request.method === 'GET') {
    const publicKey = vapidPublicKey()
    if (!publicKey) return json(request, { error: 'VAPID_PUBLIC_KEY is not set on the server.' }, 503)
    return json(request, { publicKey })
  }

  const user = await requireUser(request)
  if (user instanceof Response) return user

  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return json(request, { error: 'Method not allowed' }, 405)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(request, { error: 'Invalid JSON.' }, 400)
  }
  if (!isPushSub(body)) return json(request, { error: 'Invalid push subscription.' }, 400)

  const rest = user.state.subscriptions.filter((s) => s.endpoint !== body.endpoint)
  const subscriptions = request.method === 'DELETE' ? rest : [...rest, body]
  await saveState(user.userId, { ...user.state, subscriptions })
  return json(request, { ok: true, subscriptionCount: subscriptions.length })
}

export async function handleCron(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request)
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json(request, { error: 'Method not allowed' }, 405)
  }
  const unauthorized = requireCron(request)
  if (unauthorized) return unauthorized

  const userIds = await listUserIds()
  let sent = 0
  let skipped = 0
  for (const userId of userIds) {
    const state = await loadState(userId)
    if (!state) {
      skipped += 1
      continue
    }
    const due = shouldSendBackupPush({ lastBackupAt: state.lastBackupAt, lastPushAt: state.lastPushAt })
    if (!due || state.subscriptions.length === 0) {
      skipped += 1
      continue
    }
    const kept = await sendBackupPushes(state.subscriptions)
    await saveState(userId, { ...state, subscriptions: kept, lastPushAt: new Date().toISOString() })
    sent += 1
  }
  return json(request, { sent, skipped, users: userIds.length })
}

export async function dispatchApi(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '')
  if (path === '/api/session') return handleSession(request)
  if (path === '/api/backup') return handleBackup(request)
  if (path === '/api/push') return handlePush(request)
  if (path === '/api/cron') return handleCron(request)
  return json(request, { error: 'Not found' }, 404)
}
