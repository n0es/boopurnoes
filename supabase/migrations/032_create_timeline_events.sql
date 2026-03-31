-- Referenceable event templates (character events, scenario events, etc.)
create table if not exists public.scenario_events (
  id uuid default gen_random_uuid() primary key,
  trainee_id integer references public.trainees(id) on delete set null,
  name text not null,
  description text,
  sp_change integer not null default 0,
  stat_changes jsonb not null default '{"speed":0,"stamina":0,"power":0,"guts":0,"wisdom":0}'::jsonb,
  energy_change integer not null default 0,
  mood_change integer not null default 0,
  hints jsonb not null default '[]'::jsonb,     -- [{skill_id, levels}]
  aptitudes jsonb not null default '[]'::jsonb,  -- [name]
  created_by uuid references auth.users on delete set null,
  is_public boolean not null default false,
  created_at timestamptz default now()
);

-- Timeline entries for a run (state machine events)
create table if not exists public.training_run_events (
  id uuid default gen_random_uuid() primary key,
  run_id uuid references public.training_runs(id) on delete cascade not null,
  sequence integer not null,
  type text not null check (type in ('training','event','hint','aptitude','inspiration','race','rest','infirmary','recreation')),
  payload jsonb not null default '{}'::jsonb,
  scenario_event_id uuid references public.scenario_events(id) on delete set null,
  created_at timestamptz default now(),
  unique(run_id, sequence)
);

-- RLS
alter table public.scenario_events enable row level security;
alter table public.training_run_events enable row level security;

create policy "Authenticated users can read scenario events"
  on public.scenario_events for select to authenticated
  using (is_public or created_by = auth.uid());

create policy "Users can create scenario events"
  on public.scenario_events for insert to authenticated
  with check (created_by = auth.uid());

create policy "Users can update their own scenario events"
  on public.scenario_events for update to authenticated
  using (created_by = auth.uid());

create policy "Users can manage their run events"
  on public.training_run_events
  using (exists (select 1 from public.training_runs where id = run_id and user_id = auth.uid()))
  with check (exists (select 1 from public.training_runs where id = run_id and user_id = auth.uid()));

create index if not exists idx_training_run_events_run_id on public.training_run_events(run_id, sequence);
create index if not exists idx_scenario_events_trainee_id on public.scenario_events(trainee_id);
