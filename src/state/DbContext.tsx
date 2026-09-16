import { createContext, useContext, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { createDbClient, type DbApi } from '../db/client'
import type { DbSnapshot } from '../db/types'
import { maybeUpload, status as cloudStatus } from '../lib/cloud'
import { todayISO } from '../lib/period'
import { syncBackupPush } from '../lib/push'

type DbState = {
  api: DbApi
  ready: boolean
  error: string | null
  snapshot: DbSnapshot | null
  refresh: () => Promise<void>
}

const Ctx = createContext<DbState | null>(null)

const api = createDbClient()

export function DbProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<DbSnapshot | null>(null)

  const refresh = useCallback(async () => {
    const snap = await api.snapshot()
    setSnapshot(snap)
  }, [])

  const syncCloud = useCallback(async (snap: DbSnapshot) => {
    if (cloudStatus().state !== 'connected') return
    const bytes = await api.exportDb()
    const result = await maybeUpload(bytes, snap.wallets.length === 0)
    if (result === 'uploaded') {
      await api.markExported()
      await refresh()
    }
    await syncBackupPush()
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await api.init()
        await api.materialize(todayISO())
        if (cancelled) return
        const snap = await api.snapshot()
        if (cancelled) return
        setSnapshot(snap)
        setReady(true)
        await syncCloud(snap)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [syncCloud])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      void (async () => {
        await api.materialize(todayISO())
        const snap = await api.snapshot()
        setSnapshot(snap)
        await syncCloud(snap)
      })()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [syncCloud])

  const value = useMemo(() => ({ api, ready, error, snapshot, refresh }), [ready, error, snapshot, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDb(): DbState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDb outside provider')
  return ctx
}
