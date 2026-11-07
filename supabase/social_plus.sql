-- 계획 있는 척 — friend requests, invite links, notifications, reactions,
-- place cards sent to friends, and "friends who went here".
-- Run AFTER social.sql. Supabase → SQL Editor → New query → Run. Safe to run again.
--
-- What changes for people:
--   * adding someone by nickname#tag sends a REQUEST; they become friends
--     only when the other person accepts (or already asked you)
--   * an invite link carries a one-time secret token (not the #tag), so
--     opening it makes you friends right away
--   * reactions (❤️ 👍 😂 😮 🥹) on entries you can see
--   * an inbox: friend requests, accepted requests, comments and reactions
--     on your entries, and place cards friends sent you
--   * a place card can be sent to a friend; they can keep it in their envelope
--   * a recommendation card can show how many friends went there — counted
--     only from entries they shared with you

-- ─────────────────────────────── tables ───────────────────────────────
create table if not exists public.friend_requests (
  from_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  to_id      uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_id, to_id),
  check (from_id <> to_id)
);
create index if not exists friend_requests_to on public.friend_requests (to_id, created_at desc);

create table if not exists public.friend_invites (
  token      text primary key check (token ~ '^[A-Za-z0-9]{20}$'),
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  actor_id   uuid references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('friend_request', 'friend_accepted', 'comment', 'reaction', 'card', 'together_invite', 'together_item')),
  entry_id   uuid references public.journal_entries (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);

create table if not exists public.reactions (
  entry_id   uuid not null references public.journal_entries (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji      text not null check (emoji in ('❤️', '👍', '😂', '😮', '🥹')),
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id, emoji)
);

create table if not exists public.shared_cards (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  to_id      uuid not null references auth.users (id) on delete cascade,
  place      jsonb not null check (jsonb_typeof(place) = 'object' and length(place::text) <= 4000 and place ? 'id' and place ? 'name'),
  note       text check (note is null or char_length(note) <= 100),
  created_at timestamptz not null default now(),
  seen_at    timestamptz,
  check (from_id <> to_id)
);
create index if not exists shared_cards_to on public.shared_cards (to_id, created_at desc);

-- ─────────────────────────────── helpers ───────────────────────────────
create or replace function public.has_request_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friend_requests where (from_id = a and to_id = b) or (from_id = b and to_id = a))
$$;

create or replace function public.make_friends(a uuid, b uuid) returns void
language sql security definer set search_path = public as $$
  insert into friendships (user_id, friend_id) values (a, b), (b, a) on conflict do nothing;
  delete from friend_requests where (from_id = a and to_id = b) or (from_id = b and to_id = a);
$$;

-- one place to create notifications; never to yourself or across a block
create or replace function public.notify(p_user uuid, p_actor uuid, p_kind text, p_entry uuid default null, p_data jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor or is_blocked_between(p_user, p_actor) then return; end if;
  insert into notifications (user_id, actor_id, kind, entry_id, data) values (p_user, p_actor, p_kind, p_entry, coalesce(p_data, '{}'::jsonb));
end $$;
revoke all on function public.notify(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.make_friends(uuid, uuid) from public, anon, authenticated;

-- people with a pending request may see each other's nickname and photo
drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles for select to authenticated
  using (user_id = auth.uid() or ((is_friend(auth.uid(), user_id) or shares_group(auth.uid(), user_id) or has_request_between(auth.uid(), user_id)) and not is_blocked_between(auth.uid(), user_id)));

-- ─────────────────────────────── RLS ───────────────────────────────
alter table public.friend_requests enable row level security;
alter table public.friend_invites  enable row level security;
alter table public.notifications   enable row level security;
alter table public.reactions       enable row level security;
alter table public.shared_cards    enable row level security;

drop policy if exists "requests: read own" on public.friend_requests;
create policy "requests: read own" on public.friend_requests for select to authenticated using (from_id = auth.uid() or to_id = auth.uid());
drop policy if exists "requests: cancel or decline" on public.friend_requests;
create policy "requests: cancel or decline" on public.friend_requests for delete to authenticated using (from_id = auth.uid() or to_id = auth.uid());

drop policy if exists "invites: read own" on public.friend_invites;
create policy "invites: read own" on public.friend_invites for select to authenticated using (owner_id = auth.uid());

drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "notifications: mark read" on public.notifications;
create policy "notifications: mark read" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "notifications: clear" on public.notifications;
create policy "notifications: clear" on public.notifications for delete to authenticated using (user_id = auth.uid());

drop policy if exists "reactions: read" on public.reactions;
create policy "reactions: read" on public.reactions for select to authenticated
  using (not is_blocked_between(auth.uid(), user_id)
         and exists (select 1 from journal_entries e where e.id = entry_id and can_read_entry(e.user_id, e.visibility, e.group_id)));
drop policy if exists "reactions: add" on public.reactions;
create policy "reactions: add" on public.reactions for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from journal_entries e where e.id = entry_id and can_read_entry(e.user_id, e.visibility, e.group_id)));
drop policy if exists "reactions: remove own" on public.reactions;
create policy "reactions: remove own" on public.reactions for delete to authenticated using (user_id = auth.uid());

drop policy if exists "cards: read own" on public.shared_cards;
create policy "cards: read own" on public.shared_cards for select to authenticated
  using ((from_id = auth.uid() or to_id = auth.uid()) and not is_blocked_between(from_id, to_id));
drop policy if exists "cards: send to friends" on public.shared_cards;
create policy "cards: send to friends" on public.shared_cards for insert to authenticated
  with check (from_id = auth.uid() and is_friend(auth.uid(), to_id) and not is_blocked_between(auth.uid(), to_id));
drop policy if exists "cards: mark seen" on public.shared_cards;
create policy "cards: mark seen" on public.shared_cards for update to authenticated using (to_id = auth.uid()) with check (to_id = auth.uid());
drop policy if exists "cards: remove" on public.shared_cards;
create policy "cards: remove" on public.shared_cards for delete to authenticated using (from_id = auth.uid() or to_id = auth.uid());

-- ─────────────────────────────── notifications from activity ───────────────────────────────
create or replace function public.on_comment_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select user_id into owner from journal_entries where id = new.entry_id;
  perform notify(owner, new.user_id, 'comment', new.entry_id, jsonb_build_object('body', left(new.body, 80)));
  return new;
end $$;
drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments for each row execute function public.on_comment_notify();

create or replace function public.on_reaction_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select user_id into owner from journal_entries where id = new.entry_id;
  perform notify(owner, new.user_id, 'reaction', new.entry_id, jsonb_build_object('emoji', new.emoji));
  return new;
end $$;
drop trigger if exists reactions_notify on public.reactions;
create trigger reactions_notify after insert on public.reactions for each row execute function public.on_reaction_notify();

create or replace function public.on_card_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify(new.to_id, new.from_id, 'card', null, jsonb_build_object('card_id', new.id, 'place_name', left(new.place ->> 'name', 80)));
  return new;
end $$;
drop trigger if exists cards_notify on public.shared_cards;
create trigger cards_notify after insert on public.shared_cards for each row execute function public.on_card_notify();

-- ─────────────────────────────── actions (RPC) ───────────────────────────────
-- nickname#tag → a request ('requested'), or friends at once when they had
-- already asked you ('accepted'), or nothing to do ('already')
create or replace function public.request_friend(p_nickname text, p_tag text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); them profiles;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into them from profiles where nickname = btrim(p_nickname) and tag = btrim(p_tag);
  if them.user_id is null or is_blocked_between(me, them.user_id) then raise exception 'not found'; end if;
  if them.user_id = me then raise exception 'self'; end if;
  if is_friend(me, them.user_id) then return 'already'; end if;
  if exists (select 1 from friend_requests where from_id = them.user_id and to_id = me) then
    perform make_friends(me, them.user_id);
    perform notify(them.user_id, me, 'friend_accepted');
    return 'accepted';
  end if;
  if (select count(*) from friend_requests where from_id = me) >= 50 then raise exception 'too many'; end if;
  if not exists (select 1 from friend_requests where from_id = me and to_id = them.user_id) then
    insert into friend_requests (from_id, to_id) values (me, them.user_id);
    perform notify(them.user_id, me, 'friend_request');
  end if;
  return 'requested';
end $$;

create or replace function public.respond_friend(p_from uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from friend_requests where from_id = p_from and to_id = me) then raise exception 'not found'; end if;
  if p_accept then
    perform make_friends(me, p_from);
    perform notify(p_from, me, 'friend_accepted');
  else
    delete from friend_requests where from_id = p_from and to_id = me;
  end if;
  delete from notifications where user_id = me and actor_id = p_from and kind = 'friend_request';
end $$;

-- an invite link: a random token only you hand out (valid 14 days)
create or replace function public.create_friend_invite() returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; i int;
begin
  if me is null then raise exception 'not signed in'; end if;
  delete from friend_invites where owner_id = me and expires_at < now();
  if (select count(*) from friend_invites where owner_id = me) >= 20 then
    delete from friend_invites where token in (select token from friend_invites where owner_id = me order by created_at limit 5);
  end if;
  loop
    t := '';
    for i in 1..20 loop t := t || substr(alphabet, (floor(random() * length(alphabet)) + 1)::int, 1); end loop;
    exit when not exists (select 1 from friend_invites where token = t);
  end loop;
  insert into friend_invites (token, owner_id) values (t, me);
  return t;
end $$;

create or replace function public.accept_friend_invite(p_token text) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); inv friend_invites; them profiles;
begin
  if me is null then raise exception 'not signed in'; end if;
  select * into inv from friend_invites where token = btrim(p_token) and expires_at > now();
  if inv.owner_id is null or is_blocked_between(me, inv.owner_id) then raise exception 'not found'; end if;
  if inv.owner_id = me then raise exception 'self'; end if;
  perform make_friends(me, inv.owner_id);
  perform notify(inv.owner_id, me, 'friend_accepted');
  select * into them from profiles where user_id = inv.owner_id;
  return them;
end $$;

-- "friends went here": counted only from entries they shared with you
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
    and can_read_entry(e.user_id, e.visibility, e.group_id)
  group by e.place_id
$$;

-- adding by #tag now goes through a request; the old instant add is retired
revoke execute on function public.add_friend(text, text) from authenticated;

grant execute on function public.request_friend(text, text) to authenticated;
grant execute on function public.respond_friend(uuid, boolean) to authenticated;
grant execute on function public.create_friend_invite() to authenticated;
grant execute on function public.accept_friend_invite(text) to authenticated;
grant execute on function public.friend_traces(text[]) to authenticated;
grant execute on function public.has_request_between(uuid, uuid) to authenticated;
