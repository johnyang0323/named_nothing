-- 사용자 장소 사진 (기록장 사진을 그 장소의 대표 사진으로 함께 보여주기)
-- Supabase → SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전해요.
-- social.sql 을 먼저 실행해 둔 상태여야 해요.
--
-- A journal entry can opt in with share_place_photos = true. Then its photos
-- are shown to every signed-in user on that place's card, credited with the
-- author's nickname. Nothing else from the entry (note, date, visibility) is
-- exposed: the list comes from a SECURITY DEFINER function that returns only
-- the photo paths and the nickname, and storage gets one extra read policy
-- for exactly those files. Turning the option off or deleting the entry
-- (or the account) withdraws the photos at once.

alter table public.journal_entries
  add column if not exists share_place_photos boolean not null default false;

create index if not exists journal_entries_place_share
  on public.journal_entries (place_id, created_at desc)
  where share_place_photos;

-- Is this storage path a photo someone chose to share as a place photo
-- (and not from someone I blocked or who blocked me)?
create or replace function public.is_shared_place_photo(path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from journal_entries e
    where e.share_place_photos
      and e.place_id is not null
      and path = any (e.photo_paths)
      and not is_blocked_between(e.user_id, auth.uid())
  )
$$;

-- Shared photos for one place, newest first: path + nickname only.
create or replace function public.place_photos(p_place_id text, p_limit int default 8)
returns table (path text, nickname text, entry_id uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.path, coalesce(pr.nickname, '사용자'), e.id, e.created_at
  from journal_entries e
  cross join lateral unnest(e.photo_paths) as p(path)
  left join profiles pr on pr.user_id = e.user_id
  where auth.uid() is not null
    and e.share_place_photos
    and e.place_id = p_place_id
    and not is_blocked_between(e.user_id, auth.uid())
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 20)
$$;

revoke all on function public.place_photos(text, int) from public, anon;
grant execute on function public.place_photos(text, int) to authenticated;
revoke all on function public.is_shared_place_photo(text) from public, anon;
grant execute on function public.is_shared_place_photo(text) to authenticated;

-- One more way to read a journal photo: it is a shared place photo.
drop policy if exists "journal: read shared place photos" on storage.objects;
create policy "journal: read shared place photos" on storage.objects for select to authenticated
  using (bucket_id = 'journal' and public.is_shared_place_photo(objects.name));

-- Reports can point at a shared place photo's entry ('entry' already exists).
