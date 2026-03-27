-- Refactor veterans table for inheritance calculations
alter table public.veterans
  drop column if exists rank,
  drop column if exists score,
  drop column if exists epithet,
  drop column if exists final_stats,
  drop column if exists final_grades,
  drop column if exists skills,
  drop column if exists deck;

alter table public.veterans
  add column if not exists g1_races jsonb default '[]'::jsonb;
