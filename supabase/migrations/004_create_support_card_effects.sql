-- Ensure event_skills exists as int4[]
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'support_cards'
      AND column_name = 'event_skills'
  ) THEN
    ALTER TABLE public.support_cards ADD COLUMN event_skills int4[];
  ELSE
    ALTER TABLE public.support_cards
      ALTER COLUMN event_skills TYPE int4[]
      USING ARRAY[]::int4[];
  END IF;
END $$;

-- Support card effects table
CREATE TABLE IF NOT EXISTS public.support_card_effects (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  card_id         bigint NOT NULL REFERENCES public.support_cards(id) ON DELETE CASCADE,
  effect_type_id  int4,
  effect_name     text,
  symbol          text,
  calc_type       text,
  unlock_level    int4,
  values_by_level int4[]
);

ALTER TABLE public.support_card_effects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_card_effects_read"
  ON public.support_card_effects FOR SELECT
  USING (true);

CREATE INDEX IF NOT EXISTS support_card_effects_card_id_idx ON public.support_card_effects (card_id);
