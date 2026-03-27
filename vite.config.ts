import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // bind to 0.0.0.0 so Tailscale (and LAN) can reach it
    allowedHosts: ['ethan-pc-1.tail5ea3c.ts.net', 'localhost'],
    proxy: {
      // Proxy optimizer API requests to the Rust service.
      // This avoids mixed-content issues (HTTPS page → HTTP optimizer).
      '/optimizer-api': {
        target: process.env.OPTIMIZER_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/optimizer-api/, ''),
        // Ensure SSE streams are not buffered
        configure: (proxy) => {
          proxy.on('proxyReq', (_proxyReq, req) => {
            if (req.url?.includes('/stream')) {
              _proxyReq.setHeader('Accept', 'text/event-stream')
            }
          })
        },
      },
    },
  },
})
