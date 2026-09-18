/** Cloud copy is stale enough that the weekly “time to backup” push may fire. */
export const STALE_AFTER_MS = 5 * 24 * 60 * 60 * 1000

/** Do not send another push for at least a week after the last one. */
export const PUSH_EVERY_MS = 7 * 24 * 60 * 60 * 1000

export const KEEP_CLOUD_BACKUPS = 8

export function isBackupStale(lastBackupAt: string | null, now = Date.now()): boolean {
  if (!lastBackupAt) return true
  const parsed = Date.parse(lastBackupAt)
  if (Number.isNaN(parsed)) return true
  return now - parsed > STALE_AFTER_MS
}

export function shouldSendBackupPush(opts: {
  lastBackupAt: string | null
  lastPushAt: string | null
  now?: number
}): boolean {
  const now = opts.now ?? Date.now()
  if (!isBackupStale(opts.lastBackupAt, now)) return false
  if (!opts.lastPushAt) return true
  const parsed = Date.parse(opts.lastPushAt)
  if (Number.isNaN(parsed)) return true
  return now - parsed >= PUSH_EVERY_MS
}
