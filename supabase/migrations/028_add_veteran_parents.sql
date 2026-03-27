alter table public.veterans
  add column if not exists parent1_id uuid references public.veterans(id) on delete set null,
  add column if not exists parent2_id uuid references public.veterans(id) on delete set null;
