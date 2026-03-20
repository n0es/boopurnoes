-- Allow authenticated users to update support card data and effects.
CREATE POLICY "support_cards_update"
  ON public.support_cards FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "support_card_effects_update"
  ON public.support_card_effects FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "support_card_effects_insert"
  ON public.support_card_effects FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "support_card_effects_delete"
  ON public.support_card_effects FOR DELETE
  TO authenticated
  USING (true);
