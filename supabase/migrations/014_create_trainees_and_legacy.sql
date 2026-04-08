-- Trainees (Uma Musume characters)
create table if not exists public.trainees (
  id              integer primary key,
  gametora_slug   text,
  name            text not null,
  name_jp         text,
  rarity          integer,
  apt_turf        text,
  apt_dirt        text,
  apt_short       text,
  apt_mile        text,
  apt_mid         text,
  apt_long        text,
  apt_leading     text,
  apt_stalking    text,
  apt_mid_pack    text,
  apt_chasing     text,
  stats_base      jsonb,
  stats_two_star  jsonb,
  stats_three_star jsonb,
  stats_four_star  jsonb,
  stats_five_star  jsonb,
  stat_growth     jsonb,
  image_path      text,
  icon_path       text,
  scraped_at      timestamptz
);

alter table public.trainees enable row level security;
create policy "trainees_read" on public.trainees for select using (true);
create policy "trainees_write" on public.trainees for all to authenticated using (true) with check (true);

-- Trainee skill tables
create table if not exists public.trainee_awakening_skills (
  id          bigint primary key generated always as identity,
  trainee_id  integer not null references public.trainees(id) on delete cascade,
  skill_id    bigint not null references public.skills(id) on delete cascade,
  awakening_level integer not null
);

alter table public.trainee_awakening_skills enable row level security;
create policy "trainee_awakening_skills_read" on public.trainee_awakening_skills for select using (true);
create policy "trainee_awakening_skills_write" on public.trainee_awakening_skills for all to authenticated using (true) with check (true);
create index if not exists trainee_awakening_skills_trainee_id_idx on public.trainee_awakening_skills(trainee_id);

create table if not exists public.trainee_unique_skills (
  id          bigint primary key generated always as identity,
  trainee_id  integer not null references public.trainees(id) on delete cascade,
  skill_id    bigint not null references public.skills(id) on delete cascade,
  sort_order  integer not null default 0
);

alter table public.trainee_unique_skills enable row level security;
create policy "trainee_unique_skills_read" on public.trainee_unique_skills for select using (true);
create policy "trainee_unique_skills_write" on public.trainee_unique_skills for all to authenticated using (true) with check (true);
create index if not exists trainee_unique_skills_trainee_id_idx on public.trainee_unique_skills(trainee_id);

create table if not exists public.trainee_hint_skills (
  id          bigint primary key generated always as identity,
  trainee_id  integer not null references public.trainees(id) on delete cascade,
  skill_id    bigint not null references public.skills(id) on delete cascade
);

alter table public.trainee_hint_skills enable row level security;
create policy "trainee_hint_skills_read" on public.trainee_hint_skills for select using (true);
create policy "trainee_hint_skills_write" on public.trainee_hint_skills for all to authenticated using (true) with check (true);
create index if not exists trainee_hint_skills_trainee_id_idx on public.trainee_hint_skills(trainee_id);

-- Legacy lookup tables
create table if not exists public.legacy_scenarios (
  id   bigint primary key generated always as identity,
  name text not null unique
);

alter table public.legacy_scenarios enable row level security;
create policy "legacy_scenarios_read" on public.legacy_scenarios for select using (true);
create policy "legacy_scenarios_write" on public.legacy_scenarios for all to authenticated using (true) with check (true);

create table if not exists public.legacy_races (
  id   bigint primary key generated always as identity,
  name text not null unique
);

alter table public.legacy_races enable row level security;
create policy "legacy_races_read" on public.legacy_races for select using (true);
create policy "legacy_races_write" on public.legacy_races for all to authenticated using (true) with check (true);

create table if not exists public.legacy_aptitudes (
  id   bigint primary key generated always as identity,
  name text not null unique
);

alter table public.legacy_aptitudes enable row level security;
create policy "legacy_aptitudes_read" on public.legacy_aptitudes for select using (true);
create policy "legacy_aptitudes_write" on public.legacy_aptitudes for all to authenticated using (true) with check (true);

-- User trainee collection
create table if not exists public.user_trainee_collection (
  user_id         uuid not null references auth.users on delete cascade,
  trainee_id      integer not null references public.trainees(id) on delete cascade,
  star_rank       integer not null default 3,
  awakening_level integer not null default 1,
  primary key (user_id, trainee_id)
);

alter table public.user_trainee_collection enable row level security;
create policy "user_trainee_collection_manage" on public.user_trainee_collection
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
