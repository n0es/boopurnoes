CREATE TABLE IF NOT EXISTS public.user_support_card_collection (
  user_id  uuid    NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  card_id  integer NOT NULL REFERENCES public.support_cards(id) ON DELETE CASCADE,
  added_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);

ALTER TABLE public.user_support_card_collection ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own collection"
  ON public.user_support_card_collection FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert into own collection"
  ON public.user_support_card_collection FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete from own collection"
  ON public.user_support_card_collection FOR DELETE
  USING (auth.uid() = user_id);
