/**
 * Gametora Support Card Skills Scraper (JSON-based, no DOM navigation)
 *
 * Run this script in the browser console while on any gametora.com page.
 * It fetches card data via Next.js data routes + the skills JSON database,
 * resolves skill IDs to names, and writes everything to the local Supabase.
 *
 * Usage:
 *   1. Open https://gametora.com in Chrome
 *   2. Open DevTools console (F12 → Console)
 *   3. Paste this entire script and press Enter
 *   4. Call: await scrapeAll()           — scrape all cards (skips already-done)
 *      or:  await scrapeAll(10)          — scrape first 10 unscraped
 *      or:  await scrapeOne('30086-narita-top-road')  — scrape one card
 */

const SUPABASE_URL = 'http://100.107.208.97:54321';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const HINT_TYPE_MAP = { 1: 'Speed', 2: 'Stamina', 3: 'Power', 4: 'Guts', 5: 'Wisdom' };

// ── Globals (loaded once) ───────────────────────────────────────────────
let _buildId = null;
let _skillMap = null; // id → { name, description, icon_url }

async function getBuildId() {
  if (_buildId) return _buildId;
  const nd = document.getElementById('__NEXT_DATA__');
  if (nd) {
    _buildId = JSON.parse(nd.textContent).buildId;
    return _buildId;
  }
  // Fallback: fetch main page and parse
  const html = await (await fetch('https://gametora.com/umamusume')).text();
  const m = html.match(/"buildId":"([^"]+)"/);
  if (!m) throw new Error('Could not find buildId');
  _buildId = m[1];
  return _buildId;
}

async function getSkillMap() {
  if (_skillMap) return _skillMap;
  console.log('Loading skills database...');
  const resp = await fetch('https://gametora.com/data/umamusume/skills.5d6eddd9.json');
  const skills = await resp.json();

  _skillMap = {};
  for (const s of skills) {
    const iconUrl = s.iconid
      ? `https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_${s.iconid}.png`
      : null;
    _skillMap[s.id] = {
      name: s.name_en || s.enname || s.jpname,
      description: s.desc_en || s.endesc || null,
      icon_url: iconUrl,
    };
    // Also index gene_version (lower rarity skills)
    if (s.gene_version) {
      const gv = s.gene_version;
      const gvIcon = gv.iconid
        ? `https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_${gv.iconid}.png`
        : iconUrl;
      _skillMap[gv.id] = {
        name: gv.name_en || s.enname || s.jpname,
        description: gv.desc_en || s.desc_en || null,
        icon_url: gvIcon,
      };
    }
  }
  console.log(`  Loaded ${Object.keys(_skillMap).length} skills`);
  return _skillMap;
}

// ── Supabase helpers ────────────────────────────────────────────────────
async function sbFetch(table, method, body, params = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (method === 'POST') headers['Prefer'] = 'resolution=merge-duplicates';
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase ${method} ${table}: ${resp.status} ${text}`);
  }
  const ct = resp.headers.get('content-type');
  return ct?.includes('json') ? resp.json() : null;
}

async function getAllCardSlugs() {
  return sbFetch('support_cards', 'GET', null,
    '?select=id,gametora_slug&gametora_slug=not.is.null&order=id.asc&limit=1000');
}

async function getAlreadyScrapedIds() {
  const [hints, events] = await Promise.all([
    sbFetch('support_card_hints', 'GET', null, '?select=card_id&limit=10000'),
    sbFetch('support_card_training_events', 'GET', null, '?select=card_id&limit=10000'),
  ]);
  const ids = new Set();
  hints.forEach(r => ids.add(r.card_id));
  events.forEach(r => ids.add(r.card_id));
  return ids;
}

// ── Fetch card data from Next.js data route ─────────────────────────────
async function fetchCardData(slug) {
  const buildId = await getBuildId();
  const url = `https://gametora.com/_next/data/${buildId}/umamusume/supports/${slug}.json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${slug}: ${resp.status}`);
  return resp.json();
}

// ── Parse card data from JSON ───────────────────────────────────────────
function parseCardData(cardId, pageData) {
  const skillMap = _skillMap;
  const { itemData, eventData } = pageData.pageProps;

  // ── Hint skills ──
  const hintSkillIds = itemData.hints?.hint_skills || [];
  const hints = hintSkillIds.map((id, i) => {
    const skill = skillMap[id];
    if (!skill) {
      console.warn(`    Unknown hint skill ID: ${id}`);
      return null;
    }
    return {
      card_id: cardId,
      name: skill.name,
      description: skill.description,
      icon_url: skill.icon_url,
      sort_order: i,
    };
  }).filter(Boolean);

  // ── Hint stat gains ──
  const hintOthers = itemData.hints?.hint_others || [];
  let hintStatGains = null;
  if (hintOthers.length) {
    const gains = {};
    hintOthers.forEach(h => {
      const statName = HINT_TYPE_MAP[h.hint_type];
      if (statName) gains[statName] = h.hint_value;
    });
    if (Object.keys(gains).length) hintStatGains = gains;
  }

  // ── Event skills ──
  const eventSkillIds = itemData.event_skills || [];
  const eventSkills = eventSkillIds.map((id, i) => {
    const skill = skillMap[id];
    if (!skill) {
      console.warn(`    Unknown event skill ID: ${id}`);
      return null;
    }
    return {
      card_id: cardId,
      name: skill.name,
      description: skill.description,
      icon_url: skill.icon_url,
      sort_order: i,
    };
  }).filter(Boolean);

  // ── Training events ──
  const trainingEvents = [];
  if (eventData?.en) {
    let enData = eventData.en;
    if (typeof enData === 'string') enData = JSON.parse(enData);

    let sortIdx = 0;

    // Chain events (arrows)
    const arrows = enData.arrows || [];
    arrows.forEach(ev => {
      // arrows entries have levels indicated by nesting or index
      // Each arrow entry: { i, n, c } where n is the name
      trainingEvents.push({
        card_id: cardId,
        name: ev.n,
        event_type: 'chain',
        chain_level: null, // We'll set this below
        sort_order: sortIdx++,
      });
    });

    // Assign chain levels: arrows are in order, level = position in chain (1, 2, 3, ...)
    // They're typically grouped as sequential chain steps
    if (arrows.length > 0) {
      for (let i = 0; i < arrows.length; i++) {
        trainingEvents[i].chain_level = i + 1;
      }
    }

    // Random events
    const random = enData.random || [];
    random.forEach(ev => {
      trainingEvents.push({
        card_id: cardId,
        name: ev.n,
        event_type: 'random',
        chain_level: null,
        sort_order: sortIdx++,
      });
    });
  }

  return { hints, eventSkills, trainingEvents, hintStatGains };
}

// ── Save to Supabase ────────────────────────────────────────────────────
async function saveToSupabase(cardId, data) {
  // Delete existing data for this card
  await Promise.all([
    sbFetch('support_card_hints', 'DELETE', null, `?card_id=eq.${cardId}`),
    sbFetch('support_card_event_skills', 'DELETE', null, `?card_id=eq.${cardId}`),
    sbFetch('support_card_training_events', 'DELETE', null, `?card_id=eq.${cardId}`),
  ]);

  // Insert new data
  const inserts = [];
  if (data.hints.length) {
    inserts.push(sbFetch('support_card_hints', 'POST', data.hints));
  }
  if (data.eventSkills.length) {
    inserts.push(sbFetch('support_card_event_skills', 'POST', data.eventSkills));
  }
  if (data.trainingEvents.length) {
    inserts.push(sbFetch('support_card_training_events', 'POST', data.trainingEvents));
  }
  if (data.hintStatGains) {
    inserts.push(sbFetch('support_cards', 'PATCH',
      { hint_stat_gains: data.hintStatGains },
      `?id=eq.${cardId}`));
  }
  await Promise.all(inserts);
}

// ── Scrape one card ─────────────────────────────────────────────────────
async function scrapeOne(slug, cardId) {
  if (!cardId) {
    const cards = await getAllCardSlugs();
    const card = cards.find(c => c.gametora_slug === slug);
    if (!card) throw new Error(`Card not found for slug: ${slug}`);
    cardId = card.id;
  }

  await getSkillMap(); // Ensure loaded
  const pageData = await fetchCardData(slug);
  const data = parseCardData(cardId, pageData);

  console.log(`  ${data.hints.length} hints, ${data.eventSkills.length} event skills, ${data.trainingEvents.length} training events`);
  await saveToSupabase(cardId, data);
  return data;
}

// ── Scrape all cards ────────────────────────────────────────────────────
async function scrapeAll(limit, { skipExisting = true } = {}) {
  await getSkillMap(); // Load once

  const cards = await getAllCardSlugs();
  console.log(`Found ${cards.length} cards with slugs`);

  let alreadyDone = new Set();
  if (skipExisting) {
    alreadyDone = await getAlreadyScrapedIds();
    console.log(`${alreadyDone.size} cards already scraped (skipping)`);
  }

  const toScrape = cards
    .filter(c => !alreadyDone.has(c.id))
    .slice(0, limit || Infinity);
  console.log(`Scraping ${toScrape.length} cards...`);

  let success = 0, errors = 0;
  for (let i = 0; i < toScrape.length; i++) {
    const card = toScrape[i];
    try {
      console.log(`[${i + 1}/${toScrape.length}] ${card.gametora_slug}`);
      const pageData = await fetchCardData(card.gametora_slug);
      const data = parseCardData(card.id, pageData);
      console.log(`  ${data.hints.length} hints, ${data.eventSkills.length} ev skills, ${data.trainingEvents.length} events`);
      await saveToSupabase(card.id, data);
      success++;
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      errors++;
    }
    // Rate limit: 200ms between requests
    if (i < toScrape.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`\nDone! ${success} succeeded, ${errors} failed out of ${toScrape.length}`);
  return { success, errors, total: toScrape.length };
}

console.log('🎯 Skills Scraper loaded! Commands:');
console.log('  await scrapeAll()        — scrape all unscraped cards');
console.log('  await scrapeAll(10)      — scrape first 10 unscraped');
console.log('  await scrapeOne("30086-narita-top-road")  — scrape one card');
