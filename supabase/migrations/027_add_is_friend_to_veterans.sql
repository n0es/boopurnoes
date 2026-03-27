alter table public.veterans
  add column if not exists is_friend boolean default false;
