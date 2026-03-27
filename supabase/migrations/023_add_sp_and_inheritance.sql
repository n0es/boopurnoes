-- Add skill points and starting stats to training runs
alter table public.training_runs 
  add column if not exists initial_sp integer default 120,
  add column if not exists inherited_stats jsonb default '{"speed": 0, "stamina": 0, "power": 0, "guts": 0, "wisdom": 0}'::jsonb;

-- Add skill point gains to turn tracking
alter table public.training_run_turns
  add column if not exists sp_gain integer default 0;
