-- Morrow social layer schema. AniList remains the source of truth for media metadata.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  anilist_id integer not null unique check (anilist_id > 0),
  username text not null check (char_length(btrim(username)) between 1 and 64),
  avatar_url text,
  banner_url text,
  created_at timestamptz not null default now()
);
comment on table public.profiles is 'Minimal identity cache for authenticated AniList users; never stores list or media details.';
comment on column public.profiles.anilist_id is 'Stable identity from AniList. No user AniList token is stored.';

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  constraint friendships_no_self_check check (requester <> addressee)
);
-- Treat the pair as unordered: a second row in the reverse direction is not allowed.
create unique index if not exists friendships_unordered_pair_uidx
  on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_requester_status_idx on public.friendships (requester, status, created_at desc);
create index if not exists friendships_addressee_status_idx on public.friendships (addressee, status, created_at desc);
comment on table public.friendships is 'One unordered relationship per pair; a declined request may be reopened by its original requester.';

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references public.profiles (id) on delete cascade,
  recipient uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_no_self_check check (sender <> recipient)
);
create index if not exists messages_sender_recipient_created_idx on public.messages (sender, recipient, created_at desc, id desc);
create index if not exists messages_recipient_sender_created_idx on public.messages (recipient, sender, created_at desc, id desc);
create index if not exists messages_unread_recipient_idx on public.messages (recipient, sender, created_at desc) where read_at is null;
comment on table public.messages is 'Private one-to-one chat messages. No edits or deletes are exposed to clients.';

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references public.profiles (id) on delete cascade,
  recipient uuid not null references public.profiles (id) on delete cascade,
  anilist_media_id integer not null check (anilist_media_id > 0),
  note text check (note is null or char_length(note) <= 280),
  status text not null default 'unseen' check (status in ('unseen', 'watching', 'watched', 'not_for_me')),
  created_at timestamptz not null default now(),
  constraint recommendations_no_self_check check (sender <> recipient)
);
create index if not exists recommendations_sender_recipient_created_idx on public.recommendations (sender, recipient, created_at desc, id desc);
create index if not exists recommendations_recipient_sender_created_idx on public.recommendations (recipient, sender, created_at desc, id desc);
create index if not exists recommendations_inbox_idx on public.recommendations (recipient, status, created_at desc);
comment on table public.recommendations is 'A social reply to a friend, not a watch tracker. Stores only the AniList media ID and a short note.';
comment on column public.recommendations.status is 'Recipient response only; it does not update or represent AniList list state.';

create table if not exists public.rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);
comment on table public.rate_limits is 'Private, short-window auth rate counters keyed by a one-way IP hash; raw IPs are never stored.';

-- Called only by auth-anilist with the service role; the upsert serializes concurrent requests per key.
create or replace function public.consume_auth_rate_limit(
  p_ip_hash text,
  p_window_seconds integer default 60,
  p_max_requests integer default 10
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_ip_hash !~ '^[0-9a-f]{64}$' or p_window_seconds < 1 or p_window_seconds > 3600 or p_max_requests < 1 then
    return false;
  end if;
  insert into public.rate_limits (ip_hash, window_started_at, request_count)
  values (p_ip_hash, clock_timestamp(), 1)
  on conflict (ip_hash) do update set
    window_started_at = case
      when public.rate_limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds)
        then clock_timestamp()
      else public.rate_limits.window_started_at
    end,
    request_count = case
      when public.rate_limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds)
        then 1
      else public.rate_limits.request_count + 1
    end
  returning request_count into v_count;
  return v_count <= p_max_requests;
end;
$$;
comment on function public.consume_auth_rate_limit(text, integer, integer) is 'Atomically increments one hashed-IP auth window and returns whether this request is allowed.';
