-- Create veterans table for completed legacy units
create table if not exists public.veterans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  trainee_id integer references public.trainees(id) on delete cascade not null,
  rank text not null, -- e.g. "UF", "UG", "SS"
  score integer not null, -- total evaluation points
  epithet text, -- unit title
  final_stats jsonb not null, -- {speed, stamina, power, guts, wisdom, sp}
  final_grades jsonb not null, -- {turf, dirt, short, mile, mid, long, leading, stalking, mid_pack, chasing}
  skills jsonb not null, -- Array of skill strings or objects
  deck jsonb not null, -- Array of {card_id, level} used during training
  parents jsonb, -- Inheritance parents {parent1: {trainee_id, veteran_id?}, parent2: {...}}
  spark_data jsonb, -- Starting inheritance {stats: {...}, sp: 120}
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.veterans enable row level security;

-- Policies
create policy "Users can manage their own veterans"
  on public.veterans
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Indexes
create index if not exists idx_veterans_user_id on public.veterans(user_id);
create index if not exists idx_veterans_trainee_id on public.veterans(trainee_id);
