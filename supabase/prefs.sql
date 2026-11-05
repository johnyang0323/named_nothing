-- 나의 취향 (learned from what you choose) — one row per person.
-- Paste into Supabase dashboard → SQL Editor → New query → Run. Safe to run again.

create table if not exists public.prefs (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  taste      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint prefs_taste_size check (pg_column_size(taste) < 20000)
);

alter table public.prefs enable row level security;

drop policy if exists "prefs: read own"   on public.prefs;
drop policy if exists "prefs: insert own" on public.prefs;
drop policy if exists "prefs: update own" on public.prefs;
drop policy if exists "prefs: delete own" on public.prefs;

create policy "prefs: read own"   on public.prefs for select using (auth.uid() = user_id);
create policy "prefs: insert own" on public.prefs for insert with check (auth.uid() = user_id);
create policy "prefs: update own" on public.prefs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "prefs: delete own" on public.prefs for delete using (auth.uid() = user_id);
