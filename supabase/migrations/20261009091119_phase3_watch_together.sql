-- Phase 3: social watch rooms. Video playback is always delivered by the provider's official player.

create table public.watch_rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  media_id integer not null check (media_id > 0),
  episode integer not null check (episode > 0),
  adapter text not null check (adapter in ('youtube', 'vimeo', 'twitch', 'dailymotion', 'direct', 'hls', 'external')),
  source_ref text check (source_ref is null or char_length(source_ref) <= 2048),
  state text not null default 'paused' check (state in ('paused', 'playing')),
  position_seconds double precision not null default 0 check (position_seconds between 0 and 86400),
  state_updated_at timestamptz not null default now(),
  access text not null default 'invite' check (access in ('invite', 'friends', 'community')),
  community_id uuid references public.communities(id) on delete cascade,
  invite_code text unique,
  created_at timestamptz not null default now(),
  check ((access = 'community' and community_id is not null) or (access <> 'community' and community_id is null)),
  check ((access = 'invite' and invite_code is not null) or (access <> 'invite' and invite_code is null)),
  check (invite_code is null or char_length(invite_code) between 24 and 64),
  check ((adapter = 'external' and source_ref is null) or (adapter <> 'external' and source_ref is not null))
);
create index watch_rooms_host_created_idx on public.watch_rooms(host_id, created_at desc);
create index watch_rooms_community_idx on public.watch_rooms(community_id) where community_id is not null;
comment on table public.watch_rooms is 'A social room references one AniList media ID and episode; ARNS does not host or copy video content.';
comment on column public.watch_rooms.source_ref is 'Provider URL or direct/HLS URL supplied by the host; never a resolved or downloaded media URL.';

create table public.watch_room_members (
  room_id uuid not null references public.watch_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index watch_room_members_user_idx on public.watch_room_members(user_id, room_id);
comment on table public.watch_room_members is 'Authorized room participants; Presence remains the live participant list.';

create table public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.watch_rooms(id) on delete cascade,
  author uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index room_messages_room_created_idx on public.room_messages(room_id, created_at desc, id desc);
comment on table public.room_messages is 'Short-lived social chat for a watch room; separate from direct messages.';

create or replace function public.is_watch_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.watch_room_members m where m.room_id = p_room_id and m.user_id = auth.uid()
  );
$$;
revoke all on function public.is_watch_room_member(uuid) from public, anon;
grant execute on function public.is_watch_room_member(uuid) to authenticated;

create or replace function public.can_access_watch_room_topic()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null
    and split_part(realtime.topic(), ':', 1) = 'watch-room'
    and exists (
      select 1 from public.watch_room_members m
      where m.room_id::text = split_part(realtime.topic(), ':', 2) and m.user_id = auth.uid()
    );
$$;
revoke all on function public.can_access_watch_room_topic() from public, anon;
grant execute on function public.can_access_watch_room_topic() to authenticated;

alter table public.watch_rooms enable row level security;
alter table public.watch_room_members enable row level security;
alter table public.room_messages enable row level security;

create policy "Room participants read rooms" on public.watch_rooms for select to authenticated
using (public.is_watch_room_member(id));
create policy "Host creates own room" on public.watch_rooms for insert to authenticated
with check (host_id = auth.uid());
create policy "Only host updates room state" on public.watch_rooms for update to authenticated
using (host_id = auth.uid()) with check (host_id = auth.uid());
grant select, insert on public.watch_rooms to authenticated;
grant update (state, position_seconds, state_updated_at, episode, adapter, source_ref) on public.watch_rooms to authenticated;

create policy "Participants read room members" on public.watch_room_members for select to authenticated
using (public.is_watch_room_member(room_id));
create policy "Participants leave rooms" on public.watch_room_members for delete to authenticated
using (user_id = auth.uid() and exists (select 1 from public.watch_rooms r where r.id = room_id and r.host_id <> auth.uid()));
grant select, delete on public.watch_room_members to authenticated;

create policy "Participants read room chat" on public.room_messages for select to authenticated
using (public.is_watch_room_member(room_id));
create policy "Participants send room chat as themselves" on public.room_messages for insert to authenticated
with check (author = auth.uid() and exists (select 1 from public.watch_room_members m where m.room_id = room_id and m.user_id = auth.uid()));
grant select, insert on public.room_messages to authenticated;

create policy "Room members receive private realtime events" on realtime.messages for select to authenticated
using (extension in ('broadcast', 'presence') and public.can_access_watch_room_topic());
create policy "Room members publish presence and allowed broadcasts" on realtime.messages for insert to authenticated
with check (extension in ('broadcast', 'presence') and public.can_access_watch_room_topic());

alter publication supabase_realtime add table public.watch_rooms;
alter publication supabase_realtime add table public.room_messages;

-- All room creation, joining, messages, and host transfer are mediated by the JWT-verifying Edge Function.
revoke insert, update, delete on public.watch_rooms from authenticated;
revoke insert, update, delete on public.watch_room_members from authenticated;
revoke insert, update, delete on public.room_messages from authenticated;
grant update (state, position_seconds, state_updated_at, episode, adapter, source_ref) on public.watch_rooms to authenticated;
