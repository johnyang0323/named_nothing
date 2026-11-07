-- 계획 있는 척 — 함께 하루: a shared envelope for going out together.
-- Run AFTER social.sql and social_plus.sql. SQL Editor → New query → Run. Safe to run again.
--
-- Someone starts a "함께 하루" with a few friends. Everyone in it can drop
-- places into the shared envelope while swiping cards, vote 👍 on what's
-- in it, and head out to the favourite. Only members see any of it.

create table if not exists public.together_days (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 30),
  created_at timestamptz not null default now()
);

create table if not exists public.together_members (
  day_id    uuid not null references public.together_days (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (day_id, user_id)
);

create table if not exists public.together_items (
  id         uuid primary key default gen_random_uuid(),
  day_id     uuid not null references public.together_days (id) on delete cascade,
  place_id   text not null check (char_length(place_id) <= 40),
  place      jsonb not null check (jsonb_typeof(place) = 'object' and length(place::text) <= 4000 and place ? 'name'),
  added_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (day_id, place_id)
);
create index if not exists together_items_day on public.together_items (day_id, created_at);

create table if not exists public.together_votes (
  item_id    uuid not null references public.together_items (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create or replace function public.is_together_member(d uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from together_members where day_id = d and user_id = u)
$$;

create or replace function public.together_day_of_item(i uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select day_id from together_items where id = i
$$;

alter table public.together_days    enable row level security;
alter table public.together_members enable row level security;
alter table public.together_items   enable row level security;
alter table public.together_votes   enable row level security;

drop policy if exists "together days: members read" on public.together_days;
create policy "together days: members read" on public.together_days for select to authenticated using (is_together_member(id, auth.uid()));
drop policy if exists "together days: owner renames" on public.together_days;
create policy "together days: owner renames" on public.together_days for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "together days: owner ends" on public.together_days;
create policy "together days: owner ends" on public.together_days for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "together members: members read" on public.together_members;
create policy "together members: members read" on public.together_members for select to authenticated using (is_together_member(day_id, auth.uid()));
drop policy if exists "together members: leave or owner removes" on public.together_members;
create policy "together members: leave or owner removes" on public.together_members for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from together_days d where d.id = day_id and d.owner_id = auth.uid()));

drop policy if exists "together items: members read" on public.together_items;
create policy "together items: members read" on public.together_items for select to authenticated using (is_together_member(day_id, auth.uid()));
drop policy if exists "together items: members add" on public.together_items;
create policy "together items: members add" on public.together_items for insert to authenticated
  with check (added_by = auth.uid() and is_together_member(day_id, auth.uid()));
drop policy if exists "together items: remove own or owner" on public.together_items;
create policy "together items: remove own or owner" on public.together_items for delete to authenticated
  using (added_by = auth.uid() or exists (select 1 from together_days d where d.id = day_id and d.owner_id = auth.uid()));

drop policy if exists "together votes: members read" on public.together_votes;
create policy "together votes: members read" on public.together_votes for select to authenticated
  using (is_together_member(together_day_of_item(item_id), auth.uid()));
drop policy if exists "together votes: members vote" on public.together_votes;
create policy "together votes: members vote" on public.together_votes for insert to authenticated
  with check (user_id = auth.uid() and is_together_member(together_day_of_item(item_id), auth.uid()));
drop policy if exists "together votes: take back own" on public.together_votes;
create policy "together votes: take back own" on public.together_votes for delete to authenticated using (user_id = auth.uid());

-- members can see each other's nickname and photo
drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles for select to authenticated
  using (user_id = auth.uid() or ((is_friend(auth.uid(), user_id) or shares_group(auth.uid(), user_id) or has_request_between(auth.uid(), user_id)
         or exists (select 1 from together_members a join together_members b on a.day_id = b.day_id where a.user_id = auth.uid() and b.user_id = profiles.user_id))
        and not is_blocked_between(auth.uid(), user_id)));

-- start one with friends (others are skipped quietly); everyone invited is told
create or replace function public.create_together_day(p_title text, p_members uuid[]) returns public.together_days
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); d together_days; m uuid;
begin
  if me is null then raise exception 'not signed in'; end if;
  if btrim(coalesce(p_title, '')) = '' or char_length(btrim(p_title)) > 30 then raise exception 'invalid title'; end if;
  if (select count(*) from together_days where owner_id = me and created_at > now() - interval '1 day') >= 20 then raise exception 'too many'; end if;
  insert into together_days (owner_id, title) values (me, btrim(p_title)) returning * into d;
  insert into together_members (day_id, user_id) values (d.id, me);
  foreach m in array coalesce(p_members[1:10], '{}') loop
    if m <> me and is_friend(me, m) and not is_blocked_between(me, m) then
      insert into together_members (day_id, user_id) values (d.id, m) on conflict do nothing;
      perform notify(m, me, 'together_invite', null, jsonb_build_object('day_id', d.id, 'title', d.title));
    end if;
  end loop;
  return d;
end $$;

create or replace function public.on_together_item_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  for m in select user_id from together_members where day_id = new.day_id and user_id <> new.added_by loop
    perform notify(m, new.added_by, 'together_item', null, jsonb_build_object('day_id', new.day_id, 'place_name', left(new.place ->> 'name', 80)));
  end loop;
  return new;
end $$;
drop trigger if exists together_items_notify on public.together_items;
create trigger together_items_notify after insert on public.together_items for each row execute function public.on_together_item_notify();

grant execute on function public.create_together_day(text, uuid[]) to authenticated;
grant execute on function public.is_together_member(uuid, uuid) to authenticated;
