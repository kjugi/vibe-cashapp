import { KEEP_CLOUD_BACKUPS, shouldSendBackupPush } from '../../shared/backup-policy'
import { applyCors, json, preflight, requireAppToken, requireCron } from './http'
import { sendBackupPushes, vapidPublicKey } from './push'
import {
  backupFileName,
  loadLatestBackup,
  loadState,
  saveBackup,
  saveState,
  type PushSubscriptionJSON,
} from './store'

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

export async function handleBackup(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request)
  const unauthorized = requireAppToken(request)
  if (unauthorized) return unauthorized

  if (request.method === 'GET') {
    const download = new URL(request.url).searchParams.get('download')
    if (download === '1' || download === 'true') {
      const bytes = await loadLatestBackup()
      if (!bytes) return json(request, { error: 'No cloud backup yet.' }, 404)
      const state = await loadState()
      const filename = state.lastBackupName ?? 'cashbook.sqlite'
      const headers = applyCors(request, new Headers())
      headers.set('Content-Type', 'application/octet-stream')
      headers.set('Content-Disposition', `attachment; filename="${filename}"`)
      headers.set('Content-Length', String(bytes.byteLength))
      return new Response(Buffer.from(bytes), { status: 200, headers })
    }
    const state = await loadState()
    return json(request, {
      lastBackupAt: state.lastBackupAt,
      lastBackupBytes: state.lastBackupBytes,
      lastBackupHash: state.lastBackupHash,
      lastBackupName: state.lastBackupName,
      lastPushAt: state.lastPushAt,
      subscriptionCount: state.subscriptions.length,
    })
  }

  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)

  const empty = request.headers.get('x-backup-empty') === '1'
  const hash = request.headers.get('x-backup-hash')
  const state = await loadState()

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

  const name = backupFileName()
  await saveBackup(bytes, name, KEEP_CLOUD_BACKUPS)
  const next = {
    ...state,
    lastBackupAt: new Date().toISOString(),
    lastBackupBytes: bytes.byteLength,
    lastBackupHash: hash,
    lastBackupName: name,
  }
  await saveState(next)
  return json(request, { result: 'uploaded', lastBackupAt: next.lastBackupAt, name, bytes: bytes.byteLength })
}

export async function handlePush(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request)

  if (request.method === 'GET') {
    const publicKey = vapidPublicKey()
    if (!publicKey) return json(request, { error: 'VAPID_PUBLIC_KEY is not set on the server.' }, 503)
    return json(request, { publicKey })
  }

  const unauthorized = requireAppToken(request)
  if (unauthorized) return unauthorized

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

  const state = await loadState()
  const rest = state.subscriptions.filter((s) => s.endpoint !== body.endpoint)
  const subscriptions = request.method === 'DELETE' ? rest : [...rest, body]
  await saveState({ ...state, subscriptions })
  return json(request, { ok: true, subscriptionCount: subscriptions.length })
}

export async function handleCron(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(request)
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json(request, { error: 'Method not allowed' }, 405)
  }
  const unauthorized = requireCron(request)
  if (unauthorized) return unauthorized

  const state = await loadState()
  const send = shouldSendBackupPush({ lastBackupAt: state.lastBackupAt, lastPushAt: state.lastPushAt })
  if (!send) {
    return json(request, { sent: false, reason: 'not-due', lastBackupAt: state.lastBackupAt, lastPushAt: state.lastPushAt })
  }
  if (state.subscriptions.length === 0) {
    return json(request, { sent: false, reason: 'no-subscriptions', lastBackupAt: state.lastBackupAt })
  }

  const kept = await sendBackupPushes(state.subscriptions)
  const next = { ...state, subscriptions: kept, lastPushAt: new Date().toISOString() }
  await saveState(next)
  return json(request, {
    sent: true,
    lastBackupAt: state.lastBackupAt,
    lastPushAt: next.lastPushAt,
    subscriptionCount: kept.length,
  })
}

export async function dispatchApi(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/+$/, '')
  if (path === '/api/backup') return handleBackup(request)
  if (path === '/api/push') return handlePush(request)
  if (path === '/api/cron') return handleCron(request)
  return json(request, { error: 'Not found' }, 404)
}
