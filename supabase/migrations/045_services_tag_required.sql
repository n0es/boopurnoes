ALTER TABLE public.services ADD COLUMN IF NOT EXISTS tag_required text DEFAULT NULL;

UPDATE public.services SET tag_required = 'jellyfin-user' WHERE name = 'Jellyfin';
