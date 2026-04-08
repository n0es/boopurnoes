-- Incremental GameTora JSON blobs (manifest, db-files, etc.). Populate lazily from the app or via scripts.
create table if not exists public.gametora_json_cache (
  resource_key   text primary key,
  content_hash   text,
  body           jsonb not null,
  source_url     text,
  fetched_at     timestamptz not null default now()
);

create index if not exists gametora_json_cache_fetched_at_idx on public.gametora_json_cache (fetched_at desc);

comment on table public.gametora_json_cache is
  'Caches https://gametora.com/data/... JSON per resource_key (e.g. manifest, umamusume/characters.{hash}.json) to avoid re-downloading full datasets.';

alter table public.gametora_json_cache enable row level security;

create policy "gametora_json_cache_read"
  on public.gametora_json_cache for select
  using (true);

create policy "gametora_json_cache_write"
  on public.gametora_json_cache for insert
  to authenticated
  with check (true);

create policy "gametora_json_cache_update"
  on public.gametora_json_cache for update
  to authenticated
  using (true)
  with check (true);
