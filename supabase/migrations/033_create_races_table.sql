create table if not exists public.races (
  id              bigint primary key generated always as identity,
  slug            text not null unique,   -- wiki slug, e.g. "Arima Kinen"
  name_en         text not null,
  name_jp         text,
  grade           text,                   -- G1, G2, G3, OP, Pre-OP
  racetrack       text,
  course          text,                   -- Inner, Outer, etc.
  direction       text,                   -- Clockwise, Counterclockwise
  terrain         text,                   -- Turf, Dirt
  distance        integer,                -- meters
  distance_label  text,                   -- Short, Mile, Mid, Long
  season          text,
  time_of_day     text,
  fans_required   integer,
  fans_acquired   integer,
  created_at      timestamptz default now()
);

alter table public.races enable row level security;
create policy "races_read" on public.races for select using (true);
create policy "races_write" on public.races for all to authenticated using (true) with check (true);

create index if not exists races_grade_idx on public.races(grade);
create index if not exists races_racetrack_idx on public.races(racetrack);
