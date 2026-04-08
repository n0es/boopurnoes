import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pkgPath = fileURLToPath(new URL('./package.json', import.meta.url))
const { version } = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  server: {
    host: true, // bind to 0.0.0.0 so Tailscale (and LAN) can reach it
    allowedHosts: ['ethan-pc-1.tail5ea3c.ts.net'],
  },
})
