-- ============================================================
-- Migration 013: Normalize skills into a shared lookup table
-- ============================================================
-- Previously, skill name/description/icon were duplicated across
-- support_card_hints and support_card_event_skills rows.
-- This migration creates a single `skills` table and converts
-- the per-card tables into lightweight junction tables.
-- Training events are unaffected (they are not shared skills).

-- 1. Create the shared skills lookup table
CREATE TABLE IF NOT EXISTS public.skills (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  gametora_id     bigint UNIQUE NOT NULL,          -- e.g. 200162
  name            text NOT NULL,                    -- e.g. "Wet Conditions ○"
  description     text,                             -- full English description
  icon_url        text,                             -- full URL to skill icon
  condition       text,                             -- e.g. "Late Surger", "Mile", "Dirt"
  rarity          smallint,                         -- 1-6 from Gametora
  skill_type      text[]                            -- e.g. {"nac","cor"} activation types
);

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "skills_read" ON public.skills FOR SELECT USING (true);
CREATE POLICY "skills_write" ON public.skills FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS skills_gametora_id_idx ON public.skills (gametora_id);

-- 2. Drop the old denormalized tables
DROP TABLE IF EXISTS public.support_card_hints CASCADE;
DROP TABLE IF EXISTS public.support_card_event_skills CASCADE;

-- 3. Create new junction tables referencing skills
CREATE TABLE public.support_card_hints (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  card_id         bigint NOT NULL REFERENCES public.support_cards(id) ON DELETE CASCADE,
  skill_id        bigint NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  sort_order      int4 DEFAULT 0,
  UNIQUE (card_id, skill_id)
);

ALTER TABLE public.support_card_hints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "support_card_hints_read" ON public.support_card_hints FOR SELECT USING (true);
CREATE POLICY "support_card_hints_write" ON public.support_card_hints FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS support_card_hints_card_id_idx ON public.support_card_hints (card_id);
CREATE INDEX IF NOT EXISTS support_card_hints_skill_id_idx ON public.support_card_hints (skill_id);

CREATE TABLE public.support_card_event_skills (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  card_id         bigint NOT NULL REFERENCES public.support_cards(id) ON DELETE CASCADE,
  skill_id        bigint NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  sort_order      int4 DEFAULT 0,
  UNIQUE (card_id, skill_id)
);

ALTER TABLE public.support_card_event_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "support_card_event_skills_read" ON public.support_card_event_skills FOR SELECT USING (true);
CREATE POLICY "support_card_event_skills_write" ON public.support_card_event_skills FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS support_card_event_skills_card_id_idx ON public.support_card_event_skills (card_id);
CREATE INDEX IF NOT EXISTS support_card_event_skills_skill_id_idx ON public.support_card_event_skills (skill_id);
