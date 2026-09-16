import { useSyncExternalStore } from 'react'
import { status, subscribeCloud, type CloudStatus } from '../lib/dropboxBackup'

export function useCloudBackup(): CloudStatus {
  return useSyncExternalStore(subscribeCloud, status, status)
}
