-- Repair: some production DBs never ran early migrations, so PostgREST returns 404 (PGRST205)
-- for user_support_card_collection and/or support_card_training_events.
-- Idempotent: CREATE IF NOT EXISTS + DROP/CREATE policies with current names.
--
-- Requires 039 (public.is_admin) for the training_events write policy.

-- ─── user_support_card_collection (003 + 007 + 008) ─────────────────────────

create table if not exists public.user_support_card_collection (
  user_id  uuid    not null references auth.users on delete cascade,
  card_id  integer not null references public.support_cards (id) on delete cascade,
  added_at timestamptz default now(),
  primary key (user_id, card_id)
);

alter table public.user_support_card_collection
  add column if not exists level integer not null default 1;
alter table public.user_support_card_collection
  add column if not exists uncap integer not null default 0;

alter table public.user_support_card_collection enable row level security;

drop policy if exists "Users can read own collection" on public.user_support_card_collection;
create policy "Users can read own collection"
  on public.user_support_card_collection for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert into own collection" on public.user_support_card_collection;
create policy "Users can insert into own collection"
  on public.user_support_card_collection for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete from own collection" on public.user_support_card_collection;
create policy "Users can delete from own collection"
  on public.user_support_card_collection for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can update own collection" on public.user_support_card_collection;
create policy "Users can update own collection"
  on public.user_support_card_collection for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on table public.user_support_card_collection to authenticated;
grant all on table public.user_support_card_collection to service_role;

-- ─── support_card_training_events (012), policies aligned with 039 + 040 ─────

create table if not exists public.support_card_training_events (
  id              bigint primary key generated always as identity,
  card_id         bigint not null references public.support_cards (id) on delete cascade,
  name            text not null,
  event_type      text not null check (event_type in ('chain', 'random')),
  chain_level     int4,
  sort_order      int4 default 0
);

create index if not exists support_card_training_events_card_id_idx
  on public.support_card_training_events (card_id);

alter table public.support_card_training_events enable row level security;

drop policy if exists "support_card_training_events_read" on public.support_card_training_events;
drop policy if exists "support_card_training_events_public_select" on public.support_card_training_events;
drop policy if exists "support_card_training_events_write" on public.support_card_training_events;

create policy "support_card_training_events_public_select"
  on public.support_card_training_events for select
  to anon, authenticated
  using (true);

create policy "support_card_training_events_write"
  on public.support_card_training_events for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on table public.support_card_training_events to anon, authenticated;
