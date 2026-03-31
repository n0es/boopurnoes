-- Tables for legacy factor metadata
create table if not exists public.legacy_scenarios (
  id serial primary key,
  name text not null unique
);

create table if not exists public.legacy_races (
  id serial primary key,
  name text not null unique
);

create table if not exists public.legacy_aptitudes (
  id serial primary key,
  name text not null unique
);

-- Seed Scenarios
insert into public.legacy_scenarios (name) values
  ('URA Finale'),
  ('Unity Cup')
on conflict (name) do nothing;

-- Seed Aptitudes
insert into public.legacy_aptitudes (name) values
  ('Turf'), ('Dirt'),
  ('Sprint'), ('Mile'), ('Medium'), ('Long'),
  ('Front Runner'), ('Pace Chaser'), ('Late Surger'), ('End Closer')
on conflict (name) do nothing;

-- Seed some common G1 Races (subset)
insert into public.legacy_races (name) values
  ('Arima Kinen'), ('Japan Cup'), ('Derby'), ('Satsuki Sho'), ('Kikka Sho'),
  ('Oka Sho'), ('Yushun Himba'), ('Shuka Sho'), ('Tenno Sho (Spring)'), ('Tenno Sho (Autumn)'),
  ('Takarazuka Kinen'), ('Yasuda Kinen'), ('Mile Championship'), ('Sprinters Stakes'),
  ('Japan Dirt Derby'), ('Champions Cup'), ('February Stakes'), ('Hopeful Stakes'), ('NHK Mile Cup')
on conflict (name) do nothing;
