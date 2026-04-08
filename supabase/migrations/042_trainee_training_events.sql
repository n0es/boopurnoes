-- Referenced by Trainees modal (Events tab). Was missing from earlier migrations.
CREATE TABLE IF NOT EXISTS public.trainee_training_events (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  trainee_id      integer NOT NULL REFERENCES public.trainees (id) ON DELETE CASCADE,
  name            text NOT NULL,
  category        text,
  sort_order      integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS trainee_training_events_trainee_id_idx
  ON public.trainee_training_events (trainee_id);

ALTER TABLE public.trainee_training_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trainee_training_events_read" ON public.trainee_training_events;
DROP POLICY IF EXISTS "trainee_training_events_public_select" ON public.trainee_training_events;
DROP POLICY IF EXISTS "trainee_training_events_write" ON public.trainee_training_events;

CREATE POLICY "trainee_training_events_public_select"
  ON public.trainee_training_events FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "trainee_training_events_write"
  ON public.trainee_training_events FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON TABLE public.trainee_training_events TO anon, authenticated;
GRANT ALL ON TABLE public.trainee_training_events TO service_role;
