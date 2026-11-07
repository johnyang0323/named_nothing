-- 계획 있는 척 — one entry, shown in several places at once.
-- Run AFTER social.sql and social_plus.sql. SQL Editor → New query → Run. Safe to run again.
--
-- Before: an entry was shown to ONE audience (나만 보기 / 친구에게 / one 단체방).
-- After:  "친구에게" and any number of 단체방 (up to 10) can be picked together.
--         Nothing picked = 나만 보기.
--
-- The old columns (visibility, group_id) are kept in step automatically, so
-- older versions of the app keep working.

alter table public.journal_entries
  add column if not exists share_friends boolean not null default false,
  add column if not exists group_ids uuid[] not null default '{}';

do $$ begin
  alter table public.journal_entries add constraint journal_entries_group_ids_max check (cardinality(group_ids) <= 10);
exception when duplicate_object then null; end $$;

create index if not exists journal_entries_group_ids on public.journal_entries using gin (group_ids);
create index if not exists journal_entries_share_friends on public.journal_entries (created_at desc) where share_friends;

-- carry over what was already shared (only rows not yet converted)
update public.journal_entries
   set share_friends = (visibility = 'friends'),
       group_ids = case when visibility = 'group' and group_id is not null then array[group_id] else '{}' end
 where share_friends = false and group_ids = '{}' and visibility <> 'private';

-- keep old and new columns in step, and only allow rooms you are in
create or replace function public.journal_entries_audience() returns trigger
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  -- an older app changed visibility/group_id only: follow it
  if tg_op = 'INSERT' then
    if not new.share_friends and cardinality(new.group_ids) = 0 and new.visibility <> 'private' then
      new.share_friends := new.visibility = 'friends';
      new.group_ids := case when new.visibility = 'group' and new.group_id is not null then array[new.group_id] else '{}' end;
    end if;
  elsif new.share_friends is not distinct from old.share_friends and new.group_ids is not distinct from old.group_ids
        and (new.visibility is distinct from old.visibility or (new.group_id is distinct from old.group_id and new.group_id is not null)) then
    new.share_friends := new.visibility = 'friends';
    new.group_ids := case when new.visibility = 'group' and new.group_id is not null then array[new.group_id] else '{}' end;
  end if;

  -- no duplicates, rooms that still exist
  new.group_ids := coalesce(array(select distinct x from unnest(new.group_ids) x where exists (select 1 from groups where id = x)), '{}');

  -- newly added rooms: must be a member
  foreach g in array new.group_ids loop
    if (tg_op = 'INSERT' or not (g = any (old.group_ids))) and not is_member(g, new.user_id) then
      raise exception 'not a member of that group';
    end if;
  end loop;

  new.visibility := case when cardinality(new.group_ids) > 0 and not new.share_friends then 'group'
                         when new.share_friends then 'friends' else 'private' end;
  new.group_id := new.group_ids[1];
  return new;
end $$;

drop trigger if exists journal_entries_audience on public.journal_entries;
create trigger journal_entries_audience before insert or update on public.journal_entries
  for each row execute function public.journal_entries_audience();

-- a deleted room disappears from every entry
create or replace function public.on_group_deleted_entries() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update journal_entries set group_ids = array_remove(group_ids, old.id) where old.id = any (group_ids);
  return old;
end $$;
drop trigger if exists groups_deleted_entries on public.groups;
create trigger groups_deleted_entries after delete on public.groups for each row execute function public.on_group_deleted_entries();

-- who may read an entry
create or replace function public.can_read_entry_v2(owner uuid, friends boolean, groups uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select owner = auth.uid()
    or (not is_blocked_between(owner, auth.uid()) and (
         (friends and is_friend(auth.uid(), owner))
      or exists (select 1 from unnest(groups) g where is_member(g, auth.uid()))
    ))
$$;

create or replace function public.can_read_entry_id(i uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from journal_entries e where e.id = i and can_read_entry_v2(e.user_id, e.share_friends, e.group_ids))
$$;

create or replace function public.owns_room_of_entry(i uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from journal_entries e join groups g on g.id = any (e.group_ids) where e.id = i and g.owner_id = u)
$$;

drop policy if exists "entries: read" on public.journal_entries;
create policy "entries: read" on public.journal_entries for select to authenticated
  using (can_read_entry_v2(user_id, share_friends, group_ids));
-- (room membership is checked by the trigger above)
drop policy if exists "entries: write own" on public.journal_entries;
create policy "entries: write own" on public.journal_entries for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "entries: edit own" on public.journal_entries;
create policy "entries: edit own" on public.journal_entries for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- a room owner takes an entry out of their room (remove_entry_from_group) instead of deleting it everywhere
drop policy if exists "entries: delete own or group owner" on public.journal_entries;
drop policy if exists "entries: delete own" on public.journal_entries;
create policy "entries: delete own" on public.journal_entries for delete to authenticated using (user_id = auth.uid());

drop policy if exists "comments: delete" on public.comments;
create policy "comments: delete" on public.comments for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from journal_entries e where e.id = entry_id and e.user_id = auth.uid())
         or owns_room_of_entry(entry_id, auth.uid()));

drop policy if exists "reactions: read" on public.reactions;
create policy "reactions: read" on public.reactions for select to authenticated
  using (not is_blocked_between(auth.uid(), user_id) and can_read_entry_id(entry_id));
drop policy if exists "reactions: add" on public.reactions;
create policy "reactions: add" on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and can_read_entry_id(entry_id));

create or replace function public.friend_traces(p_place_ids text[])
returns table (place_id text, friends int, nicknames text[])
language sql stable security definer set search_path = public as $$
  select e.place_id, count(distinct e.user_id)::int, (array_agg(distinct pr.nickname))[1:3]
  from journal_entries e
  join profiles pr on pr.user_id = e.user_id
  where auth.uid() is not null
    and e.place_id = any (p_place_ids[1:50])
    and e.user_id <> auth.uid()
    and is_friend(auth.uid(), e.user_id)
    and can_read_entry_v2(e.user_id, e.share_friends, e.group_ids)
  group by e.place_id
$$;

-- room owner: take someone's entry out of this room (it stays wherever else it was shared)
create or replace function public.remove_entry_from_group(p_entry uuid, p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from groups where id = p_group and owner_id = auth.uid()) then raise exception 'not the owner'; end if;
  update journal_entries set group_ids = array_remove(group_ids, p_group) where id = p_entry;
end $$;

grant execute on function public.remove_entry_from_group(uuid, uuid) to authenticated;
grant execute on function public.can_read_entry_v2(uuid, boolean, uuid[]) to authenticated;
grant execute on function public.can_read_entry_id(uuid) to authenticated;
