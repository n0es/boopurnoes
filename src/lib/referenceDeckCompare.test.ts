import { describe, expect, it } from 'vitest'
import type { MantReferenceDeck } from '../data/mantReferenceDecks'
import type { DeckSolution } from './deckBuilderSolver'
import {
  compareReferenceToSolution,
  compareTypePattern,
  effectDeltas,
  jaccardCardOverlap,
} from './referenceDeckCompare'

function mockSolution(partial: Partial<DeckSolution> & Pick<DeckSolution, 'owned' | 'wildcard' | 'total'>): DeckSolution {
  return {
    upgradeHints: [],
    rankScore: 0,
    typeCounts: {},
    ...partial,
  }
}

const refSpeedWit: MantReferenceDeck = {
  id: 'test',
  label: 'test',
  scenario: 'twinkle-star-climax',
  typePattern: { speed: 2, intelligence: 2, power: 2 },
  source: { name: 't', url: 'https://example.com', asOf: '2026-01-01' },
}

describe('compareTypePattern', () => {
  it('returns distance 0 on exact match', () => {
    const r = compareTypePattern({ speed: 2, intelligence: 2, power: 2 }, refSpeedWit)
    expect(r.patternDistance).toBe(0)
  })

  it('sums absolute differences', () => {
    const r = compareTypePattern({ speed: 3, intelligence: 2, power: 1 }, refSpeedWit)
    expect(r.patternDistance).toBe(2)
  })
})

describe('jaccardCardOverlap', () => {
  it('is 1 when sets match', () => {
    const sol = mockSolution({
      owned: [
        { cardId: 1, name: 'a', rarity: 'SSR', card_type: 'speed', level: 50, uncap: 4, effects: [] },
        { cardId: 2, name: 'b', rarity: 'SSR', card_type: 'speed', level: 50, uncap: 4, effects: [] },
        { cardId: 3, name: 'c', rarity: 'SSR', card_type: 'intelligence', level: 50, uncap: 4, effects: [] },
        { cardId: 4, name: 'd', rarity: 'SSR', card_type: 'intelligence', level: 50, uncap: 4, effects: [] },
        { cardId: 5, name: 'e', rarity: 'SSR', card_type: 'power', level: 50, uncap: 4, effects: [] },
      ],
      wildcard: { cardId: 6, name: 'f', rarity: 'SSR', card_type: 'power', effects: [] },
      total: {},
    })
    const j = jaccardCardOverlap(sol, [1, 2, 3, 4, 5, 6])
    expect(j.jaccard).toBe(1)
    expect(j.intersectionSize).toBe(6)
    expect(j.unionSize).toBe(6)
  })
})

describe('effectDeltas', () => {
  it('computes reference minus solution', () => {
    const rows = effectDeltas({ 15: 60 }, { 15: 50 })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.delta).toBe(10)
  })
})

describe('compareReferenceToSolution', () => {
  it('combines pattern and jaccard when card ids provided', () => {
    const ref: MantReferenceDeck = {
      ...refSpeedWit,
      cardIds: [10, 20, 30, 40, 50, 60],
    }
    const sol = mockSolution({
      owned: [
        { cardId: 10, name: 'a', rarity: 'SSR', card_type: 'speed', level: 50, uncap: 4, effects: [] },
        { cardId: 20, name: 'b', rarity: 'SSR', card_type: 'speed', level: 50, uncap: 4, effects: [] },
        { cardId: 30, name: 'c', rarity: 'SSR', card_type: 'intelligence', level: 50, uncap: 4, effects: [] },
        { cardId: 40, name: 'd', rarity: 'SSR', card_type: 'intelligence', level: 50, uncap: 4, effects: [] },
        { cardId: 50, name: 'e', rarity: 'SSR', card_type: 'power', level: 50, uncap: 4, effects: [] },
      ],
      wildcard: { cardId: 60, name: 'f', rarity: 'SSR', card_type: 'power', effects: [] },
      total: { 15: 55 },
      typeCounts: { speed: 2, intelligence: 2, power: 2 },
    })
    const c = compareReferenceToSolution(ref, sol, { referenceEffectTotal: { 15: 60 } })
    expect(c.typePattern.patternDistance).toBe(0)
    expect(c.cards?.jaccard).toBe(1)
    expect(c.effectDeltas?.find(d => d.effectTypeId === 15)?.delta).toBe(5)
  })
})
