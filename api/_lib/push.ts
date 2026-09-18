import webpush from 'web-push'
import type { PushSubscriptionJSON } from './store.js'

const DEFAULT_PAYLOAD = {
  title: 'Cashbook',
  body: 'Time to backup — last cloud copy is more than 5 days old. Open Settings and tap Upload now.',
  url: '#/settings',
}

function vapidConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim())
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null
}

function applyVapid(): void {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) throw new Error('VAPID keys are not set.')
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:cashbook@localhost'
  webpush.setVapidDetails(subject, publicKey, privateKey)
}

export async function sendBackupPushes(subscriptions: PushSubscriptionJSON[]): Promise<PushSubscriptionJSON[]> {
  if (!vapidConfigured() || subscriptions.length === 0) return subscriptions
  applyVapid()
  const payload = JSON.stringify(DEFAULT_PAYLOAD)
  const kept: PushSubscriptionJSON[] = []
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys,
        },
        payload,
      )
      kept.push(sub)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) continue
      kept.push(sub)
    }
  }
  return kept
}
