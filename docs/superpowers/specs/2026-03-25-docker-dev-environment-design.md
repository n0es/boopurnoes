# Docker Dev Environment Design

**Date:** 2026-03-25
**Branch:** feature/deck-optimizer

## Overview

Add a Docker Compose dev environment that starts the Vite frontend and uma-optimizer Rust service with a single `docker compose -f docker-compose.dev.yml up`. Supabase continues to be managed separately via `npx supabase start`. Tailscale exposure is handled by the Windows host — no Docker-side Tailscale config required.

## Constraints

- The existing `Dockerfile`, `docker-compose.yml`, and `.github/workflows/deploy.yml` are production files and must not be modified.
- The dev setup must not break the production CI/CD pipeline (GitHub Actions → GHCR → Watchtower).
- Services must be reachable from other tailnet devices via `ethan-pc-1.tail5ea3c.ts.net`.

## Services

### frontend

- **Image:** Built from `Dockerfile.dev` at the project root.
- **Base image:** `node:20-alpine`
- **Command:** `npm run dev` (Vite dev server)
- **Port:** `5173:5173` exposed to host
- **Env file:** `.env.local` (provides `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- **Extra env:** `OPTIMIZER_PROXY_TARGET=http://uma-optimizer:3001` — read by `vite.config.ts` to proxy to the optimizer container by service name. This variable name avoids collision with anything in `.env.local` or the optimizer's own env vars. It is captured once when the Vite process starts (not hot-reloaded); a container restart is needed if changed.
- **Volume mount:** Project root → `/app` for live code reload, **plus** a named volume at `/app/node_modules` to preserve the container-installed Linux node_modules. Without the named volume, the host's Windows-native binaries (e.g., `@rollup/rollup-win32-x64-msvc`) would shadow the Alpine-compatible ones and break the dev server.
- **allowedHosts:** `vite.config.ts` must include both `ethan-pc-1.tail5ea3c.ts.net` and `localhost` (or `'all'`) so the dev server accepts requests via either hostname.

### uma-optimizer

- **Image:** Built from `uma-optimizer/Dockerfile`
- **Build context:** `uma-optimizer/` subdirectory (specified as `context: uma-optimizer` in the compose file so `Cargo.toml` and `Cargo.lock` are at the root of the build context)
- **Build stages:**
  - Builder: `rust:bookworm` (full image — required for `gcc` and other build tools needed by `ring`, a transitive dep of `rustls` used by `sqlx`). `rust:slim` is insufficient for this dependency graph.
  - Runtime: `debian:bookworm-slim` with `libssl3` and `ca-certificates`
- **Port:** `3001:3001` exposed to host
- **Env file:** `.env.local` (provides `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, etc.)
- **Env override:** `DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/postgres` — replaces the `.env.local` Tailscale hostname. This override is required because Docker Desktop resolves `host.docker.internal` to the Windows host, whereas the Tailscale hostname may not resolve inside the container's DNS.
- **Note on `.env.local` loading in `main.rs`:** `main.rs` calls `dotenvy::from_filename("../.env.local")` which silently fails inside the container (the file doesn't exist at that relative path). This is fine — all required env vars are provided via `env_file` and `environment` in the compose file. The `DATABASE_URL` expect() on startup will panic if the override is missing, giving a clear error.

## Dependency caching in Rust Dockerfile

Standard two-layer caching trick to avoid rebuilding all dependencies on source changes:

1. Copy `Cargo.toml` + `Cargo.lock` only, create a stub `src/main.rs`, run `cargo build --release` to cache deps.
2. Remove the stub, copy real `src/`, run `cargo build --release` again (only changed crates recompile).

The build context is `uma-optimizer/`, so `Cargo.toml` and `Cargo.lock` are at `.` within the context.

## Networking

- Both services share a bridge network `dev-net`.
- Ports are exposed to the Windows host, making them automatically reachable via Tailscale (no in-container Tailscale needed).
- `network_mode: host` is not used — it does not work on Docker Desktop for Windows.
- The optimizer is reachable from the frontend container at `http://uma-optimizer:3001` via `dev-net`.
- Supabase (postgres on 54322, API on 54321) is reached from the optimizer container via `host.docker.internal`.

## Files

| File | Action | Notes |
|------|--------|-------|
| `docker-compose.dev.yml` | Create | Dev-only compose file |
| `Dockerfile.dev` | Create | Dev frontend image (node + npm run dev) |
| `uma-optimizer/Dockerfile` | Create | Multi-stage Rust build |
| `vite.config.ts` | Modify | Proxy target reads `process.env.OPTIMIZER_PROXY_TARGET` with fallback to `http://localhost:3001`; add `localhost` to `allowedHosts` |
| `Dockerfile` | Untouched | Production frontend image |
| `docker-compose.yml` | Untouched | Production deployment compose |
| `.github/workflows/deploy.yml` | Untouched | CI/CD pipeline |

## vite.config.ts Changes

Only two values change. Everything else in the file (the `rewrite` function, `changeOrigin`, and the SSE `configure` handler) must be preserved exactly as-is.

```ts
server: {
  host: true,
  allowedHosts: ['ethan-pc-1.tail5ea3c.ts.net', 'localhost'], // add 'localhost'
  proxy: {
    '/optimizer-api': {
      target: process.env.OPTIMIZER_PROXY_TARGET ?? 'http://localhost:3001', // was hardcoded
      changeOrigin: true,                  // unchanged
      rewrite: (path) => path.replace(/^\/optimizer-api/, ''),  // unchanged
      configure: (proxy) => {             // unchanged — required for SSE streaming
        proxy.on('proxyReq', (_proxyReq, req) => {
          if (req.url?.includes('/stream')) {
            _proxyReq.setHeader('Accept', 'text/event-stream')
          }
        })
      },
    },
  },
},
```

When `OPTIMIZER_PROXY_TARGET` is unset (running outside Docker), behavior is identical to before. The Vite proxy only runs during `vite dev`, never during `vite build`, so production is unaffected.

## Usage

```bash
# Terminal 1 — start supabase (unchanged workflow)
npx supabase start

# Terminal 2 — start dev environment
docker compose -f docker-compose.dev.yml up --build
```

Services are then accessible at:
- Frontend: `http://ethan-pc-1.tail5ea3c.ts.net:5173` (or `http://localhost:5173`)
- Optimizer: `http://ethan-pc-1.tail5ea3c.ts.net:3001` (or `http://localhost:3001`)
