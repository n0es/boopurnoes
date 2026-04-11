import express from 'express'
import cookieParser from 'cookie-parser'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { createClient } from '@supabase/supabase-js'
import { existsSync } from 'node:fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { compactInputFromJson, solveDeckCompact } from '../shared/deckSolverCore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Vite output lives at repo `dist/`; compiled server is `dist-server/server/`, so one `../dist` is wrong there. */
function resolveFrontendDist(): string {
  const candidates = [
    path.join(__dirname, '../dist'),
    path.join(__dirname, '../../dist'),
    path.join(process.cwd(), 'dist'),
  ]
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'index.html'))) return dir
  }
  throw new Error(
    `Vite build not found (index.html). Tried: ${candidates.join(', ')}. Run npm run build.`
  )
}

const frontendDist = resolveFrontendDist()

const app = express()
const port = process.env.PORT || 3000

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!
const studioUrl = process.env.STUDIO_URL!
const studioUser = process.env.STUDIO_USER!
const studioPass = process.env.STUDIO_PASS!

const supabase = createClient(supabaseUrl, supabaseServiceKey)

app.use(cookieParser())
app.use(express.json({ limit: '12mb' }))

/**
 * Proxy uma.moe v3 search (browser cannot call uma.moe directly due to CORS).
 * Query string is passed through unchanged.
 */
app.get('/api/uma-v3/search', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString()
    const url = `https://uma.moe/api/v3/search?${qs}`
    const r = await fetch(url, { headers: { Accept: 'application/json' } })
    const text = await r.text()
    res.status(r.status).type('application/json').send(text)
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

/** Deck search runs on the Node process (same numeric core as the browser worker). */
app.post('/api/deck-solve', (req, res) => {
  try {
    const cr = solveDeckCompact(compactInputFromJson(req.body))
    res.json(cr)
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

// Auth check middleware for studio
async function checkAdminAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const token = req.cookies['sb-access-token'] ||
                req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.redirect('/login?redirect=/studio')
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      return res.redirect('/login?redirect=/studio')
    }

    // Check if user has admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return res.status(403).send('Access denied. Admin role required.')
    }

    next()
  } catch {
    return res.redirect('/login?redirect=/studio')
  }
}

// Studio proxy with Basic Auth injection
const studioProxy = createProxyMiddleware({
  target: studioUrl,
  changeOrigin: true,
  pathRewrite: { '^/studio': '' },
  on: {
    proxyReq: (proxyReq: any) => {
      const auth = Buffer.from(`${studioUser}:${studioPass}`).toString('base64')
      proxyReq.setHeader('Authorization', `Basic ${auth}`)
    },
  },
})

app.use('/studio', checkAdminAuth, studioProxy)

// Serve static files
app.use(express.static(frontendDist))

// SPA fallback
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'))
})

app.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
