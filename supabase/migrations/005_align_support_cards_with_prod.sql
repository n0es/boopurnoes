-- Align local support_cards schema with production.
--
-- Differences from migration 002:
--   - id:        integer → bigint
--   - card_type: nullable, removed enum check (prod allows any text value and is NOT NULL)
--   - idx:       dropped (not present in prod)

-- Widen id to bigint to match prod
ALTER TABLE public.support_cards
  ALTER COLUMN id TYPE bigint;

-- Drop the enum check on card_type so prod data (which may have values
-- outside the original list) can be inserted
ALTER TABLE public.support_cards
  DROP CONSTRAINT IF EXISTS support_cards_card_type_check;

-- Drop idx — not present in prod and unused
ALTER TABLE public.support_cards
  DROP COLUMN IF EXISTS idx;
