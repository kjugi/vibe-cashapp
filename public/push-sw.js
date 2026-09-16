/* global self, clients */

self.addEventListener('push', (event) => {
  const fallback = {
    title: 'Cashbook',
    body: 'Time to backup — last cloud copy is more than 5 days old. Open the app to send the file.',
    url: './',
  }
  let data = fallback
  try {
    const parsed = event.data ? event.data.json() : null
    if (parsed && typeof parsed === 'object') {
      data = {
        title: typeof parsed.title === 'string' ? parsed.title : fallback.title,
        body: typeof parsed.body === 'string' ? parsed.body : fallback.body,
        url: typeof parsed.url === 'string' ? parsed.url : fallback.url,
      }
    }
  } catch {
    const text = event.data && typeof event.data.text === 'function' ? event.data.text() : ''
    if (text) data = { ...fallback, body: text }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: 'cashbook-backup',
      renotify: true,
      data: { url: data.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client && client.url !== target) {
            try {
              await client.navigate(target)
            } catch {
              /* older browsers */
            }
          }
          return
        }
      }
      await self.clients.openWindow(target)
    })(),
  )
})
