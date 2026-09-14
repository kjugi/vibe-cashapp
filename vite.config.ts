import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.GITHUB_ACTIONS ? '/vibe-cashapp/' : '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
        injectRegister: false,
      includeAssets: ['favicon.svg'],
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
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { include: ['sql.js/dist/sql-wasm.js'] },
})
