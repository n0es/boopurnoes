-- Training scenarios (replaces legacy_scenarios with a richer structure)
create table if not exists public.scenarios (
  id   integer primary key generated always as identity,
  slug text not null unique,
  name text not null
);

alter table public.scenarios enable row level security;
create policy "scenarios_read" on public.scenarios for select using (true);
create policy "scenarios_write" on public.scenarios for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.scenarios (slug, name) values
  ('ura-finale',          'Ura Finale'),
  ('unity-cup',           'Unity Cup'),
  ('twinkle-star-climax', 'Twinkle Star Climax')
on conflict (slug) do nothing;
