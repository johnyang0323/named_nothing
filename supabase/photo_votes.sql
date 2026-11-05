-- 사진 투표 (이 사진으로 정하기 / 이 사진 아니에요) — shared by everyone.
-- Paste into Supabase dashboard → SQL Editor → New query → Run. Safe to run again.

create table if not exists public.photo_votes (
  place_id   text        not null check (place_id ~ '^k-[0-9]+$'),
  image_url  text        not null check (image_url ~ '^https?://' and length(image_url) <= 1000),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  vote       smallint    not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (place_id, image_url, user_id)
);

-- Each person can only see and change their own votes (no one sees who voted).
alter table public.photo_votes enable row level security;

drop policy if exists "photo_votes: read own"   on public.photo_votes;
drop policy if exists "photo_votes: insert own" on public.photo_votes;
drop policy if exists "photo_votes: update own" on public.photo_votes;
drop policy if exists "photo_votes: delete own" on public.photo_votes;

create policy "photo_votes: read own"   on public.photo_votes for select using (auth.uid() = user_id);
create policy "photo_votes: insert own" on public.photo_votes for insert with check (auth.uid() = user_id);
create policy "photo_votes: update own" on public.photo_votes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "photo_votes: delete own" on public.photo_votes for delete using (auth.uid() = user_id);

-- Net score per photo for a few places, without revealing who voted.
create or replace function public.photo_scores(ids text[])
returns table (place_id text, image_url text, score integer)
language sql
stable
security definer
set search_path = public
as $$
  select v.place_id, v.image_url, sum(v.vote)::integer as score
  from public.photo_votes v
  where v.place_id = any (ids[1:50])
  group by v.place_id, v.image_url
$$;

revoke all on function public.photo_scores(text[]) from public;
grant execute on function public.photo_scores(text[]) to authenticated;
