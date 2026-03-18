import express from 'express';
import cookieParser from 'cookie-parser';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const studioUrl = process.env.STUDIO_URL;
const studioUser = process.env.STUDIO_USER;
const studioPass = process.env.STUDIO_PASS;
const supabase = createClient(supabaseUrl, supabaseServiceKey);
app.use(cookieParser());
// Auth check middleware for studio
async function checkAdminAuth(req, res, next) {
    const token = req.cookies['sb-access-token'] ||
        req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        return res.redirect('/login?redirect=/studio');
    }
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.redirect('/login?redirect=/studio');
        }
        // Check if user has admin role
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
        if (profile?.role !== 'admin') {
            return res.status(403).send('Access denied. Admin role required.');
        }
        next();
    }
    catch {
        return res.redirect('/login?redirect=/studio');
    }
}
// Studio proxy with Basic Auth injection
const studioProxy = createProxyMiddleware({
    target: studioUrl,
    changeOrigin: true,
    pathRewrite: { '^/studio': '' },
    on: {
        proxyReq: (proxyReq) => {
            const auth = Buffer.from(`${studioUser}:${studioPass}`).toString('base64');
            proxyReq.setHeader('Authorization', `Basic ${auth}`);
        },
    },
});
app.use('/studio', checkAdminAuth, studioProxy);
// Serve static files
app.use(express.static(path.join(__dirname, '../dist')));
// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
