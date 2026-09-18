import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.GITHUB_ACTIONS ? '/vibe-cashapp/' : '/'

async function nodeToFetch(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? 'localhost'
  const url = `http://${host}${req.url}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  const method = req.method ?? 'GET'
  const init: RequestInit & { duplex?: 'half' } = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    init.body = Buffer.concat(chunks)
    init.duplex = 'half'
  }
  return new Request(url, init)
}

async function writeFetch(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  res.end(Buffer.from(await response.arrayBuffer()))
}

function cashbookApi(): Plugin {
  return {
    name: 'cashbook-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next()
          return
        }
        void (async () => {
          try {
            const { dispatchApi } = await import('./api/_lib/handlers')
            const request = await nodeToFetch(req)
            const response = await dispatchApi(request)
            await writeFetch(res, response)
          } catch (err) {
            next(err as Error)
          }
        })()
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  return {
    base,
    plugins: [
      cashbookApi(),
      react(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'push-sw.js'],
        manifest: {
          name: 'Cashbook',
          short_name: 'Cashbook',
          description: 'Offline personal ledger',
          theme_color: '#1c6b45',
          background_color: '#f3eee4',
          display: 'standalone',
          orientation: 'portrait',
          start_url: base,
          scope: base,
          icons: [
            {
              src: 'favicon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,wasm,ico}'],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          cleanupOutdatedCaches: true,
          importScripts: ['push-sw.js'],
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    worker: { format: 'es' },
    optimizeDeps: { include: ['sql.js/dist/sql-wasm.js'] },
  }
})
