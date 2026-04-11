import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // bind to 0.0.0.0 so Tailscale (and LAN) can reach it
    allowedHosts: ['ethan-pc-1.tail5ea3c.ts.net'],
    proxy: {
      // Same path as production Express — uma.moe blocks cross-origin browser calls
      '/api/uma-v3': {
        target: 'https://uma.moe',
        changeOrigin: true,
        rewrite: p => p.replace(/^\/api\/uma-v3/, '/api/v3'),
        secure: true,
      },
    },
  },
})
