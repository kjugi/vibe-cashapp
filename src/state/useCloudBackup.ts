import { useSyncExternalStore } from 'react'
import { status, subscribeCloud, type CloudStatus } from '../lib/cloud'

export function useCloudBackup(): CloudStatus {
  return useSyncExternalStore(subscribeCloud, status, status)
}
