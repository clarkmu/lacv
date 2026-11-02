import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Local development without Docker: `npm run dev` serves the app and forwards /api to the backend,
// stripping the prefix as the production gateway does (deploy/gateway/nginx.conf). LACV_API_URL overrides the target.
const apiTarget = process.env.LACV_API_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    proxy: {
      '/api': { target: apiTarget, rewrite: path => path.replace(/^\/api/, '') },
    },
  },
})
