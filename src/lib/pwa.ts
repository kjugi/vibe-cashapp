import { registerSW } from 'virtual:pwa-register'

type Listener = (needRefresh: boolean) => void

let needRefresh = false
let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined
let registration: ServiceWorkerRegistration | undefined
const listeners = new Set<Listener>()

function notify() {
  for (const listener of listeners) listener(needRefresh)
}

export function getNeedRefresh() {
  return needRefresh
}

export function getPwaRegistration() {
  return registration
}

export function subscribeNeedRefresh(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function applyPwaUpdate() {
  return updateSW?.(true)
}

/** Ask the browser to check for a newly deployed service worker. */
export async function checkForPwaUpdate() {
  if (!registration) return false
  if ('connection' in navigator && !navigator.onLine) return false
  await registration.update()
  if (registration.waiting) {
    needRefresh = true
    notify()
    return true
  }
  return needRefresh
}

async function probeAndUpdate(swUrl: string, reg: ServiceWorkerRegistration) {
  if (reg.installing || !navigator) return
  if ('connection' in navigator && !navigator.onLine) return

  try {
    const resp = await fetch(swUrl, {
      cache: 'no-store',
      headers: {
        cache: 'no-store',
        'cache-control': 'no-cache',
      },
    })
    if (resp?.status === 200) await reg.update()
  } catch {
    // Offline or unreachable — keep the current worker.
  }
}

export function registerPwa() {
  const intervalMS = 60 * 60 * 1000

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true
      notify()
    },
    onRegisteredSW(swUrl, reg) {
      registration = reg
      if (!reg) return

      void probeAndUpdate(swUrl, reg)
      setInterval(() => {
        void probeAndUpdate(swUrl, reg)
      }, intervalMS)

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void probeAndUpdate(swUrl, reg)
        }
      })
    },
  })
}
