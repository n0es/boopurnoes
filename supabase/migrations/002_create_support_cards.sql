CREATE TABLE IF NOT EXISTS public.support_cards (
  idx             integer,
  id              integer PRIMARY KEY,
  name            text    NOT NULL,
  name_jp         text,
  rarity          text    NOT NULL CHECK (rarity IN ('SSR', 'SR', 'R')),
  card_type       text    CHECK (card_type IN ('speed', 'stamina', 'power', 'guts', 'intelligence', 'friend', 'group')),
  title           text,
  unique_effect   jsonb,
  hints           jsonb,
  event_skills    text[],
  gametora_slug   text,
  icon_path       text,
  art_path        text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE public.support_cards ENABLE ROW LEVEL SECURITY;

-- Anyone can read cards
CREATE POLICY "support_cards_read"
  ON public.support_cards FOR SELECT
  USING (true);

-- Only service role can write (no anon/user writes)

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER support_cards_updated_at
  BEFORE UPDATE ON public.support_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
