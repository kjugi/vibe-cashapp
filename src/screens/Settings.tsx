import { useEffect, useState } from 'react'
import { useDb } from '../state/DbContext'
import { go } from '../lib/route'
import { parseSpendeeCsv } from '../lib/spendee'
import { applyPwaUpdate, checkForPwaUpdate, getNeedRefresh, subscribeNeedRefresh } from '../lib/pwa'

export function SettingsScreen() {
  const { api, snapshot, refresh } = useDb()
  const [day, setDay] = useState(snapshot?.cashFlowStartDay ?? 1)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needRefresh, setNeedRefresh] = useState(() => getNeedRefresh())
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  useEffect(() => {
    if (snapshot) setDay(snapshot.cashFlowStartDay)
  }, [snapshot])

  useEffect(() => subscribeNeedRefresh(setNeedRefresh), [])

  async function checkUpdates() {
    setCheckingUpdate(true)
    setError(null)
    try {
      const ready = await checkForPwaUpdate()
      if (ready) {
        setMessage('Update ready — tap Refresh below.')
      } else {
        setMessage('You are on the latest version.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCheckingUpdate(false)
    }
  }

  async function saveDay() {
    await api.setCashFlowStartDay(day)
    await refresh()
    setMessage('Cash-flow start day saved.')
  }

  async function exportDb() {
    const bytes = await api.exportDb()
    const file = new File([bytes.buffer as ArrayBuffer], 'cashbook.sqlite', { type: 'application/octet-stream' })
    await api.markExported()
    await refresh()
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Cashbook backup' })
      return
    }
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cashbook.sqlite'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function onSqlite(file: File) {
    if (!confirm('Import replaces the working copy on this phone. Continue?')) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    await api.importSqlite(bytes)
    await refresh()
    setMessage('SQLite file imported.')
    go('/')
  }

  async function onSpendee(file: File) {
    try {
      const text = await file.text()
      const rows = parseSpendeeCsv(text)
      const result = await api.importSpendee(rows)
      await refresh()
      setMessage(`Imported ${result.created} rows (${result.unpaired} unpaired transfers).`)
      go('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const last = snapshot?.lastExportAt
    ? new Date(snapshot.lastExportAt).toLocaleString()
    : 'never'

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => go('/')}>
          ←
        </button>
        <h2>Settings</h2>
      </div>

      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          Add this page to your iPhone Home Screen. Data stays in a working copy here. Export often — Safari can
          still wipe it.
        </p>
        <div className="muted">Persistent storage: {snapshot?.persistGranted ? 'granted' : 'not granted'}</div>
        <div className="muted">Last export: {last}</div>
      </div>

      <div className="card stack">
        <label className="field">
          <span>Cash-flow month starts on day</span>
          <input type="number" min={1} max={28} value={day} onChange={(e) => setDay(Number(e.target.value))} />
        </label>
        <button className="primary" type="button" onClick={() => void saveDay()}>
          Save start day
        </button>
      </div>

      <div className="card stack">
        <button className="primary" type="button" onClick={() => go('/categories')}>
          Categories
        </button>
        <button className="primary" type="button" onClick={() => go('/schedules')}>
          Scheduled transactions
        </button>
      </div>

      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          After a deploy, the app can keep serving a cached build until you refresh.
        </p>
        <button className="primary" type="button" disabled={checkingUpdate} onClick={() => void checkUpdates()}>
          {checkingUpdate ? 'Checking…' : 'Check for updates'}
        </button>
        {needRefresh && (
          <button className="primary" type="button" onClick={() => void applyPwaUpdate()}>
            Refresh to latest version
          </button>
        )}
      </div>

      <div className="card stack">
        <button className="primary" type="button" onClick={() => void exportDb()}>
          Export SQLite backup
        </button>
        <label className="field">
          <span>Import SQLite (replaces working copy)</span>
          <input
            type="file"
            accept=".sqlite,.db,application/octet-stream"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onSqlite(file)
              e.target.value = ''
            }}
          />
        </label>
        <label className="field">
          <span>Import Spendee CSV (one full export)</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onSpendee(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {message && <div className="banner">{message}</div>}
      {error && <div className="error">{error}</div>}
    </div>
  )
}
