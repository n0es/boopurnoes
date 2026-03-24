-- Support card hints (skills obtainable from training hints)
CREATE TABLE IF NOT EXISTS public.support_card_hints (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  card_id         bigint NOT NULL REFERENCES public.support_cards(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  icon_url        text,
  sort_order      int4 DEFAULT 0
);

ALTER TABLE public.support_card_hints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "support_card_hints_read" ON public.support_card_hints FOR SELECT USING (true);
CREATE POLICY "support_card_hints_write" ON public.support_card_hints FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS support_card_hints_card_id_idx ON public.support_card_hints (card_id);

-- Support card event skills (skills obtainable from training events)
CREATE TABLE IF NOT EXISTS public.support_card_event_skills (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  card_id         bigint NOT NULL REFERENCES public.support_cards(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  icon_url        text,
  sort_order      int4 DEFAULT 0
);

ALTER TABLE public.support_card_event_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "support_card_event_skills_read" ON public.support_card_event_skills FOR SELECT USING (true);
CREATE POLICY "support_card_event_skills_write" ON public.support_card_event_skills FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS support_card_event_skills_card_id_idx ON public.support_card_event_skills (card_id);

-- Support card training events (chain events and random events)
CREATE TABLE IF NOT EXISTS public.support_card_training_events (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  card_id         bigint NOT NULL REFERENCES public.support_cards(id) ON DELETE CASCADE,
  name            text NOT NULL,
  event_type      text NOT NULL CHECK (event_type IN ('chain', 'random')),
  chain_level     int4,            -- 1, 2, 3 for chain events; null for random
  sort_order      int4 DEFAULT 0
);

ALTER TABLE public.support_card_training_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "support_card_training_events_read" ON public.support_card_training_events FOR SELECT USING (true);
CREATE POLICY "support_card_training_events_write" ON public.support_card_training_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS support_card_training_events_card_id_idx ON public.support_card_training_events (card_id);

-- Also store hint stat gains on the support_cards table as jsonb for simplicity
ALTER TABLE public.support_cards
  ADD COLUMN IF NOT EXISTS hint_stat_gains jsonb;
