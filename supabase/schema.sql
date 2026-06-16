-- ============================================================
-- Gaming site — Supabase schema
-- Run this in Supabase dashboard > SQL Editor.
-- Security is intentionally open (friends-only site).
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  title         text not null,
  genre         text,
  tags          text[] not null default '{}',
  description   text,
  -- Fuzzy release date: an anchor date plus how precise it is.
  -- precision: 'day' | 'month' | 'year' | 'unknown'
  release_date      date,
  release_precision text not null default 'unknown',
  trailer_url   text,            -- YouTube URL (watch/share/embed/shorts all ok)
  images        text[] not null default '{}',  -- public URLs into the storage bucket
  created_at    timestamptz not null default now()
);

create index if not exists games_created_at_idx on public.games (created_at desc);

-- ---- Open access (no auth — friends only) -------------------
alter table public.games enable row level security;

drop policy if exists "public read"   on public.games;
drop policy if exists "public insert" on public.games;
drop policy if exists "public update" on public.games;
drop policy if exists "public delete" on public.games;

create policy "public read"   on public.games for select using (true);
create policy "public insert" on public.games for insert with check (true);
create policy "public update" on public.games for update using (true) with check (true);
create policy "public delete" on public.games for delete using (true);

-- ============================================================
-- Storage bucket for game images (and optional self-hosted clips).
-- Easiest: create a PUBLIC bucket named "game-media" in the
-- dashboard (Storage > New bucket > Public). Then the policies
-- below open it for uploads. Re-run is safe.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('game-media', 'game-media', true)
on conflict (id) do update set public = true;

drop policy if exists "media read"   on storage.objects;
drop policy if exists "media write"  on storage.objects;
drop policy if exists "media update" on storage.objects;
drop policy if exists "media delete" on storage.objects;

create policy "media read"   on storage.objects for select using (bucket_id = 'game-media');
create policy "media write"  on storage.objects for insert with check (bucket_id = 'game-media');
create policy "media update" on storage.objects for update using (bucket_id = 'game-media');
create policy "media delete" on storage.objects for delete using (bucket_id = 'game-media');
