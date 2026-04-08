-- Per-user saved Career Simulator configurations (multiple runs per account).

create table if not exists public.career_simulator_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Untitled',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_career_simulator_saves_user_updated
  on public.career_simulator_saves (user_id, updated_at desc);

alter table public.career_simulator_saves enable row level security;

drop policy if exists "career_simulator_saves_select_own" on public.career_simulator_saves;
create policy "career_simulator_saves_select_own"
  on public.career_simulator_saves
  for select
  using (auth.uid() = user_id);

drop policy if exists "career_simulator_saves_insert_own" on public.career_simulator_saves;
create policy "career_simulator_saves_insert_own"
  on public.career_simulator_saves
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "career_simulator_saves_update_own" on public.career_simulator_saves;
create policy "career_simulator_saves_update_own"
  on public.career_simulator_saves
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "career_simulator_saves_delete_own" on public.career_simulator_saves;
create policy "career_simulator_saves_delete_own"
  on public.career_simulator_saves
  for delete
  using (auth.uid() = user_id);

-- updated_at is set by the client on write
