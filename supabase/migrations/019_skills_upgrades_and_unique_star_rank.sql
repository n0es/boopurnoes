-- ============================================================
-- Migration 019: Skills upgrade relationships + unique skill star rank
-- ============================================================

-- Add upgrade relationship to skills table
ALTER TABLE skills ADD COLUMN IF NOT EXISTS upgrade_of bigint REFERENCES skills(id) ON DELETE SET NULL;

-- Add min_star_rank to trainee_unique_skills so we know which star level each unique applies at
ALTER TABLE trainee_unique_skills ADD COLUMN IF NOT EXISTS min_star_rank smallint NOT NULL DEFAULT 1
  CONSTRAINT unique_star_rank_range CHECK (min_star_rank BETWEEN 1 AND 5);
