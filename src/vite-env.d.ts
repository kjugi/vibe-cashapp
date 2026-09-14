/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'sql.js/dist/sql-wasm.js' {
  import type { Database } from 'sql.js'
  const initSqlJs: (config?: { locateFile?: (file: string) => string }) => Promise<{
    Database: new (data?: ArrayLike<number>) => Database
  }>
  export default initSqlJs
  export type { Database }
}

