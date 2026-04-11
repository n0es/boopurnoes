import packageJson from '../package.json' with { type: 'json' }

/** Single source of truth: root `package.json` (dev HMR + production build). */
export const APP_VERSION = packageJson.version
