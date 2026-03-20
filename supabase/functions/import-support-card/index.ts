import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ── Effect type metadata ─────────────────────────────────────────────
const EFFECT_TYPES: Record<number, { name: string; symbol: string; calc?: string }> = {
  1:  { name: "Friendship Bonus",       symbol: "percent", calc: "mult" },
  2:  { name: "Mood Effect",            symbol: "percent" },
  3:  { name: "Speed Bonus",            symbol: "none" },
  4:  { name: "Stamina Bonus",          symbol: "none" },
  5:  { name: "Power Bonus",            symbol: "none" },
  6:  { name: "Guts Bonus",             symbol: "none" },
  7:  { name: "Wit Bonus",              symbol: "none" },
  8:  { name: "Training Effectiveness", symbol: "percent" },
  9:  { name: "Initial Speed",          symbol: "none" },
  10: { name: "Initial Stamina",        symbol: "none" },
  11: { name: "Initial Power",          symbol: "none" },
  12: { name: "Initial Guts",           symbol: "none" },
  13: { name: "Initial Wit",            symbol: "none" },
  14: { name: "Initial Friendship Gauge", symbol: "none" },
  15: { name: "Race Bonus",             symbol: "percent" },
  16: { name: "Fan Bonus",              symbol: "percent" },
  17: { name: "Hint Levels",            symbol: "level" },
  18: { name: "Hint Frequency",         symbol: "percent" },
  19: { name: "Specialty Priority",     symbol: "none", calc: "add" },
  20: { name: "Max Speed",              symbol: "none" },
  21: { name: "Max Stamina",            symbol: "none" },
  22: { name: "Max Power",              symbol: "none" },
  23: { name: "Max Guts",               symbol: "none" },
  24: { name: "Max Wit",                symbol: "none" },
  25: { name: "Event Recovery",         symbol: "percent" },
  26: { name: "Event Effectiveness",    symbol: "percent" },
  27: { name: "Failure Protection",     symbol: "percent", calc: "mult" },
  28: { name: "Energy Cost Reduction",  symbol: "percent", calc: "mult" },
  29: { name: "Minigame Effectiveness", symbol: "percent" },
  30: { name: "Skill Point Bonus",      symbol: "none" },
  31: { name: "Wit Friendship Recovery", symbol: "none" },
  32: { name: "Initial Skill Points",   symbol: "none" },
  33: { name: "Hint Quantity Bonus",    symbol: "none" },
  41: { name: "All Stats Bonus",        symbol: "none" },
};

// ── Gametora's exact interpolation algorithm (reverse-engineered) ────
function interpolateEffect(effectArray: number[]): {
  type: number;
  unlock_level: number;
  effectAtLevel: number[];
} {
  const n: (number | null)[] = Array(51).fill(null);
  const a = effectArray.slice(1); // remove type ID
  let unlockLevel = -1;
  let lastVal = -1;
  let lastIdx = -1;

  for (let e = 0; e < a.length; e++) {
    if (a[e] === -1 && lastVal === -1) {
      for (let x = 5 * e; x < (e + 1) * 5 - 1; x++) n[x] = 0;
      continue;
    }
    if (a[e] !== -1 && unlockLevel === -1) {
      unlockLevel = e > 0 ? 5 * e : 1;
      n[5 * e] = a[e];
      lastVal = a[e];
      lastIdx = e;
      continue;
    }
    if (a[e] === -1) continue;

    const slope =
      lastIdx === 0
        ? (a[e] - lastVal) / (5 * e - 5 * lastIdx - 1)
        : (a[e] - lastVal) / (5 * e - 5 * lastIdx);
    let running = lastVal;
    for (let x = 5 * lastIdx + 1; x < 5 * e; x++) {
      if (x === 1) {
        n[x] = lastVal;
        x = 2;
      }
      running += slope;
      n[x] = Math.floor(parseFloat(running.toFixed(10)));
    }
    n[5 * e] = a[e];
    lastVal = a[e];
    lastIdx = e;
  }

  let fill = 0;
  for (let e = 0; e < 51; e++) {
    if (n[e] == null) n[e] = fill;
    else fill = n[e] as number;
  }

  return {
    type: effectArray[0],
    unlock_level: unlockLevel,
    effectAtLevel: n as number[],
  };
}

// ── Extract slug from Gametora URL ───────────────────────────────────
function extractSlug(url: string): string {
  const match = url.match(/\/supports\/([a-z0-9-]+)/i);
  if (!match) throw new Error(`Invalid Gametora support card URL: ${url}`);
  return match[1];
}

// ── Main handler ─────────────────────────────────────────────────────
serve(async (req: Request) => {
  // CORS headers for your Vite app
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url) throw new Error("Missing 'url' in request body");

    const slug = extractSlug(url);
    const gametoraUrl = `https://gametora.com/umamusume/supports/${slug}`;

    // ── Fetch the Gametora page ──────────────────────────────────
    console.log(`Fetching: ${gametoraUrl}`);
    const pageResp = await fetch(gametoraUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; UmaSimBot/1.0)" },
    });
    if (!pageResp.ok) throw new Error(`Gametora returned ${pageResp.status}`);
    const html = await pageResp.text();

    // ── Extract __NEXT_DATA__ ────────────────────────────────────
    const nextDataMatch = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (!nextDataMatch) throw new Error("Could not find __NEXT_DATA__ in page");

    const nextData = JSON.parse(nextDataMatch[1]);
    const itemData = nextData.props?.pageProps?.itemData;
    if (!itemData) throw new Error("No itemData found in page props");

    // ── Parse card data ──────────────────────────────────────────
    const rarityMap: Record<number, string> = { 1: "R", 2: "SR", 3: "SSR" };

    const cardRow = {
      id: itemData.support_id,
      name: itemData.char_name,
      name_jp: itemData.name_jp || null,
      rarity: rarityMap[itemData.rarity] || String(itemData.rarity),
      card_type: itemData.type,
      unique_effect: itemData.unique || null,
      hints: itemData.hints || null,
      event_skills: itemData.event_skills || null,
      gametora_slug: slug,
    };

    // ── Interpolate effects ──────────────────────────────────────
    const effectRows = itemData.effects.map((eff: number[]) => {
      const interp = interpolateEffect(eff);
      const meta = EFFECT_TYPES[interp.type] || {
        name: `Unknown #${interp.type}`,
        symbol: "none",
      };
      return {
        card_id: itemData.support_id,
        effect_type_id: interp.type,
        effect_name: meta.name,
        symbol: meta.symbol,
        calc_type: meta.calc || null,
        unlock_level: interp.unlock_level,
        values_by_level: interp.effectAtLevel,
      };
    });

    // ── Insert into Supabase ─────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Upsert card (so re-importing updates instead of failing)
    const { error: cardError } = await supabase
      .from("support_cards")
      .upsert(cardRow, { onConflict: "id" });
    if (cardError) throw new Error(`Card insert failed: ${cardError.message}`);

    // Delete old effects then insert fresh (cleanest for upsert)
    await supabase
      .from("support_card_effects")
      .delete()
      .eq("card_id", itemData.support_id);

    const { error: effectError } = await supabase
      .from("support_card_effects")
      .insert(effectRows);
    if (effectError) throw new Error(`Effects insert failed: ${effectError.message}`);

    // ── Return result ────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        success: true,
        card: cardRow,
        effects_count: effectRows.length,
        effects: effectRows.map((e: any) => ({
          name: e.effect_name,
          unlock_level: e.unlock_level,
          value_at_50: e.values_by_level[50],
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Error:", err.message);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});