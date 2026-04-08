export type Factor =
  | { type: 'BlueStat'; stat_index: number; stars: number }
  | { type: 'UniqueSkill'; skill_id: number; stars: number }
  | { type: 'SkillHint'; skill_id: number; stars: number }
  | { type: 'RaceBonus'; race_name: string; stars: number }
  | { type: 'Scenario'; name: string; stars: number }
  | { type: 'Aptitude'; apt_name: string; stars: number }

import type { SparkAffinityLevel } from '../../lib/successionAffinity'

export type { SparkAffinityLevel }

export interface LegacyMember {
  name: string
  factors: Factor[]
  trainee_id?: number | null
  /** Per-member mid-run spark rate; set from succession data vs runner trainee when sending to API. */
  spark_affinity?: SparkAffinityLevel | null
}

export interface LegacySlot {
  parent: LegacyMember
  grandparent_1: LegacyMember
  grandparent_2: LegacyMember
}

export interface LegacyTree {
  legacy_1: LegacySlot
  legacy_2: LegacySlot
}

export interface RaceOption {
  id: number
  name_en: string
}

/** One possible green unique for a trainee (star-rank gate from DB). */
export interface TraineeUniqueSkillOption {
  skill_id: number
  min_star_rank: number
  sort_order: number
  name: string
}

/** Stable empty list for React props (avoid `?? []` allocating a new array each render). */
export const EMPTY_TRAINEE_UNIQUE_OPTIONS: TraineeUniqueSkillOption[] = []
