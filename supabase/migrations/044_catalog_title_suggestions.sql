-- Crowdsourced corrections for trainee / support card titles (catalog display strings).
-- Authenticated users insert (or upsert) their own row per entity; admins read all and delete/accept.

create table if not exists public.catalog_title_suggestions (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('trainee', 'support_card')),
  entity_id integer not null,
  suggested_title text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint catalog_title_suggestions_suggested_title_not_blank check (length(trim(suggested_title)) > 0)
);

create unique index if not exists catalog_title_suggestions_one_per_user
  on public.catalog_title_suggestions (entity_type, entity_id, user_id);

create index if not exists catalog_title_suggestions_entity_idx
  on public.catalog_title_suggestions (entity_type, entity_id);

alter table public.catalog_title_suggestions enable row level security;

create policy "catalog_title_suggestions_select"
  on public.catalog_title_suggestions for select
  to authenticated
  using (public.is_admin() or user_id = auth.uid());

create policy "catalog_title_suggestions_insert"
  on public.catalog_title_suggestions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "catalog_title_suggestions_update"
  on public.catalog_title_suggestions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "catalog_title_suggestions_delete"
  on public.catalog_title_suggestions for delete
  to authenticated
  using (public.is_admin() or user_id = auth.uid());
