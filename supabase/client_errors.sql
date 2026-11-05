-- 오류 기록 — the app reports errors it hits on people's devices.
-- Paste into Supabase dashboard → SQL Editor → New query → Run. Safe to run again.
-- Read them in Table Editor → client_errors (only you, in the dashboard, can see them).

create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid default auth.uid() references auth.users (id) on delete set null,
  message     text not null check (length(message) between 1 and 500),
  stack       text check (length(stack) <= 4000),
  screen      text check (length(screen) <= 40),
  app_version text check (length(app_version) <= 40),
  user_agent  text check (length(user_agent) <= 300)
);

-- Anyone using the app may ADD a report; nobody can read, change or delete
-- them through the API (the dashboard bypasses this).
alter table public.client_errors enable row level security;

drop policy if exists "client_errors: insert" on public.client_errors;
create policy "client_errors: insert" on public.client_errors
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- Optional: keep only the last 90 days. Needs the pg_cron extension
-- (Database → Extensions → pg_cron). Uncomment and run once.
-- select cron.schedule('trim-client-errors', '17 4 * * *',
--   $$delete from public.client_errors where created_at < now() - interval '90 days'$$);
