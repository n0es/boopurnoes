INSERT INTO public.services (name, href, icon_url)
SELECT
  'Uma Musume',
  '/support-cards',
  'https://supabase.boopurno.es/storage/v1/object/public/umamusume/icons/speed.png'
WHERE NOT EXISTS (
  SELECT 1 FROM public.services WHERE name = 'Uma Musume'
);
