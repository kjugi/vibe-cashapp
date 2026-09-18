/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
}

interface Window {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>
}

declare module 'sql.js/dist/sql-wasm.js' {
  import type { Database } from 'sql.js'
  const initSqlJs: (config?: { locateFile?: (file: string) => string }) => Promise<{
    Database: new (data?: ArrayLike<number>) => Database
  }>
  export default initSqlJs
  export type { Database }
}

