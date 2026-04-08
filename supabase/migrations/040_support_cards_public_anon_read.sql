-- Public read for Support Cards catalog (anon + authenticated).
--
-- Depends on 039_rls_admin_catalog_writes.sql: admin-only *writes* on these tables stay in place;
-- this migration only adds GRANTs and SELECT policies so role `anon` (anon key, no JWT) can read
-- rows for the catalog UI, including PostgREST embeds (`hints → skills`, etc.).
--
-- Idempotent: safe to re-run (drop/create named policies; GRANT is additive).

grant usage on schema public to anon, authenticated;

grant select on table public.support_cards to anon, authenticated;
grant select on table public.support_card_effects to anon, authenticated;
grant select on table public.support_card_hints to anon, authenticated;
grant select on table public.support_card_event_skills to anon, authenticated;
grant select on table public.skills to anon, authenticated;

do $$
begin
  if to_regclass('public.support_card_training_events') is not null then
    execute 'grant select on table public.support_card_training_events to anon, authenticated';
  end if;
end $$;

-- Replace legacy read policies with explicit anon + authenticated selectors
drop policy if exists "support_cards_read" on public.support_cards;
drop policy if exists "Anyone can view support cards" on public.support_cards;
create policy "support_cards_public_select"
  on public.support_cards
  for select
  to anon, authenticated
  using (true);

drop policy if exists "support_card_effects_read" on public.support_card_effects;
drop policy if exists "Anyone can view support card effects" on public.support_card_effects;
create policy "support_card_effects_public_select"
  on public.support_card_effects
  for select
  to anon, authenticated
  using (true);

drop policy if exists "support_card_hints_read" on public.support_card_hints;
create policy "support_card_hints_public_select"
  on public.support_card_hints
  for select
  to anon, authenticated
  using (true);

drop policy if exists "support_card_event_skills_read" on public.support_card_event_skills;
create policy "support_card_event_skills_public_select"
  on public.support_card_event_skills
  for select
  to anon, authenticated
  using (true);

drop policy if exists "skills_read" on public.skills;
create policy "skills_public_select"
  on public.skills
  for select
  to anon, authenticated
  using (true);

do $$
begin
  if to_regclass('public.support_card_training_events') is not null then
    execute 'drop policy if exists "support_card_training_events_read" on public.support_card_training_events';
    execute $p$
      create policy "support_card_training_events_public_select"
        on public.support_card_training_events
        for select
        to anon, authenticated
        using (true)
    $p$;
  end if;
end $$;
