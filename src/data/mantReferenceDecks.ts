/**
 * Curated MANT / Twinkle Star Climax reference templates from community guides.
 * For tooling, tests, and non-UI regression — not live-scraped. Update sources when meta shifts.
 */

import type { ScenarioSlug } from '../lib/deckBuilderRecommendedTargets'

/** Training-type keys aligned with `DeckSolution.typeCounts` / DB `card_type`. */
export type SupportTypeKey = 'speed' | 'stamina' | 'power' | 'guts' | 'intelligence' | 'friend' | 'group'

export interface MantReferenceSource {
  name: string
  url: string
  /** ISO date string (guide last updated or our capture date) */
  asOf: string
  notes?: string
}

export interface MantReferenceDeck {
  id: string
  label: string
  scenario: ScenarioSlug
  /**
   * Intended type counts (six cards). Omit keys that are zero.
   * Framework-only entries still carry a pattern for distance vs concrete lists.
   */
  typePattern: Partial<Record<SupportTypeKey, number>>
  /** Minimum race bonus % cited by the guide (deck aggregate), if stated */
  minRaceBonusPct?: number
  /** "Ideal" / MLB race bonus % from guides, if stated */
  idealRaceBonusPct?: number
  source: MantReferenceSource
  /**
   * Concrete support card ids (this DB) when the guide names a six-card team.
   * Variants pick one banner id per character for stable comparison.
   */
  cardIds?: number[]
}

export const MANT_REFERENCE_DECKS: MantReferenceDeck[] = [
  {
    id: 'uma-guide-speed-wit-power-flex',
    label: 'uma.guide — Speed + Wit (+2 Power flex)',
    scenario: 'twinkle-star-climax',
    typePattern: { speed: 2, intelligence: 2, power: 2 },
    minRaceBonusPct: 50,
    source: {
      name: 'uma.guide Trackblazer (MANT)',
      url: 'https://uma.guide/guides/trackblazer',
      asOf: '2026-04-05',
      notes: 'Framework: 2 Speed + 2 Wit; flex often two Power cards.',
    },
  },
  {
    id: 'uma-guide-wit-guts',
    label: 'uma.guide — Wit + Guts (3+2 + flex)',
    scenario: 'twinkle-star-climax',
    typePattern: { guts: 3, intelligence: 2, speed: 1 },
    minRaceBonusPct: 50,
    source: {
      name: 'uma.guide Trackblazer (MANT)',
      url: 'https://uma.guide/guides/trackblazer',
      asOf: '2026-04-05',
      notes: '3 Guts + 2 Wit + fourth Guts or Speed depending on needs.',
    },
  },
  {
    id: 'gamesgg-nishino-speed-wit',
    label: 'GAMES.GG — 2 Speed / 3 Wit / 1 Power (Nishino Flower MANT)',
    scenario: 'twinkle-star-climax',
    typePattern: { speed: 2, intelligence: 3, power: 1 },
    minRaceBonusPct: 50,
    idealRaceBonusPct: 65,
    cardIds: [
      30028, // Kitasan Black SSR
      30015, // Sakura Bakushin O SSR
      30032, // Yaeno Muteki SSR
      30054, // Nice Nature SSR
      30010, // Fine Motion SSR
      20079, // Marvelous Sunday SR (filler)
    ],
    source: {
      name: 'GAMES.GG Nishino Flower build (Trackblazer)',
      url: 'https://games.gg/umamusume-pretty-derby/guides/umamusume-pretty-derby-nishino-flower-build-guide/',
      asOf: '2026-04-09',
    },
  },
  {
    id: 'altema-mant-ug-1',
    label: 'Altema — MANT UG example (1 Spd / 2 Wit / 3 Guts)',
    scenario: 'twinkle-star-climax',
    typePattern: { speed: 1, intelligence: 2, guts: 3 },
    cardIds: [
      30078, // Matikanefukukitaru
      30010, // Fine Motion
      30054, // Nice Nature
      30019, // Haru Urara
      30030, // Matikanetannhauser
      30063, // Ikuno Dictus
    ],
    source: {
      name: 'アルテマ UG / MANT',
      url: 'https://altema.jp/umamusume/ugrank',
      asOf: '2024-01-11',
      notes: 'JP guide; card pool may have shifted — use as secondary pattern.',
    },
  },
  {
    id: 'altema-mant-ug-2',
    label: 'Altema — MANT UG example (2 Wit / 4 Guts)',
    scenario: 'twinkle-star-climax',
    typePattern: { intelligence: 2, guts: 4 },
    cardIds: [
      30010, // Fine Motion
      30054, // Nice Nature
      30019, // Haru Urara
      30048, // Mejiro Ryan
      30011, // Ines Fujin
      30063, // Ikuno Dictus
    ],
    source: {
      name: 'アルテマ UG / MANT',
      url: 'https://altema.jp/umamusume/ugrank',
      asOf: '2024-01-11',
      notes: 'JP guide; card pool may have shifted — use as secondary pattern.',
    },
  },
]

export function mantReferenceDecksForScenario(scenario: ScenarioSlug): MantReferenceDeck[] {
  return MANT_REFERENCE_DECKS.filter(d => d.scenario === scenario)
}

export function getMantReferenceDeckById(id: string): MantReferenceDeck | undefined {
  return MANT_REFERENCE_DECKS.find(d => d.id === id)
}
