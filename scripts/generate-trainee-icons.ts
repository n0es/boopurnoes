/**
 * Generate circular trainee icons from portrait art already stored in Supabase.
 *
 * Reads each trainee's portrait from storage (trainees/art/{id}.png), crops to
 * the head/upper-body region, and composites it into a circular icon where the
 * head extends above the circle border — matching the style of existing game icons.
 *
 * Storage paths (in 'umamusume' bucket):
 *   Input:  trainees/art/{id}.png
 *   Output: trainees/icons/{id}.png
 *
 * Usage:
 *   npx tsx scripts/generate-trainee-icons.ts              # all trainees, skip existing
 *   npx tsx scripts/generate-trainee-icons.ts 100701       # single trainee by id
 *   npx tsx scripts/generate-trainee-icons.ts -- --force   # re-generate everything
 *   npx tsx scripts/generate-trainee-icons.ts -- --debug   # save debug PNGs to ./debug-icons/
 *
 * Requires in .env.local:
 *   SUPABASE_URL=http://localhost:54321
 *   SUPABASE_SERVICE_KEY=<your-local-service-role-key>
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import sharp from 'sharp'

// ── Env ───────────────────────────────────────────────────────────────────────

try {
  const contents = readFileSync(resolve(process.cwd(), '.env.local'), 'utf-8')
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!(key in process.env)) process.env[key] = val
  }
} catch { /* rely on existing env */ }

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const force = process.argv.includes('--force')
const debug = process.argv.includes('--debug')
const BUCKET = 'umamusume'
const CONCURRENCY = 3
const DELAY_MS = 100

// ── Icon geometry constants (tweak these to adjust framing) ───────────────────

const CANVAS = 256          // output canvas size (square)
const CIRCLE_CX = 128       // circle center X
const CIRCLE_CY = 128       // circle center Y (centered; head extends above via positioning)
const CIRCLE_R = 106        // circle radius
const BORDER_WIDTH = 4      // ring stroke width (px)
const BORDER_COLOR = '#d8d8e0' // solid light gray (translucent strokes break the split-ring effect)
const BG_COLOR = '#1a1a22'     // dark circle fill

// Fraction of trimmed character height to include in the crop.
// 1.0 = full standing pose; the circle mask handles clipping the lower body.
const HEAD_CROP_RATIO = 1.0

// Character top is anchored at TOP_PADDING so ears are never cropped.
const TOP_PADDING = 5   // px from canvas top to top of character

/** Minimum scaled height: character must reach from TOP_PADDING to the circle bottom. */
const MIN_CHAR_HEIGHT = (CIRCLE_CY + CIRCLE_R) - TOP_PADDING

const supabase = createClient(supabaseUrl, supabaseServiceKey)

if (debug) mkdirSync('debug-icons', { recursive: true })

// ── Storage helpers ───────────────────────────────────────────────────────────

function portraitStoragePath(id: number): string { return `trainees/art/${id}.png` }
function iconStoragePath(id: number): string { return `trainees/icons/${id}.png` }

async function fileExists(path: string): Promise<boolean> {
  const { data } = await supabase.storage.from(BUCKET).list(
    path.substring(0, path.lastIndexOf('/')),
    { search: path.substring(path.lastIndexOf('/') + 1) }
  )
  return (data?.length ?? 0) > 0
}

async function downloadFromStorage(path: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) throw new Error(`Storage download failed for ${path}: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

// ── Image processing ──────────────────────────────────────────────────────────

/**
 * Scans the alpha channel of a raw RGBA buffer to find the bounding box of
 * non-transparent pixels. Returns { left, top, right, bottom } in pixel coords.
 */
function findContentBounds(
  data: Buffer,
  width: number,
  height: number,
  alphaThreshold = 10,
): { left: number; top: number; right: number; bottom: number } | null {
  let left = width, top = height, right = 0, bottom = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > alphaThreshold) {
        if (x < left)   left   = x
        if (x > right)  right  = x
        if (y < top)    top    = y
        if (y > bottom) bottom = y
      }
    }
  }
  if (left > right || top > bottom) return null
  return { left, top, right, bottom }
}

/**
 * Makes every pixel with alpha > threshold fully opaque (alpha = 255), and
 * every pixel below the threshold fully transparent (alpha = 0). This removes
 * the soft semi-transparent edges present in the GameTora portrait PNGs so the
 * character renders as solid art rather than washed-out where alpha < 255.
 */
async function normalizeAlpha(inputBuf: Buffer, threshold = 20): Promise<Buffer> {
  const { data, info } = await sharp(inputBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] > threshold ? 255 : 0
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer()
}

async function generateIcon(portraitBuf: Buffer): Promise<Buffer> {
  // Get raw RGBA pixels for bounding-box scan
  const { data: raw, info } = await sharp(portraitBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const bounds = findContentBounds(raw, info.width, info.height)
  if (!bounds) throw new Error('Portrait appears to be fully transparent')

  const contentW = bounds.right  - bounds.left + 1
  const contentH = bounds.bottom - bounds.top  + 1

  // Crop to the top HEAD_CROP_RATIO of the trimmed content, centered horizontally
  const cropH = Math.round(contentH * HEAD_CROP_RATIO)
  const cropRegion = {
    left:   bounds.left,
    top:    bounds.top,
    width:  contentW,
    height: cropH,
  }

  // Scale so (a) width fills circle diameter AND (b) height reaches at least
  // the circle bottom. Use whichever scale is larger — guarantees the
  // character always fills to the bottom of the ring.
  const scaleW = (CIRCLE_R * 2) / contentW
  const scaleH = MIN_CHAR_HEIGHT / cropH
  const scale  = Math.max(scaleW, scaleH)
  let scaledW  = Math.round(contentW * scale)
  let scaledH  = Math.round(cropH * scale)

  let charLayerBuf = await sharp(portraitBuf)
    .extract(cropRegion)
    .resize(scaledW, scaledH, { fit: 'fill' })
    .ensureAlpha()
    .toBuffer()

  // If the scaled sprite overflows the canvas, crop to fit. The circle mask
  // would hide anything outside the circle anyway, so no visible loss.
  if (scaledW > CANVAS) {
    const trimLeft = Math.round((scaledW - CANVAS) / 2)
    charLayerBuf = await sharp(charLayerBuf)
      .extract({ left: trimLeft, top: 0, width: CANVAS, height: scaledH })
      .toBuffer()
    scaledW = CANVAS
  }
  if (scaledH > CANVAS - TOP_PADDING) {
    charLayerBuf = await sharp(charLayerBuf)
      .extract({ left: 0, top: 0, width: scaledW, height: CANVAS - TOP_PADDING })
      .toBuffer()
    scaledH = CANVAS - TOP_PADDING
  }

  // Make character pixels fully opaque — portrait PNGs have semi-transparent
  // soft edges that make the art look washed out over the dark background.
  const charLayer = await normalizeAlpha(charLayerBuf)

  // Character top at TOP_PADDING; centered horizontally.
  const charLeft = Math.round((CANVAS - scaledW) / 2)
  const charTop  = TOP_PADDING

  // ── Compositing layers ───────────────────────────────────────────────────

  // 1. Dark filled circle background
  const bgSvg = Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${CIRCLE_CX}" cy="${CIRCLE_CY}" r="${CIRCLE_R}" fill="${BG_COLOR}"/>
    </svg>`
  )

  // 2. SVG mask for the character art:
  //    - Fully visible above the circle center (lets head extend freely)
  //    - Clipped to the circle below that line
  //    Sharp's `composite` with `blend: 'dest-in'` uses the mask's alpha to cut
  //    the character. We build a white-on-black mask PNG.
  const maskSvg = Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${CANVAS}" height="${CIRCLE_CY}" fill="white"/>
      <circle cx="${CIRCLE_CX}" cy="${CIRCLE_CY}" r="${CIRCLE_R}" fill="white"/>
    </svg>`
  )

  // Position the character layer on a transparent CANVAS x CANVAS canvas,
  // then apply the mask so the lower body is clipped to the circle.
  const charOnCanvas = await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: charLayer, left: charLeft, top: charTop }])
    .png()
    .toBuffer()

  const maskPng = await sharp(maskSvg).resize(CANVAS, CANVAS).png().toBuffer()

  const maskedChar = await sharp(charOnCanvas)
    .composite([{ input: maskPng, blend: 'dest-in' }])
    .png()
    .toBuffer()

  // 3. Border ring — split into two halves so the character sits "inside" the ring:
  //    top half is behind the character (head extends above it freely),
  //    bottom half is in front of the character (ring passes over the body).
  const ringR = CIRCLE_R - BORDER_WIDTH / 2
  const ringAttrs = `cx="${CIRCLE_CX}" cy="${CIRCLE_CY}" r="${ringR}" fill="none" stroke="${BORDER_COLOR}" stroke-width="${BORDER_WIDTH}"`

  const ringTopSvg = Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id="t"><rect x="0" y="0" width="${CANVAS}" height="${CIRCLE_CY}"/></clipPath></defs>
      <circle ${ringAttrs} clip-path="url(#t)"/>
    </svg>`
  )
  const ringBottomSvg = Buffer.from(
    `<svg width="${CANVAS}" height="${CANVAS}" xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id="b"><rect x="0" y="${CIRCLE_CY}" width="${CANVAS}" height="${CANVAS - CIRCLE_CY}"/></clipPath></defs>
      <circle ${ringAttrs} clip-path="url(#b)"/>
    </svg>`
  )

  // Composite: bg → top ring half → character → bottom ring half
  const result = await sharp({
    create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([
      { input: bgSvg },
      { input: ringTopSvg },
      { input: maskedChar },
      { input: ringBottomSvg },
    ])
    .png()
    .toBuffer()

  return result
}

// ── Process one trainee ───────────────────────────────────────────────────────

async function processTrainee(
  trainee: { id: number; name: string }
): Promise<{ generated: number; skipped: number; errors: number }> {
  let generated = 0, skipped = 0, errors = 0
  const outPath = iconStoragePath(trainee.id)

  try {
    if (!force && await fileExists(outPath)) {
      skipped++
      return { generated, skipped, errors }
    }

    const portraitBuf = await downloadFromStorage(portraitStoragePath(trainee.id))
    const iconBuf     = await generateIcon(portraitBuf)

    if (debug) {
      writeFileSync(`debug-icons/${trainee.id}_${trainee.name.replace(/\s+/g, '_')}.png`, iconBuf)
    }

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(outPath, iconBuf, { contentType: 'image/png', upsert: true })
    if (uploadErr) throw new Error(uploadErr.message)

    const { error: dbErr } = await supabase
      .from('trainees')
      .update({ icon_path: outPath })
      .eq('id', trainee.id)
    if (dbErr) throw new Error(`DB update: ${dbErr.message}`)

    generated++
  } catch (err) {
    errors++
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`\n  ✗ ${trainee.name} (${trainee.id}): ${message}\n`)
  }

  return { generated, skipped, errors }
}

// ── Concurrent runner ─────────────────────────────────────────────────────────

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0
  async function next(): Promise<void> {
    if (i >= items.length) return
    const item = items[i++]
    await fn(item)
    await new Promise(r => setTimeout(r, DELAY_MS))
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next))
}

// ── Main ──────────────────────────────────────────────────────────────────────

const idArg = process.argv.find(a => /^\d{6}$/.test(a))

let query = supabase.from('trainees').select('id, name').not('gametora_slug', 'is', null).order('id')
if (idArg) query = query.eq('id', Number(idArg))

const { data: trainees, error: fetchErr } = await query
if (fetchErr) { console.error('Fetch trainees:', fetchErr.message); process.exit(1) }
if (!trainees || trainees.length === 0) { console.error('No trainees found'); process.exit(1) }

const scope = idArg ? `trainee ${idArg}` : `${trainees.length} trainees`
console.log(`Generating icons for ${scope}${force ? ' (force re-generate)' : ' (skipping existing)'}…`)
if (debug) console.log('  Debug mode: saving PNGs to ./debug-icons/')
console.log(`Concurrency: ${CONCURRENCY}, delay: ${DELAY_MS}ms\n`)

let totalGenerated = 0, totalSkipped = 0, totalErrors = 0, done = 0

await runConcurrent(trainees, CONCURRENCY, async (trainee) => {
  const { generated, skipped, errors } = await processTrainee(trainee)
  totalGenerated += generated
  totalSkipped   += skipped
  totalErrors    += errors
  done++
  process.stdout.write(
    `\r  ${done}/${trainees.length}  generated: ${totalGenerated}  skipped: ${totalSkipped}  errors: ${totalErrors}  `
  )
})

console.log(`\n\nDone.`)
console.log(`  ${totalGenerated} icons generated and uploaded`)
console.log(`  ${totalSkipped} skipped (already exist)`)
if (totalErrors > 0) console.log(`  ${totalErrors} errors (see above)`)
