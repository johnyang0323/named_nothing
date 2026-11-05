-- 계획 있는 것처럼 사는 하루 — profiles, photo journal, friends, groups, comments, reports.
-- Paste into Supabase dashboard → SQL Editor → New query → Run. Safe to run again.
--
-- Who can see what is decided HERE, by Row Level Security, not by the app:
--   * a journal entry: its author; friends if it is shared with friends;
--     members of its group if it is posted to a group; never someone the
--     author blocked or who blocked the author
--   * a profile (nickname, tag, photo): yourself, your friends, people in your groups
--   * nobody can list other people; adding a friend needs their exact nickname#tag

-- ─────────────────────────────── profiles ───────────────────────────────
create table if not exists public.profiles (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  nickname    text not null check (char_length(nickname) between 1 and 20 and position('#' in nickname) = 0),
  tag         text not null check (tag ~ '^[0-9]{5}$'),
  avatar_path text check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]+$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (nickname, tag)
);

create table if not exists public.friendships (
  user_id    uuid not null references auth.users (id) on delete cascade,
  friend_id  uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create table if not exists public.blocks (
  blocker_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 30),
  invite_code text not null unique check (invite_code ~ '^[A-Z2-9]{8}$'),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.journal_entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date           date not null,
  place_id       text check (char_length(place_id) <= 40),
  place_name     text not null check (char_length(place_name) between 1 and 80),
  place_category text check (char_length(place_category) <= 20),
  area_label     text check (char_length(area_label) <= 40),
  note           text not null default '' check (char_length(note) <= 1000),
  photo_paths    text[] not null default '{}' check (cardinality(photo_paths) <= 4),
  visibility     text not null default 'private' check (visibility in ('private', 'friends', 'group')),
  group_id       uuid references public.groups (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists journal_entries_user_date on public.journal_entries (user_id, date desc);
create index if not exists journal_entries_group on public.journal_entries (group_id, created_at desc);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.journal_entries (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists comments_entry on public.comments (entry_id, created_at);

create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid default auth.uid() references auth.users (id) on delete set null,
  target_type text not null check (target_type in ('entry', 'comment', 'user', 'group')),
  target_id   text not null check (char_length(target_id) <= 60),
  reason      text check (char_length(reason) <= 300),
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────── helpers ───────────────────────────────
-- SECURITY DEFINER so policies can ask these questions without recursion.
create or replace function public.is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

create or replace function public.is_friend(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where user_id = a and friend_id = b)
$$;

create or replace function public.is_member(g uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = g and user_id = u)
$$;

create or replace function public.shares_group(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members x join group_members y on x.group_id = y.group_id where x.user_id = a and y.user_id = b)
$$;

drop function if exists public.can_read_entry(public.journal_entries);
create or replace function public.can_read_entry(owner uuid, vis text, grp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select owner = auth.uid()
    or (not is_blocked_between(owner, auth.uid()) and (
         (vis = 'friends' and is_friend(auth.uid(), owner))
      or (vis = 'group' and grp is not null and is_member(grp, auth.uid()))
    ))
$$;

-- ─────────────────────────────── RLS ───────────────────────────────
alter table public.profiles        enable row level security;
alter table public.friendships     enable row level security;
alter table public.blocks          enable row level security;
alter table public.groups          enable row level security;
alter table public.group_members   enable row level security;
alter table public.journal_entries enable row level security;
alter table public.comments        enable row level security;
alter table public.reports         enable row level security;

drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles for select to authenticated
  using (user_id = auth.uid() or ((is_friend(auth.uid(), user_id) or shares_group(auth.uid(), user_id)) and not is_blocked_between(auth.uid(), user_id)));
-- profiles are written through upsert_profile() (it assigns the #tag)

drop policy if exists "friendships: read own" on public.friendships;
create policy "friendships: read own" on public.friendships for select to authenticated using (user_id = auth.uid());

drop policy if exists "blocks: read own" on public.blocks;
create policy "blocks: read own" on public.blocks for select to authenticated using (blocker_id = auth.uid());
drop policy if exists "blocks: unblock" on public.blocks;
create policy "blocks: unblock" on public.blocks for delete to authenticated using (blocker_id = auth.uid());

drop policy if exists "groups: read if member" on public.groups;
create policy "groups: read if member" on public.groups for select to authenticated using (is_member(id, auth.uid()));
drop policy if exists "groups: owner renames" on public.groups;
create policy "groups: owner renames" on public.groups for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "groups: owner deletes" on public.groups;
create policy "groups: owner deletes" on public.groups for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "members: read co-members" on public.group_members;
create policy "members: read co-members" on public.group_members for select to authenticated using (is_member(group_id, auth.uid()));
drop policy if exists "members: leave or owner removes" on public.group_members;
create policy "members: leave or owner removes" on public.group_members for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid()));

drop policy if exists "entries: read" on public.journal_entries;
create policy "entries: read" on public.journal_entries for select to authenticated using (can_read_entry(user_id, visibility, group_id));
drop policy if exists "entries: write own" on public.journal_entries;
create policy "entries: write own" on public.journal_entries for insert to authenticated
  with check (user_id = auth.uid() and (visibility <> 'group' or (group_id is not null and is_member(group_id, auth.uid()))));
drop policy if exists "entries: edit own" on public.journal_entries;
create policy "entries: edit own" on public.journal_entries for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (visibility <> 'group' or (group_id is not null and is_member(group_id, auth.uid()))));
drop policy if exists "entries: delete own or group owner" on public.journal_entries;
create policy "entries: delete own or group owner" on public.journal_entries for delete to authenticated
  using (user_id = auth.uid() or (group_id is not null and exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid())));

drop policy if exists "comments: read" on public.comments;
create policy "comments: read" on public.comments for select to authenticated
  using (exists (select 1 from journal_entries e where e.id = entry_id) and not is_blocked_between(auth.uid(), user_id));
drop policy if exists "comments: write" on public.comments;
create policy "comments: write" on public.comments for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from journal_entries e where e.id = entry_id and e.visibility <> 'private'));
drop policy if exists "comments: delete" on public.comments;
create policy "comments: delete" on public.comments for delete to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from journal_entries e left join groups g on g.id = e.group_id
    where e.id = entry_id and (e.user_id = auth.uid() or g.owner_id = auth.uid())));

drop policy if exists "reports: add" on public.reports;
create policy "reports: add" on public.reports for insert to authenticated with check (reporter_id = auth.uid());

-- ─────────────────────────────── actions (RPC) ───────────────────────────────
create or replace function public.upsert_profile(p_nickname text, p_avatar_path text default null, p_clear_avatar boolean default false)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); result profiles; new_tag text; attempts int := 0; v_nickname text := btrim(p_nickname);
begin
  if me is null then raise exception 'not signed in'; end if;
  if v_nickname is null or char_length(v_nickname) < 1 or char_length(v_nickname) > 20 or position('#' in v_nickname) > 0 then raise exception 'invalid nickname'; end if;
  if p_avatar_path is not null and split_part(p_avatar_path, '/', 1) <> me::text then raise exception 'invalid avatar'; end if;
  select * into result from profiles where user_id = me;
  -- keep the #tag unless the new nickname already uses it
  new_tag := result.tag;
  while new_tag is null or exists (select 1 from profiles p where p.nickname = v_nickname and p.tag = new_tag and p.user_id <> me) loop
    new_tag := lpad((floor(random() * 90000) + 10000)::int::text, 5, '0');
    attempts := attempts + 1;
    if attempts > 50 then raise exception 'no free tag'; end if;
  end loop;
  insert into profiles (user_id, nickname, tag, avatar_path, updated_at)
  values (me, v_nickname, new_tag, p_avatar_path, now())
  on conflict (user_id) do update set
    nickname = excluded.nickname,
    tag = excluded.tag,
    avatar_path = case when p_clear_avatar then null else coalesce(excluded.avatar_path, profiles.avatar_path) end,
    updated_at = now()
  returning * into result;
  return result;
end $$;

create or replace function public.add_friend(p_nickname text, p_tag text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); them profiles;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into them from profiles where nickname = btrim(p_nickname) and tag = btrim(p_tag);
  if them.user_id is null then raise exception 'not found'; end if;
  if them.user_id = me then raise exception 'self'; end if;
  if is_blocked_between(me, them.user_id) then raise exception 'not found'; end if; -- don't reveal blocks
  insert into friendships (user_id, friend_id) values (me, them.user_id), (them.user_id, me) on conflict do nothing;
  return them;
end $$;

create or replace function public.remove_friend(p_friend uuid) returns void
language sql security definer set search_path = public as $$
  delete from friendships where (user_id = auth.uid() and friend_id = p_friend) or (user_id = p_friend and friend_id = auth.uid());
$$;

create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_user = auth.uid() then raise exception 'invalid'; end if;
  insert into blocks (blocker_id, blocked_id) values (auth.uid(), p_user) on conflict do nothing;
  delete from friendships where (user_id = auth.uid() and friend_id = p_user) or (user_id = p_user and friend_id = auth.uid());
end $$;

create or replace function public.create_group(p_name text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g groups; code text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  loop
    code := '';
    for i in 1..8 loop code := code || substr(alphabet, (floor(random() * length(alphabet)) + 1)::int, 1); end loop;
    exit when not exists (select 1 from groups where invite_code = code);
  end loop;
  insert into groups (name, invite_code, owner_id) values (btrim(p_name), code, auth.uid()) returning * into g;
  insert into group_members (group_id, user_id) values (g.id, auth.uid());
  return g;
end $$;

create or replace function public.join_group(p_code text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into g from groups where invite_code = upper(btrim(p_code));
  if g.id is null or is_blocked_between(auth.uid(), g.owner_id) then raise exception 'not found'; end if;
  if (select count(*) from group_members where group_id = g.id) >= 50 then raise exception 'full'; end if;
  insert into group_members (group_id, user_id) values (g.id, auth.uid()) on conflict do nothing;
  return g;
end $$;

grant execute on function public.upsert_profile(text, text, boolean) to authenticated;
grant execute on function public.add_friend(text, text) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;

-- ─────────────────────────────── photo storage ───────────────────────────────
-- avatars: public pictures (shown next to nicknames). journal: private photos,
-- readable only by people who can read an entry that uses them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('journal', 'journal', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "avatars: upload own" on storage.objects;
create policy "avatars: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars: replace own" on storage.objects;
create policy "avatars: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars: delete own" on storage.objects;
create policy "avatars: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "journal: upload own" on storage.objects;
create policy "journal: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'journal' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "journal: delete own" on storage.objects;
create policy "journal: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'journal' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "journal: read if entry readable" on storage.objects;
create policy "journal: read if entry readable" on storage.objects for select to authenticated
  using (bucket_id = 'journal' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.journal_entries e where objects.name = any (e.photo_paths))  -- RLS on entries applies here
  ));
