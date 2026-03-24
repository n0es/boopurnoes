CREATE TABLE IF NOT EXISTS public.services (
  id       bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name     text NOT NULL,
  href     text NOT NULL,
  icon_url text NOT NULL
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "services_read"
  ON public.services FOR SELECT
  USING (true);
