-- Catalog data (trainees, skills, support cards, caches, legacy lookups): writes limited to admins.
-- Reads stay open (SELECT USING (true)) so anon + authenticated can read metadata.
-- User-owned tables (collections, veterans, saves) already use auth.uid() policies.

-- Stable helper for RLS policies (SECURITY DEFINER so it can read profiles reliably; search_path pinned for lint 0011)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- Trigger / auth helpers: pin search_path (lint 0011)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'user');
  return new;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Drop permissive write policies and replace with admin-only
-- ---------------------------------------------------------------------------

drop policy if exists "trainees_write" on public.trainees;
create policy "trainees_write"
  on public.trainees for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "trainee_awakening_skills_write" on public.trainee_awakening_skills;
create policy "trainee_awakening_skills_write"
  on public.trainee_awakening_skills for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "trainee_unique_skills_write" on public.trainee_unique_skills;
create policy "trainee_unique_skills_write"
  on public.trainee_unique_skills for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "trainee_hint_skills_write" on public.trainee_hint_skills;
create policy "trainee_hint_skills_write"
  on public.trainee_hint_skills for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "legacy_scenarios_write" on public.legacy_scenarios;
create policy "legacy_scenarios_write"
  on public.legacy_scenarios for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "legacy_races_write" on public.legacy_races;
create policy "legacy_races_write"
  on public.legacy_races for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "legacy_aptitudes_write" on public.legacy_aptitudes;
create policy "legacy_aptitudes_write"
  on public.legacy_aptitudes for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "skills_write" on public.skills;
create policy "skills_write"
  on public.skills for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "support_card_hints_write" on public.support_card_hints;
create policy "support_card_hints_write"
  on public.support_card_hints for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "support_card_event_skills_write" on public.support_card_event_skills;
create policy "support_card_event_skills_write"
  on public.support_card_event_skills for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Optional tables (older prod DBs may not have these yet)
do $$
begin
  if to_regclass('public.support_card_training_events') is not null then
    execute 'drop policy if exists "support_card_training_events_write" on public.support_card_training_events';
    execute $policy$
      create policy "support_card_training_events_write"
        on public.support_card_training_events for all
        to authenticated
        using (public.is_admin())
        with check (public.is_admin())
    $policy$;
  end if;
  if to_regclass('public.races') is not null then
    execute 'drop policy if exists "races_write" on public.races';
    execute $policy$
      create policy "races_write"
        on public.races for all
        to authenticated
        using (public.is_admin())
        with check (public.is_admin())
    $policy$;
  end if;
end $$;

-- gametora_json_cache: keep authenticated INSERT/UPDATE (shared CDN cache; not authoritative catalog).
-- Restricting to admin would break client-side cache fill in src/lib/gametoraCache.ts for normal users.

drop policy if exists "support_cards_update" on public.support_cards;
create policy "support_cards_update"
  on public.support_cards for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "support_card_effects_update" on public.support_card_effects;
create policy "support_card_effects_update"
  on public.support_card_effects for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "support_card_effects_insert" on public.support_card_effects;
create policy "support_card_effects_insert"
  on public.support_card_effects for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "support_card_effects_delete" on public.support_card_effects;
create policy "support_card_effects_delete"
  on public.support_card_effects for delete
  to authenticated
  using (public.is_admin());
