ALTER TABLE public.user_support_card_collection
  ADD COLUMN IF NOT EXISTS uncap integer NOT NULL DEFAULT 0
    CONSTRAINT uncap_range CHECK (uncap BETWEEN 0 AND 4);
