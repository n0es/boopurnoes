# Auth redirect to link — design spec

**Date:** 2026-04-14  
**Issue:** n0es/boopurnoes#2

## Problem

boopurno.es has its own login/signup forms backed by Supabase. link now supports post-login `?next=` redirects and uses the same shared Supabase instance, so local auth forms are redundant.

## Approach

Convert `Login.tsx` and `Signup.tsx` into thin redirect shims. All other auth infrastructure (AuthContext, supabase.ts, server middleware, link references) stays unchanged.

## Changes

### `src/pages/Login.tsx`
- Strip form, OAuth button, and all Supabase call logic
- On mount: read `?redirect=` param through the existing `getRedirectTarget` validator, build `https://link.boopurno.es/login?next=<target>`, redirect via `window.location.href`
- Render a minimal "redirecting..." placeholder while the effect fires

### `src/pages/Signup.tsx`
- Strip form, OAuth button, and all Supabase call logic
- On mount: redirect to `https://link.boopurno.es/login?next=/` (no redirect param on signup currently)
- Same "redirecting..." placeholder

## Unchanged

| File | Reason |
|---|---|
| `src/lib/AuthContext.tsx` | Reads Supabase session from cookies; link sets identical cookies on `.boopurno.es` |
| `src/lib/supabase.ts` | Cookie-writing logic remains valid |
| `server/index.ts` | `checkAdminAuth` redirects to `/login?redirect=/studio` — shim converts this to link correctly |
| All `<Link to="/login">` / `<Link to="/signup">` | No change needed; they flow through the shim |

## Flow after change

1. User clicks "login" anywhere on boopurno.es
2. React Router loads the Login shim
3. Shim immediately redirects to `https://link.boopurno.es/login?next=<target>`
4. link authenticates the user, sets `sb-access-token` cookie on `.boopurno.es`
5. link redirects back to `<target>`
6. AuthContext picks up the session via `onAuthStateChange` / `getSession`
