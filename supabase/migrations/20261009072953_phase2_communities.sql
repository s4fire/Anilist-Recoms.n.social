-- Communities, member moderation, account blocking, and custom community emojis.
-- Anime references remain IDs only; titles and artwork are fetched from AniList.

alter table public.profiles add column is_admin boolean not null default false;
comment on column public.profiles.is_admin is 'Site-wide moderator bit. Changes are allowed only from direct SQL sessions, never from application requests.';

create table public.user_blocks (
  blocker uuid not null references public.profiles(id) on delete cascade,
  blocked uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
comment on table public.user_blocks is 'One-way personal blocks; both directions prevent private messages and friend requests.';

create or replace function public.user_pair_is_blocked(p_user_id uuid, p_other_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case when auth.uid() = p_user_id or coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    exists (select 1 from public.user_blocks b where (b.blocker = p_user_id and b.blocked = p_other_id) or (b.blocker = p_other_id and b.blocked = p_user_id))
  else true end;
$$;
revoke all on function public.user_pair_is_blocked(uuid, uuid) from public, anon;
grant execute on function public.user_pair_is_blocked(uuid, uuid) to authenticated, service_role;

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 64),
  description text not null default '' check (char_length(description) <= 500),
  visibility text not null default 'public' check (visibility in ('public', 'unlisted')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.communities is 'Anime communities. Public means discoverable; unlisted hides a community from discovery but keeps direct authenticated access.';

create table public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'mod', 'member')),
  joined_at timestamptz not null default now(),
  primary key (community_id, member_id)
);
comment on table public.community_members is 'Community membership and role. Role changes are restricted to the owner through the moderation function.';

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9][a-z0-9-]{1,31}$'),
  kind text not null check (kind in ('chat', 'threads')),
  position smallint not null default 0 check (position between 0 and 99),
  media_id integer check (media_id is null or media_id > 0),
  episode integer check (episode is null or episode > 0),
  created_at timestamptz not null default now(),
  check (media_id is not null or episode is null),
  unique (community_id, name)
);
create index channels_community_position_idx on public.channels(community_id, position, id);
comment on table public.channels is 'Community chat or discussion channels with optional AniList media ID and episode reference.';

create table public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  media_id integer check (media_id is null or media_id > 0),
  episode integer check (episode is null or episode > 0),
  created_at timestamptz not null default now(),
  check (media_id is not null or episode is null)
);
create index channel_messages_channel_created_idx on public.channel_messages(channel_id, created_at desc, id desc);
comment on table public.channel_messages is 'Member-authored community messages with optional AniList ID and episode reference.';

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references public.profiles(id) on delete cascade,
  community_id uuid references public.communities(id) on delete cascade,
  target_type text not null check (target_type in ('message', 'emoji', 'community')),
  target_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check (target_type <> 'community' or (community_id is not null and community_id = target_id))
);
create index reports_open_community_idx on public.reports(community_id, created_at desc) where status = 'open';
comment on table public.reports is 'User reports for a community message, custom emoji, or community.';

create table public.mod_actions (
  id uuid primary key default gen_random_uuid(),
  community_id uuid references public.communities(id) on delete set null,
  actor uuid references public.profiles(id) on delete set null,
  action text not null check (char_length(action) between 1 and 40),
  target_type text not null check (char_length(target_type) between 1 and 24),
  target_id uuid,
  target_user uuid references public.profiles(id) on delete set null,
  reason text not null default '' check (char_length(reason) <= 500),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index mod_actions_community_created_idx on public.mod_actions(community_id, created_at desc);
comment on table public.mod_actions is 'Append-only moderation audit log; browser roles cannot insert, update, or delete actions.';

create table public.community_bans (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor uuid references public.profiles(id) on delete set null,
  reason text not null default '' check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
comment on table public.community_bans is 'Community-specific bans; site-wide bans use site_bans.';

create table public.community_mutes (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor uuid references public.profiles(id) on delete set null,
  reason text not null default '' check (char_length(reason) <= 500),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
comment on table public.community_mutes is 'Timed community posting mutes.';

create table public.site_bans (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  actor uuid references public.profiles(id) on delete set null,
  reason text not null default '' check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
comment on table public.site_bans is 'Site-wide bans applied only by a site administrator.';

create table public.community_emojis (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9_]{2,32}$'),
  path text not null unique check (char_length(path) <= 180),
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (community_id, name)
);
comment on table public.community_emojis is 'Metadata for 128x128-or-smaller PNG, WebP, or GIF community emojis in community-emojis storage.';

-- These narrow helpers bypass RLS only to check the caller's own posting eligibility.
create or replace function public.community_user_is_blocked(p_user_id uuid, p_community_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case when auth.uid() = p_user_id or coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    exists (select 1 from public.community_bans b where b.community_id = p_community_id and b.user_id = p_user_id)
    or exists (select 1 from public.site_bans b where b.user_id = p_user_id)
  else true end;
$$;
create or replace function public.community_user_can_post(p_user_id uuid, p_community_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case when auth.uid() = p_user_id or coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    exists (select 1 from public.community_members m where m.community_id = p_community_id and m.member_id = p_user_id)
    and not exists (select 1 from public.community_bans b where b.community_id = p_community_id and b.user_id = p_user_id)
    and not exists (select 1 from public.community_mutes m where m.community_id = p_community_id and m.user_id = p_user_id and m.expires_at > now())
    and not exists (select 1 from public.site_bans b where b.user_id = p_user_id)
  else false end;
$$;
revoke all on function public.community_user_is_blocked(uuid, uuid), public.community_user_can_post(uuid, uuid) from public, anon;
grant execute on function public.community_user_is_blocked(uuid, uuid), public.community_user_can_post(uuid, uuid) to authenticated, service_role;

alter table public.user_blocks enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.channels enable row level security;
alter table public.channel_messages enable row level security;
alter table public.reports enable row level security;
alter table public.mod_actions enable row level security;
alter table public.community_bans enable row level security;
alter table public.community_mutes enable row level security;
alter table public.site_bans enable row level security;
alter table public.community_emojis enable row level security;

create policy blocks_self_manage on public.user_blocks for all to authenticated
  using (blocker = (select auth.uid()))
  with check (blocker = (select auth.uid()) and blocked <> (select auth.uid()));

create or replace function public.my_blocked_user_profiles()
returns table (id uuid, username text, avatar_url text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.username, p.avatar_url
  from public.user_blocks b join public.profiles p on p.id = b.blocked
  where auth.uid() is not null and b.blocker = auth.uid()
  order by lower(p.username);
$$;
revoke all on function public.my_blocked_user_profiles() from public, anon, authenticated;
grant execute on function public.my_blocked_user_profiles() to authenticated;

create policy communities_read_authenticated on public.communities for select to authenticated using (true);
create policy communities_create_self on public.communities for insert to authenticated with check (
  created_by = (select auth.uid()) and not public.community_user_is_blocked((select auth.uid()), null)
);
create policy communities_update_owner on public.communities for update to authenticated
  using (created_by = (select auth.uid()) and not public.community_user_is_blocked((select auth.uid()), id))
  with check (created_by = (select auth.uid()) and not public.community_user_is_blocked((select auth.uid()), id));

create or replace function public.seed_community_defaults()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.community_members(community_id, member_id, role) values (new.id, new.created_by, 'owner');
  insert into public.channels(community_id, name, kind, position) values
    (new.id, 'general', 'chat', 0), (new.id, 'recommendations', 'threads', 1);
  return new;
end;
$$;
revoke all on function public.seed_community_defaults() from public, anon, authenticated;
create trigger communities_seed_defaults after insert on public.communities for each row execute function public.seed_community_defaults();

create policy community_members_read on public.community_members for select to authenticated
  using (exists (select 1 from public.communities c where c.id = community_id));
create policy community_members_join_self on public.community_members for insert to authenticated
  with check (member_id = (select auth.uid()) and role = 'member'
    and not public.community_user_is_blocked((select auth.uid()), community_members.community_id));
create policy community_members_leave_self on public.community_members for delete to authenticated
  using (member_id = (select auth.uid()) and role = 'member');

create or replace function public.guard_channel_limit()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.community_id is distinct from old.community_id or new.created_at is distinct from old.created_at) then
    raise exception 'Channel identity cannot be changed.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    perform 1 from public.communities where id = new.community_id for update;
    if (select count(*) from public.channels where community_id = new.community_id) >= 20 then
      raise exception 'A community can have at most 20 channels.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger channels_guard_limit before insert or update on public.channels for each row execute function public.guard_channel_limit();

create policy channels_read on public.channels for select to authenticated using (exists (
  select 1 from public.communities c where c.id = community_id
));
create policy channels_insert_mod on public.channels for insert to authenticated with check (
  not public.community_user_is_blocked((select auth.uid()), channels.community_id)
  and exists (select 1 from public.community_members m where m.community_id = channels.community_id and m.member_id = (select auth.uid()) and m.role in ('owner','mod'))
);
create policy channels_update_mod on public.channels for update to authenticated
  using (not public.community_user_is_blocked((select auth.uid()), channels.community_id) and exists (select 1 from public.community_members m where m.community_id = channels.community_id and m.member_id = (select auth.uid()) and m.role in ('owner','mod')))
  with check (not public.community_user_is_blocked((select auth.uid()), channels.community_id) and exists (select 1 from public.community_members m where m.community_id = channels.community_id and m.member_id = (select auth.uid()) and m.role in ('owner','mod')));

create policy channel_messages_read on public.channel_messages for select to authenticated using (exists (
  select 1 from public.channels ch join public.communities c on c.id = ch.community_id
  where ch.id = channel_id and (c.visibility = 'public' or exists (
    select 1 from public.community_members m where m.community_id = c.id and m.member_id = (select auth.uid())
  ))
));
create policy channel_messages_insert_member on public.channel_messages for insert to authenticated with check (
  author = (select auth.uid()) and exists (
    select 1 from public.channels ch
    where ch.id = channel_messages.channel_id
      and public.community_user_can_post((select auth.uid()), ch.community_id)
  )
);

create policy reports_submit_self on public.reports for insert to authenticated with check (
  reporter = (select auth.uid()) and status = 'open' and closed_at is null
  and (community_id is null or exists (select 1 from public.communities c where c.id = community_id))
);
create policy reports_read_reporter_or_mod on public.reports for select to authenticated using (
  reporter = (select auth.uid())
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  or exists (select 1 from public.community_members m where m.community_id = reports.community_id and m.member_id = (select auth.uid()) and m.role in ('owner','mod'))
);

create policy mod_actions_read_mod on public.mod_actions for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  or exists (select 1 from public.community_members m where m.community_id = mod_actions.community_id and m.member_id = (select auth.uid()) and m.role in ('owner','mod'))
);
create policy community_bans_read_mod on public.community_bans for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  or exists (select 1 from public.community_members m where m.community_id = community_bans.community_id and m.member_id = (select auth.uid()) and m.role in ('owner','mod'))
);
create policy community_mutes_read_mod on public.community_mutes for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  or exists (select 1 from public.community_members m where m.community_id = community_mutes.community_id and m.member_id = (select auth.uid()) and m.role in ('owner','mod'))
);
create policy site_bans_read_admin on public.site_bans for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
);

create policy community_emojis_read on public.community_emojis for select to authenticated using (true);
-- Emoji metadata writes use emoji-upload, which validates role, media bytes, dimensions, size, uniqueness, and quotas.

create or replace function public.community_member_profiles(p_community_id uuid)
returns table (id uuid, username text, avatar_url text, role text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.username, p.avatar_url, m.role
  from public.community_members m join public.profiles p on p.id = m.member_id
  where auth.uid() is not null and exists (select 1 from public.communities c where c.id = p_community_id)
    and m.community_id = p_community_id;
$$;
comment on function public.community_member_profiles(uuid) is 'Returns minimal display fields for members of one authenticated community.';
revoke all on function public.community_member_profiles(uuid) from public, anon, authenticated;
grant execute on function public.community_member_profiles(uuid) to authenticated;

create or replace function public.community_sanction_profiles(p_community_id uuid)
returns table (id uuid, username text, restriction text, reason text, expires_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.user_id, p.username, 'ban'::text, b.reason, null::timestamptz
  from public.community_bans b join public.profiles p on p.id = b.user_id
  where b.community_id = p_community_id and auth.uid() is not null and (
    exists (select 1 from public.profiles a where a.id = auth.uid() and a.is_admin)
    or exists (select 1 from public.community_members m where m.community_id = p_community_id and m.member_id = auth.uid() and m.role in ('owner','mod'))
  )
  union all
  select m.user_id, p.username, 'mute'::text, m.reason, m.expires_at
  from public.community_mutes m join public.profiles p on p.id = m.user_id
  where m.community_id = p_community_id and m.expires_at > now() and auth.uid() is not null and (
    exists (select 1 from public.profiles a where a.id = auth.uid() and a.is_admin)
    or exists (select 1 from public.community_members cm where cm.community_id = p_community_id and cm.member_id = auth.uid() and cm.role in ('owner','mod'))
  );
$$;
revoke all on function public.community_sanction_profiles(uuid) from public, anon, authenticated;
grant execute on function public.community_sanction_profiles(uuid) to authenticated;

