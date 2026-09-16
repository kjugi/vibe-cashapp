import type { BackupInterval } from '../db/types'

export type { BackupInterval }

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MONTH_MS = 30 * 24 * 60 * 60 * 1000
const IDB_NAME = 'cashbook-backup'
const IDB_STORE = 'handles'
const HANDLE_KEY = 'folder'
const KEEP_FILES = 8
const FILE_RE = /^cashbook-\d{4}-\d{2}-\d{2}\.sqlite$/

export function backupIsDue(lastExportAt: string | null, interval: BackupInterval): boolean {
  if (interval === 'off') return false
  if (!lastExportAt) return true
  const parsed = Date.parse(lastExportAt)
  if (Number.isNaN(parsed)) return true
  const windowMs = interval === 'weekly' ? WEEK_MS : MONTH_MS
  return Date.now() - parsed > windowMs
}

export function backupFileName(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `cashbook-${y}-${m}-${d}.sqlite`
}

export function folderBackupSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export type FolderBackupStatus =
  | { supported: false }
  | { supported: true; connected: false }
  | { supported: true; connected: true; name: string; permission: PermissionState }

export async function getFolderBackupStatus(): Promise<FolderBackupStatus> {
  if (!folderBackupSupported()) return { supported: false }
  const handle = await loadDirectoryHandle()
  if (!handle) return { supported: true, connected: false }
  const permission = await queryDirPermission(handle)
  return { supported: true, connected: true, name: handle.name, permission }
}

export async function chooseBackupFolder(): Promise<FolderBackupStatus> {
  const picker = window.showDirectoryPicker
  if (typeof picker !== 'function') {
    throw new Error('This browser cannot pick a backup folder.')
  }
  const handle = await picker.call(window, { id: 'cashbook-backup', mode: 'readwrite' })
  const permission = await requestDirPermission(handle)
  if (permission !== 'granted') throw new Error('Folder access was not granted.')
  await saveDirectoryHandle(handle)
  return { supported: true, connected: true, name: handle.name, permission }
}

export async function disconnectBackupFolder(): Promise<void> {
  const db = await openIdb()
  await idbRequest(db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(HANDLE_KEY))
}

export async function writeBackupToFolder(bytes: Uint8Array, requestPermission = false): Promise<string> {
  const handle = await loadDirectoryHandle()
  if (!handle) throw new Error('No backup folder is connected.')
  const permission = requestPermission ? await requestDirPermission(handle) : await queryDirPermission(handle)
  if (permission !== 'granted') throw new Error('Folder access is not granted.')
  const name = backupFileName()
  const file = await handle.getFileHandle(name, { create: true })
  const writable = await file.createWritable({ keepExistingData: false })
  await writable.write(toArrayBuffer(bytes))
  await writable.close()
  await pruneOldBackups(handle)
  return name
}

export async function trySilentFolderBackup(bytes: Uint8Array): Promise<string | null> {
  if (!folderBackupSupported()) return null
  const handle = await loadDirectoryHandle()
  if (!handle) return null
  if ((await queryDirPermission(handle)) !== 'granted') return null
  return writeBackupToFolder(bytes, false)
}

export async function offerBackupFile(bytes: Uint8Array): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([toArrayBuffer(bytes)], backupFileName(), { type: 'application/octet-stream' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Cashbook backup' })
      return 'shared'
    } catch (err) {
      if (isAbort(err)) return 'cancelled'
      throw err
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open backup storage.'))
  })
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Backup storage failed.'))
  })
}

async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openIdb()
    const handle = await idbRequest(
      db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(HANDLE_KEY),
    )
    return handle instanceof FileSystemDirectoryHandle ? handle : null
  } catch {
    return null
  }
}

async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIdb()
  await idbRequest(db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(handle, HANDLE_KEY))
}

async function queryDirPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  const withPerm = handle as FileSystemDirectoryHandle & {
    queryPermission?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  }
  if (typeof withPerm.queryPermission !== 'function') return 'granted'
  return withPerm.queryPermission({ mode: 'readwrite' })
}

async function requestDirPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  const withPerm = handle as FileSystemDirectoryHandle & {
    requestPermission?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>
  }
  if (typeof withPerm.requestPermission !== 'function') return 'granted'
  return withPerm.requestPermission({ mode: 'readwrite' })
}

async function pruneOldBackups(dir: FileSystemDirectoryHandle): Promise<void> {
  const names: string[] = []
  for await (const handle of iterateDirectory(dir)) {
    if (handle.kind === 'file' && FILE_RE.test(handle.name)) names.push(handle.name)
  }
  names.sort()
  const extra = names.slice(0, Math.max(0, names.length - KEEP_FILES))
  for (const name of extra) {
    await dir.removeEntry(name)
  }
}

async function* iterateDirectory(dir: FileSystemDirectoryHandle): AsyncGenerator<FileSystemHandle> {
  const rec = dir as FileSystemDirectoryHandle & {
    values?: () => AsyncIterable<FileSystemHandle>
    entries?: () => AsyncIterable<[string, FileSystemHandle]>
  }
  if (rec.values) {
    for await (const handle of rec.values()) yield handle
    return
  }
  if (rec.entries) {
    for await (const [, handle] of rec.entries()) yield handle
  }
}
