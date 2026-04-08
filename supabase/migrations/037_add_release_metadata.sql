-- JP / global release tracking for support cards and trainees (see release_source for citations).

ALTER TABLE public.support_cards
  ADD COLUMN IF NOT EXISTS released_jp date,
  ADD COLUMN IF NOT EXISTS released_global date,
  ADD COLUMN IF NOT EXISTS release_global_is_approximate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS release_source text;

ALTER TABLE public.trainees
  ADD COLUMN IF NOT EXISTS released_jp date,
  ADD COLUMN IF NOT EXISTS released_global date,
  ADD COLUMN IF NOT EXISTS release_global_is_approximate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS release_source text;

COMMENT ON COLUMN public.support_cards.released_jp IS 'First JP banner availability (typically pickup start date), date-only.';
COMMENT ON COLUMN public.support_cards.released_global IS 'Global availability. NULL if not yet on global or unknown.';
COMMENT ON COLUMN public.support_cards.release_global_is_approximate IS 'True when released_global is a projection (e.g. uma.moe timeline), not confirmed in-game.';
COMMENT ON COLUMN public.support_cards.release_source IS 'Citation URL or note for release dates (e.g. https://uma.moe/timeline).';

COMMENT ON COLUMN public.trainees.released_jp IS 'First JP banner availability (typically pickup start date), date-only.';
COMMENT ON COLUMN public.trainees.released_global IS 'Global availability. NULL if not yet on global or unknown.';
COMMENT ON COLUMN public.trainees.release_global_is_approximate IS 'True when released_global is a projection (e.g. uma.moe timeline), not confirmed in-game.';
COMMENT ON COLUMN public.trainees.release_source IS 'Citation URL or note for release dates (e.g. https://uma.moe/timeline).';
