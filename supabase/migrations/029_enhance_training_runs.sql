-- Enhance training_runs with missing configuration
alter table public.training_runs 
  add column if not exists awakening_level integer default 5,
  add column if not exists legacy_config jsonb;

-- Enhance training_run_turns with more state
alter table public.training_run_turns
  add column if not exists mood_before integer,
  add column if not exists friendship_before jsonb, -- Array of numbers
  add column if not exists stats_before jsonb;     -- {speed, stamina, power, guts, wisdom}
