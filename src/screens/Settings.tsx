import { useEffect, useRef, useState } from 'react'
import { useDb } from '../state/DbContext'
import { useCloudBackup } from '../state/useCloudBackup'
import { BlockingProgress } from '../components/BlockingProgress'
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
  disconnect,
  download,
  markRestored,
  maybeUpload,
  startGoogleSignIn,
  status as cloudStatus,
} from '../lib/cloud'
import { disableBackupPush, enableBackupPush, pushSupported } from '../lib/push'
import type { BackupInterval } from '../db/types'

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

type CloudAction = 'sign-in' | 'upload' | 'restore' | 'alerts' | 'sign-out'

const CLOUD_PROGRESS: Record<CloudAction, { title: string; detail: string }> = {
  'sign-in': {
    title: 'Signing in…',
    detail: 'Opening Google. Stay here until sign-in continues.',
  },
  upload: {
    title: 'Uploading…',
    detail: 'Sending this phone\'s copy to the server. Wait until it finishes.',
  },
  restore: {
    title: 'Restoring…',
    detail: 'Replacing the working copy on this phone. Wait until it finishes.',
  },
  alerts: {
    title: 'Updating weekly alerts…',
    detail: 'Saving the alert setting for this phone. Wait until it finishes.',
  },
  'sign-out': {
    title: 'Signing out…',
    detail: 'Disconnecting Google backup on this phone. Wait until it finishes.',
  },
}

function ActionButton({
  action,
  id,
  className = 'primary',
  extraDisabled = false,
  onClick,
  idle,
  pending,
}: {
  action: CloudAction | null
  id: CloudAction
  className?: string
  extraDisabled?: boolean
  onClick: () => void
  idle: string
  pending: string
}) {
  const active = action === id
  return (
    <button
      className={className}
      type="button"
      disabled={action !== null || extraDisabled}
      aria-busy={active}
      onClick={onClick}
    >
      {active ? (
        <span className="btn-pending">
          <span className="spinner" aria-hidden="true" />
          {pending}
        </span>
      ) : (
        idle
      )}
    </button>
  )
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
  const [action, setAction] = useState<CloudAction | null>(null)
  const actionRef = useRef<CloudAction | null>(null)

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

  async function runCloud<T>(
    id: CloudAction,
    fn: () => Promise<T>,
    opts?: { holdOnSuccess?: boolean },
  ): Promise<T | undefined> {
    if (actionRef.current) return
    actionRef.current = id
    const started = performance.now()
    setAction(id)
    setError(null)
    setMessage(null)
    // Let the spinner and dialog paint before a fast request finishes in the same turn.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    const finish = async (hold: boolean) => {
      if (hold) return
      const remaining = 450 - (performance.now() - started)
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
      if (actionRef.current !== id) return
      actionRef.current = null
      setAction(null)
    }
    try {
      const result = await fn()
      await finish(opts?.holdOnSuccess === true)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      await finish(false)
    }
  }

  async function connectCloud() {
    await runCloud(
      'sign-in',
      async () => {
        // Paint the locked button and dialog before the browser leaves for Google.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
        startGoogleSignIn()
      },
      { holdOnSuccess: true },
    )
  }

  async function uploadCloud(force: boolean) {
    await runCloud('upload', async () => {
      const snap = await api.snapshot()
      const bytes = await api.exportDb()
      const empty = snap.wallets.length === 0
      const result = await maybeUpload(bytes, empty, { force: force || !empty })
      if (result === 'uploaded') {
        await api.markExported()
        await refresh()
        setMessage('Uploaded to the server.')
        return
      }
      if (result === 'empty') {
        setMessage('Nothing to upload yet. Add a wallet first, or restore if a backup already exists.')
        return
      }
      if (result === 'needs-restore') {
        setMessage('A cloud backup already exists. Restore it, or replace it with this phone.')
        return
      }
      if (result === 'offline') {
        setError('Offline — open Cashbook again when you have a network.')
        return
      }
      if (result === 'failed') {
        const now = cloudStatus()
        const detail = now.state === 'connected' || now.state === 'disconnected' ? now.error : null
        setError(detail || 'Cloud upload failed.')
        return
      }
      setMessage('Server already has this file.')
    })
  }

  async function restoreCloud() {
    if (actionRef.current) return
    if (!confirm('Import from the server replaces the working copy on this phone. Continue?')) return
    await runCloud('restore', async () => {
      const bytes = await download()
      await api.importSqlite(bytes)
      await markRestored(bytes)
      await api.markExported()
      await refresh()
      setMessage('Restored from the server.')
      go('/')
    })
  }

  async function disconnectCloud() {
    if (actionRef.current) return
    if (!confirm('Stop using Google backup on this phone?')) return
    await runCloud('sign-out', async () => {
      try {
        await disableBackupPush()
      } catch {
        /* still disconnect */
      }
      await disconnect()
      setMessage('Signed out. Manual export still works.')
    })
  }

  async function togglePush(enable: boolean) {
    await runCloud('alerts', async () => {
      if (enable) {
        await enableBackupPush()
        setMessage('Weekly alerts are on. The server pings this phone if the cloud copy is older than 5 days.')
      } else {
        await disableBackupPush()
        setMessage('Weekly alerts are off.')
      }
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
  const cloudWho =
    cloud.state === 'connected' ? cloud.email || cloud.displayName || 'Google' : null
  const folderLabel =
    folder.supported && folder.connected
      ? folder.permission === 'granted'
        ? `Connected: ${folder.name}`
        : `Reconnect needed: ${folder.name}`
      : 'Not connected'

  const progress = action ? CLOUD_PROGRESS[action] : null

  return (
    <>
    <div className="stack" inert={action !== null ? true : undefined}>
      <div className="topbar">
        <button className="icon-btn" type="button" disabled={action !== null} onClick={() => go('/')}>
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
          Sign in with Google so you and a friend can each keep a separate cloud copy. Nothing is sent until you
          tap Upload now. A weekly push fires if your copy is older than 5 days.
        </p>
        {cloud.state === 'unavailable' && (
          <div className="muted">Google sign-in is not configured in this build. Set VITE_GOOGLE_CLIENT_ID.</div>
        )}
        {cloud.state === 'disconnected' && (
          <>
            {cloud.error && <div className="error">{cloud.error}</div>}
            <ActionButton
              action={action}
              id="sign-in"
              onClick={() => void connectCloud()}
              idle="Sign in with Google"
              pending="Signing in…"
            />
          </>
        )}
        {cloud.state === 'connected' && (
          <>
            <div className="muted">
              {cloudWho} · last upload {lastCloud}
            </div>
            {cloud.error && <div className="error">{cloud.error}</div>}
            {cloud.needsRestore && (
              <div className="banner">A cloud backup already exists. Restore it before this empty copy overwrites it.</div>
            )}
            <ActionButton
              action={action}
              id="restore"
              onClick={() => void restoreCloud()}
              idle="Restore from server"
              pending="Restoring…"
            />
            <ActionButton
              action={action}
              id="upload"
              extraDisabled={cloud.needsRestore && (snapshot?.wallets.length ?? 0) === 0}
              onClick={() => void uploadCloud(cloud.needsRestore && (snapshot?.wallets.length ?? 0) > 0)}
              idle={cloud.needsRestore && (snapshot?.wallets.length ?? 0) > 0 ? 'Replace server file' : 'Upload now'}
              pending="Uploading…"
            />
            {pushSupported() ? (
              <ActionButton
                action={action}
                id="alerts"
                onClick={() => void togglePush(!cloud.pushEnabled)}
                idle={cloud.pushEnabled ? 'Disable weekly alerts' : 'Enable weekly alerts'}
                pending={cloud.pushEnabled ? 'Turning alerts off…' : 'Turning alerts on…'}
              />
            ) : (
              <div className="muted">
                Weekly push needs a Home Screen install (iPhone) or a browser that supports web push.
              </div>
            )}
            <ActionButton
              action={action}
              id="sign-out"
              className="ghost"
              onClick={() => void disconnectCloud()}
              idle="Sign out"
              pending="Signing out…"
            />
          </>
        )}
      </div>

      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          iPhone cannot save files in the background. A reminder appears when a backup is due — share the SQLite
          file to Files or iCloud Drive. On Chrome or Edge you can pick a folder once; dated copies are written
          when you open the app. Connect the Vercel server above for a weekly push when the cloud copy is older
          than 5 days.
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
    {progress && <BlockingProgress title={progress.title} detail={progress.detail} />}
    </>
  )
}
