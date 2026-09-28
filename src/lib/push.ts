import { authHeaders, cloudApiUrl, setPushEnabled, status } from './cloud'
import { getPwaRegistration } from './pwa'

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

async function vapidKey(): Promise<BufferSource> {
  const res = await fetch(cloudApiUrl('/api/push'))
  if (!res.ok) {
    let detail = `Server HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) detail = body.error
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  const body = (await res.json()) as { publicKey?: string }
  if (!body.publicKey) throw new Error('Server did not return a VAPID public key.')
  return urlBase64ToUint8Array(body.publicKey)
}

const NO_WORKER = 'No service worker yet. Refresh once, then try again.'

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(message))
      },
    )
  })
}

export async function enableBackupPush(): Promise<void> {
  if (!pushSupported()) {
    throw new Error('This browser cannot receive web push. On iPhone, add Cashbook to the Home Screen first.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')

  const registration =
    getPwaRegistration() ?? (await withTimeout(navigator.serviceWorker.ready, 4000, NO_WORKER))
  if (!registration?.pushManager) throw new Error(NO_WORKER)

  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await withTimeout(
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: await vapidKey(),
      }),
      15000,
      'Could not turn on weekly alerts.',
    ))

  const res = await fetch(cloudApiUrl('/api/push'), {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(subscription.toJSON()),
  })
  if (!res.ok) throw new Error(`Could not register push (${res.status}).`)
  setPushEnabled(true)
}

export async function disableBackupPush(): Promise<void> {
  const registration = getPwaRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    try {
      await fetch(cloudApiUrl('/api/push'), {
        method: 'DELETE',
        headers: authHeaders(true),
        body: JSON.stringify(subscription.toJSON()),
      })
    } catch {
      /* still drop the local subscription */
    }
    await subscription.unsubscribe()
  }
  setPushEnabled(false)
}

export async function syncBackupPush(): Promise<void> {
  if (status().state !== 'connected') return
  if (!pushSupported() || Notification.permission !== 'granted') return
  const registration = getPwaRegistration()
  if (!registration?.pushManager) return
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  try {
    const res = await fetch(cloudApiUrl('/api/push'), {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(subscription.toJSON()),
    })
    if (res.ok) setPushEnabled(true)
  } catch {
    /* offline */
  }
}
