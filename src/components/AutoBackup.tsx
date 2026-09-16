import { useEffect, useRef } from 'react'
import { useDb } from '../state/DbContext'
import { backupIsDue, trySilentFolderBackup } from '../lib/backup'

export function AutoBackup() {
  const { api, snapshot, refresh } = useDb()
  const attempted = useRef<string | null>(null)

  useEffect(() => {
    if (!snapshot || snapshot.wallets.length === 0) return
    if (!backupIsDue(snapshot.lastExportAt, snapshot.backupInterval)) return
    const key = `${snapshot.backupInterval}|${snapshot.lastExportAt ?? 'none'}`
    if (attempted.current === key) return
    attempted.current = key
    let cancelled = false
    ;(async () => {
      try {
        const bytes = await api.exportDb()
        const name = await trySilentFolderBackup(bytes)
        if (cancelled || !name) return
        await api.markExported()
        await refresh()
      } catch {
        // Folder write is best-effort; the home banner still offers a manual export.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, snapshot, refresh])

  return null
}
