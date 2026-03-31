-- Allow public read access to legacy metadata
create policy "Allow public read of legacy_scenarios" on public.legacy_scenarios for select using (true);
create policy "Allow public read of legacy_races" on public.legacy_races for select using (true);
create policy "Allow public read of legacy_aptitudes" on public.legacy_aptitudes for select using (true);

-- Enable RLS just in case it wasn't
alter table public.legacy_scenarios enable row level security;
alter table public.legacy_races enable row level security;
alter table public.legacy_aptitudes enable row level security;
