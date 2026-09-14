import { createContext, useContext, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { createDbClient, type DbApi } from '../db/client'
import type { DbSnapshot } from '../db/types'
import { todayISO } from '../lib/period'

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

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await api.init()
        await api.materialize(todayISO())
        if (cancelled) return
        await refresh()
        setReady(true)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void api.materialize(todayISO()).then(refresh)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refresh])

  const value = useMemo(() => ({ api, ready, error, snapshot, refresh }), [ready, error, snapshot, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDb(): DbState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDb outside provider')
  return ctx
}
