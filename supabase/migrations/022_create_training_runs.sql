-- Create training_runs table to store session data
create table if not exists public.training_runs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  trainee_id integer references public.trainees(id) on delete cascade not null,
  star_rank integer not null check (star_rank >= 1 and star_rank <= 5),
  deck jsonb not null, -- Array of {card_id, level}
  final_stats jsonb,   -- {speed, stamina, power, guts, wisdom}
  created_at timestamptz default now()
);

-- Create training_run_turns table to store turn-by-turn history
create table if not exists public.training_run_turns (
  id uuid default gen_random_uuid() primary key,
  run_id uuid references public.training_runs(id) on delete cascade not null,
  turn_number integer not null,
  energy_before integer not null,
  card_locations jsonb not null, -- {speed: [id, id], stamina: [], ...}
  action_taken text not null,
  stat_gains jsonb not null,    -- {speed, stamina, power, guts, wisdom}
  energy_change integer not null,
  friendship_gains jsonb,       -- {card_id: points, ...}
  unique(run_id, turn_number)
);

-- Enable RLS
alter table public.training_runs enable row level security;
alter table public.training_run_turns enable row level security;

-- Policies for training_runs
create policy "Users can manage their own training runs"
  on public.training_runs
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Policies for training_run_turns
create policy "Users can manage their own training run turns"
  on public.training_run_turns
  using (
    exists (
      select 1 from public.training_runs
      where id = run_id and user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.training_runs
      where id = run_id and user_id = auth.uid()
    )
  );

-- Indexes
create index if not exists idx_training_runs_user_id on public.training_runs(user_id);
create index if not exists idx_training_run_turns_run_id on public.training_run_turns(run_id);
