ALTER TABLE public.user_support_card_collection
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1
    CONSTRAINT level_range CHECK (level BETWEEN 1 AND 50);

-- Allow users to update their own collection entries (e.g. change level)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'user_support_card_collection'
      AND policyname = 'Users can update own collection'
  ) THEN
    CREATE POLICY "Users can update own collection"
      ON public.user_support_card_collection FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
