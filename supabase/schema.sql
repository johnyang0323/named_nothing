-- 계획 있는 것처럼 사는 하루 — account storage
-- Paste into Supabase dashboard → SQL Editor → New query → Run.

create table if not exists public.days (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  date       date        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, date),
  constraint days_data_size check (pg_column_size(data) < 300000)
);

-- Row Level Security: each person can only see and change their own days.
alter table public.days enable row level security;

drop policy if exists "days: read own"   on public.days;
drop policy if exists "days: insert own" on public.days;
drop policy if exists "days: update own" on public.days;
drop policy if exists "days: delete own" on public.days;

create policy "days: read own"   on public.days for select using (auth.uid() = user_id);
create policy "days: insert own" on public.days for insert with check (auth.uid() = user_id);
create policy "days: update own" on public.days for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "days: delete own" on public.days for delete using (auth.uid() = user_id);
