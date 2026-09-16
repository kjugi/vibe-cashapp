import { useEffect, useState } from 'react'
import { useDb } from '../state/DbContext'
import { useCloudBackup } from '../state/useCloudBackup'
import { go } from '../lib/route'
import { parseSpendeeCsv } from '../lib/spendee'
import { applyPwaUpdate, checkForPwaUpdate, getNeedRefresh, subscribeNeedRefresh } from '../lib/pwa'
import {
  chooseBackupFolder,
  disconnectBackupFolder,
  getFolderBackupStatus,
  offerBackupFile,
  writeBackupToFolder,
  type FolderBackupStatus,
} from '../lib/backup'
import {
  connect,
  disconnect,
  download,
  markRestored,
  maybeUpload,
  redirectUri,
  status as cloudStatus,
} from '../lib/dropboxBackup'
import type { BackupInterval } from '../db/types'

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export function SettingsScreen() {
  const { api, snapshot, refresh } = useDb()
  const cloud = useCloudBackup()
  const [day, setDay] = useState(snapshot?.cashFlowStartDay ?? 1)
  const [reminder, setReminder] = useState<BackupInterval>(snapshot?.backupInterval ?? 'weekly')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needRefresh, setNeedRefresh] = useState(() => getNeedRefresh())
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [folderBusy, setFolderBusy] = useState(false)
  const [folder, setFolder] = useState<FolderBackupStatus>({ supported: false })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (snapshot) {
      setDay(snapshot.cashFlowStartDay)
      setReminder(snapshot.backupInterval)
    }
  }, [snapshot])

  useEffect(() => subscribeNeedRefresh(setNeedRefresh), [])

  useEffect(() => {
    void getFolderBackupStatus().then(setFolder)
  }, [])

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

  async function saveReminder(next: BackupInterval) {
    setReminder(next)
    await api.setBackupInterval(next)
    await refresh()
    setMessage(
      next === 'off'
        ? 'Automatic backup reminder turned off.'
        : next === 'weekly'
          ? 'You will be asked to backup once a week.'
          : 'You will be asked to backup about once a month.',
    )
  }

  async function exportDb() {
    setError(null)
    try {
      const bytes = await api.exportDb()
      const result = await offerBackupFile(bytes)
      if (result === 'cancelled') return
      await api.markExported()
      await refresh()
      setMessage(result === 'shared' ? 'Backup shared.' : 'Backup downloaded.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function connectFolder() {
    setFolderBusy(true)
    setError(null)
    try {
      const status = await chooseBackupFolder()
      setFolder(status)
      const bytes = await api.exportDb()
      const name = await writeBackupToFolder(bytes, true)
      await api.markExported()
      await refresh()
      const folderName = status.supported && status.connected ? status.name : 'the folder'
      setMessage(`Saved ${name} to ${folderName}. Later copies write when the app opens and a backup is due.`)
    } catch (err) {
      if (isAbort(err)) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFolderBusy(false)
    }
  }

  async function writeFolderNow() {
    setFolderBusy(true)
    setError(null)
    try {
      const bytes = await api.exportDb()
      const name = await writeBackupToFolder(bytes, true)
      await api.markExported()
      await refresh()
      setFolder(await getFolderBackupStatus())
      setMessage(`Saved ${name}.`)
    } catch (err) {
      if (isAbort(err)) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFolderBusy(false)
    }
  }

  async function disconnectFolder() {
    await disconnectBackupFolder()
    setFolder(await getFolderBackupStatus())
    setMessage('Backup folder disconnected.')
  }

  async function onSqlite(file: File) {
    if (!confirm('Import replaces the working copy on this phone. Continue?')) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    await api.importSqlite(bytes)
    await refresh()
    setMessage('SQLite file imported.')
    go('/')
  }

  async function runCloud<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      return await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function connectDropbox() {
    await runCloud(() => connect())
  }

  async function uploadDropbox(force: boolean) {
    await runCloud(async () => {
      const bytes = await api.exportDb()
      const empty = (snapshot?.wallets.length ?? 0) === 0
      const result = await maybeUpload(bytes, empty, { force })
      if (result === 'uploaded') {
        await api.markExported()
        await refresh()
        setMessage('Uploaded to Dropbox.')
        return
      }
      if (result === 'needs-restore') {
        setMessage('A Dropbox backup already exists. Restore it, or replace it with this phone.')
        return
      }
      if (result === 'offline') {
        setError('Offline — open Cashbook again when you have a network.')
        return
      }
      if (result === 'failed') {
        const now = cloudStatus()
        const detail =
          now.state === 'connected' || now.state === 'disconnected' ? now.error : null
        setError(detail || 'Dropbox upload failed.')
        return
      }
      setMessage('Dropbox already has this file.')
    })
  }

  async function restoreDropbox() {
    if (!confirm('Import from Dropbox replaces the working copy on this phone. Continue?')) return
    await runCloud(async () => {
      const bytes = await download()
      await api.importSqlite(bytes)
      await markRestored(bytes)
      await api.markExported()
      await refresh()
      setMessage('Restored from Dropbox.')
      go('/')
    })
  }

  async function disconnectDropbox() {
    if (!confirm('Stop uploading to Dropbox from this phone?')) return
    await runCloud(async () => {
      await disconnect()
      setMessage('Disconnected from Dropbox. Manual export still works.')
    })
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
  const lastCloud =
    cloud.state === 'connected' && cloud.lastUploadAt
      ? new Date(cloud.lastUploadAt).toLocaleString()
      : 'never'
  const folderLabel =
    folder.supported && folder.connected
      ? folder.permission === 'granted'
        ? `Connected: ${folder.name}`
        : `Reconnect needed: ${folder.name}`
      : 'Not connected'

  return (
    <div className="stack">
      <div className="topbar">
        <button className="icon-btn" onClick={() => go('/')}>
          ←
        </button>
        <h2>Settings</h2>
      </div>
      {message && <div className="banner">{message}</div>}
      {error && <div className="error">{error}</div>}

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
        <p className="muted" style={{ margin: 0 }}>
          Sign in once. Later opens can upload this file to Dropbox with no extra tap. On iPhone, connect from the
          Home Screen icon, not a Safari tab.
        </p>
        {cloud.state === 'unavailable' && (
          <div className="muted">Cloud backup is not configured in this build.</div>
        )}
        {cloud.state === 'disconnected' && (
          <>
            {cloud.error && <div className="error">{cloud.error}</div>}
            <div className="muted">Redirect URI: {redirectUri()}</div>
            <button className="primary" type="button" disabled={busy} onClick={() => void connectDropbox()}>
              Connect Dropbox
            </button>
          </>
        )}
        {cloud.state === 'connected' && (
          <>
            <div className="muted">Connected · last upload {lastCloud}</div>
            {cloud.error && <div className="error">{cloud.error}</div>}
            {cloud.needsRestore && (
              <div className="banner">A Dropbox backup already exists. Restore it before this empty copy overwrites it.</div>
            )}
            <button className="primary" type="button" disabled={busy} onClick={() => void restoreDropbox()}>
              Restore from Dropbox
            </button>
            <button
              className="primary"
              type="button"
              disabled={busy || (cloud.needsRestore && (snapshot?.wallets.length ?? 0) === 0)}
              onClick={() => void uploadDropbox(cloud.needsRestore && (snapshot?.wallets.length ?? 0) > 0)}
            >
              {cloud.needsRestore && (snapshot?.wallets.length ?? 0) > 0 ? 'Replace Dropbox file' : 'Upload now'}
            </button>
            <button className="ghost" type="button" disabled={busy} onClick={() => void disconnectDropbox()}>
              Disconnect Dropbox
            </button>
          </>
        )}
      </div>

      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          iPhone cannot save files in the background. A reminder appears when a backup is due — share the SQLite
          file to Files or iCloud Drive. On Chrome or Edge you can pick a folder once; dated copies are written
          when you open the app.
        </p>
        <label className="field">
          <span>Remind me to backup</span>
          <select
            value={reminder}
            onChange={(e) => void saveReminder(e.target.value as BackupInterval)}
          >
            <option value="weekly">Once a week</option>
            <option value="monthly">Once a month</option>
            <option value="off">Off</option>
          </select>
        </label>
        {folder.supported && (
          <>
            <div className="muted">{folderLabel}</div>
            <button className="primary" type="button" disabled={folderBusy} onClick={() => void connectFolder()}>
              {folder.supported && folder.connected ? 'Change backup folder' : 'Choose backup folder'}
            </button>
            {folder.connected && (
              <div className="row">
                <button className="ghost" type="button" disabled={folderBusy} onClick={() => void writeFolderNow()}>
                  Write backup now
                </button>
                <button className="ghost" type="button" disabled={folderBusy} onClick={() => void disconnectFolder()}>
                  Disconnect folder
                </button>
              </div>
            )}
          </>
        )}
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
    </div>
  )
}
