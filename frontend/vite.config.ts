import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development, /api is proxied so the browser sees a single origin, exactly as it does
// behind CloudFront. By default that is the local API (`npm run local-api` in the project root).
// To develop against a deployed stack instead:
//   API_PROXY_TARGET=https://dxxxxxxxxxxxx.cloudfront.net npm run dev
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // MapLibre starts its worker as an ES module
  worker: { format: 'es' },
  // MapLibre alone is around 1 MB minified; that is expected, not a sign of a bundling mistake
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
})
