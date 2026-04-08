import { normalizeLegacyTree } from '../pages/career/legacyNormalize'
import type { LegacyMember, LegacyTree } from '../pages/career/legacyTypes'

const STORAGE_KEY = 'umamusume:careerSimulator:v1'

function emptyMember(): LegacyMember {
  return { name: '', factors: [], trainee_id: null }
}

function emptyLegacyTree(): LegacyTree {
  return {
    legacy_1: { parent: emptyMember(), grandparent_1: emptyMember(), grandparent_2: emptyMember() },
    legacy_2: { parent: emptyMember(), grandparent_1: emptyMember(), grandparent_2: emptyMember() },
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x)
}

function coerceDeck(x: unknown): (number | null)[] | null {
  if (!Array.isArray(x) || x.length !== 6) return null
  const out: (number | null)[] = []
  for (const e of x) {
    if (e === null) out.push(null)
    else if (typeof e === 'number' && Number.isInteger(e)) out.push(e)
    else return null
  }
  return out
}

function coerceLevels(x: unknown): number[] | null {
  if (!Array.isArray(x) || x.length !== 6) return null
  for (const e of x) {
    if (typeof e !== 'number' || !Number.isFinite(e)) return null
  }
  return x.map(e => Math.round(e))
}

function coerceLegacy(x: unknown): LegacyTree {
  if (!isRecord(x)) return emptyLegacyTree()
  try {
    // Plain JSON clone: survives Supabase JSONB / odd prototypes; `normalizeLegacyTree` fills missing slots/members.
    return normalizeLegacyTree(JSON.parse(JSON.stringify(x)) as LegacyTree)
  }
  catch {
    return emptyLegacyTree()
  }
}

function coerceScenario(x: unknown): string {
  if (typeof x === 'string' && /^(ura_finals|unity_cup|trackblazer)$/.test(x)) return x
  return 'ura_finals'
}

function coerceInitialState(x: unknown): unknown | null {
  if (x == null) return null
  if (!isRecord(x)) return null
  if (!isRecord(x.stats) || !isRecord(x.base_stats)) return null
  const s = x.stats as Record<string, unknown>
  if (typeof s.speed !== 'number' || typeof s.wisdom !== 'number') return null
  return x
}

export type CareerSimulatorPersisted = {
  scenario: string
  traineeId: number | null
  starRank: number
  potentialLevel: number
  deck: (number | null)[]
  deckLevels: number[]
  legacy: LegacyTree
  initialState: unknown | null
}

function parseCareerSimulatorPayloadRecord(p: Record<string, unknown>): CareerSimulatorPersisted | null {
  const deck = coerceDeck(p.deck)
  const deckLevels = coerceLevels(p.deckLevels)
  if (!deck || !deckLevels) return null
  const tid = p.traineeId
  const traineeId = tid === null || typeof tid === 'number' ? tid : null
  const star = p.starRank
  const pot = p.potentialLevel
  return {
    scenario: coerceScenario(p.scenario),
    traineeId,
    starRank: typeof star === 'number' && star >= 1 && star <= 5 ? Math.round(star) : 5,
    potentialLevel: typeof pot === 'number' && pot >= 1 && pot <= 5 ? Math.round(pot) : 5,
    deck,
    deckLevels,
    legacy: coerceLegacy(p.legacy),
    initialState: coerceInitialState(p.initialState),
  }
}

/** Parse JSON from DB or import (no `v` wrapper required). */
export function parseCareerSimulatorPayload(p: unknown): CareerSimulatorPersisted | null {
  if (!isRecord(p)) return null
  return parseCareerSimulatorPayloadRecord(p)
}

export function loadCareerSimulatorPersisted(): CareerSimulatorPersisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as unknown
    if (!isRecord(p) || p.v !== 1) return null
    return parseCareerSimulatorPayloadRecord(p)
  }
  catch {
    return null
  }
}

export function saveCareerSimulatorPersisted(data: CareerSimulatorPersisted): void {
  try {
    const payload = {
      v: 1 as const,
      scenario: data.scenario,
      traineeId: data.traineeId,
      starRank: data.starRank,
      potentialLevel: data.potentialLevel,
      deck: data.deck,
      deckLevels: data.deckLevels,
      legacy: data.legacy,
      initialState: data.initialState,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }
  catch {
    /* quota, private mode */
  }
}

export function clearCareerSimulatorPersisted(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  }
  catch {
    /* ignore */
  }
}
