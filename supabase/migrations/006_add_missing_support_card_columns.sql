-- Add columns that exist in prod but were absent from the original local table
-- (CREATE TABLE IF NOT EXISTS in 002 skipped them when the table already existed).
ALTER TABLE public.support_cards
  ADD COLUMN IF NOT EXISTS name_jp       text,
  ADD COLUMN IF NOT EXISTS title         text,
  ADD COLUMN IF NOT EXISTS unique_effect jsonb,
  ADD COLUMN IF NOT EXISTS hints         jsonb,
  ADD COLUMN IF NOT EXISTS gametora_slug text,
  ADD COLUMN IF NOT EXISTS icon_path     text,
  ADD COLUMN IF NOT EXISTS art_path      text,
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz DEFAULT now();
