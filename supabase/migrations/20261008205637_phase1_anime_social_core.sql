-- Phase 1 social core: anime-aware recommendations, shared queues, and discussion threads.
-- AniList remains the source of truth; this schema stores IDs and episode numbers only.

-- Migrate legacy reply states without dropping existing recommendation records.
alter table public.recommendations drop constraint if exists recommendations_status_check;
update public.recommendations set status = 'on_my_list' where status = 'watching';
update public.recommendations set status = 'seen' where status = 'watched';
alter table public.recommendations add constraint recommendations_status_check
  check (status in ('unseen', 'on_my_list', 'seen', 'not_for_me'));

create type public.recommendation_reason_tag as enum (
  'similar_to_something', 'great_characters', 'great_story', 'great_art_music',
  'short_and_sweet', 'hidden_gem', 'comfort_watch', 'mind_bending'
);

alter table public.recommendations
  add column reason_tags public.recommendation_reason_tag[] not null default '{}',
  add column similar_to_media_id integer;
alter table public.recommendations add constraint recommendations_media_ids_positive
  check (anilist_media_id > 0 and (similar_to_media_id is null or similar_to_media_id > 0));
alter table public.recommendations add constraint recommendations_reason_tags_limit
  check (cardinality(reason_tags) <= 8);
comment on column public.recommendations.reason_tags is 'Optional AniList-independent reason labels; stores no copied media metadata.';
comment on column public.recommendations.similar_to_media_id is 'Optional related AniList media ID; titles and art are fetched live from AniList.';
comment on column public.recommendations.status is 'Social reply only: unseen, on_my_list, seen, or not_for_me. Never tracks AniList progress.';

create or replace function public.guard_recommendation_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.sender is distinct from old.sender
    or new.recipient is distinct from old.recipient or new.anilist_media_id is distinct from old.anilist_media_id
    or new.note is distinct from old.note or new.reason_tags is distinct from old.reason_tags
    or new.similar_to_media_id is distinct from old.similar_to_media_id or new.created_at is distinct from old.created_at then
    raise exception 'Recommendations are immutable except for recipient status.' using errcode = '42501';
  end if;
  if auth.uid() is null or auth.uid() <> old.recipient then
    raise exception 'Only the recipient may reply to this recommendation.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create table public.queues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  visibility text not null default 'friends' check (visibility in ('private', 'friends')),
  created_at timestamptz not null default now()
);
comment on table public.queues is 'Shared social queues. Personal anime lists remain on AniList.';
comment on column public.queues.name is 'User-authored queue label, limited to 80 characters.';

create table public.queue_members (
  queue_id uuid not null references public.queues(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (queue_id, member_id),
  constraint queue_members_distinct_actor check (member_id <> added_by)
);
comment on table public.queue_members is 'Explicit members for private queues; friends-visible queues also include accepted friends implicitly.';

create table public.queue_items (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references public.queues(id) on delete cascade,
  media_id integer not null check (media_id > 0),
  added_by uuid not null references public.profiles(id) on delete cascade,
  priority smallint not null default 2 check (priority between 1 and 3),
  recommended_by uuid references public.profiles(id) on delete set null,
  status text not null default 'up_next' check (status in ('up_next', 'done')),
  created_at timestamptz not null default now(),
  unique (queue_id, media_id)
);
create index queue_items_order_idx on public.queue_items(queue_id, status, priority, created_at, id);
comment on table public.queue_items is 'A shared queue entry stores only the AniList media ID and social ordering/state.';
comment on column public.queue_items.recommended_by is 'Set only when the adder received a matching recommendation from that friend.';

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  media_id integer not null check (media_id > 0),
  episode integer check (episode is null or episode > 0),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index threads_anime_created_idx on public.threads(media_id, created_at desc, id desc);
comment on table public.threads is 'Anime discussion topics; episode is an optional spoiler boundary.';

create table public.thread_posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  author uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  episode_tag integer check (episode_tag is null or episode_tag > 0),
  created_at timestamptz not null default now()
);
create index thread_posts_thread_created_idx on public.thread_posts(thread_id, created_at desc, id desc);
comment on table public.thread_posts is 'Thread replies; episode_tag marks the highest episode discussed and is not verified progress.';

-- Every new public table is protected and explicitly granted for projects that disable auto-exposure.
alter table public.queues enable row level security;
alter table public.queue_members enable row level security;
alter table public.queue_items enable row level security;
alter table public.threads enable row level security;
alter table public.thread_posts enable row level security;

create policy queues_select_owner_member_or_friend on public.queues for select to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (select 1 from public.queue_members qm where qm.queue_id = queues.id and qm.member_id = (select auth.uid()))
    or (visibility = 'friends' and exists (
      select 1 from public.friendships f where f.status = 'accepted'
        and ((f.requester = queues.owner_id and f.addressee = (select auth.uid()))
          or (f.addressee = queues.owner_id and f.requester = (select auth.uid())))
    ))
  );
create policy queues_insert_owner on public.queues for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy queues_update_owner on public.queues for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create or replace function public.guard_queue_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.owner_id is distinct from old.owner_id or new.created_at is distinct from old.created_at then
    raise exception 'Queue ownership and creation details cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger queues_guard_update before update on public.queues
  for each row execute function public.guard_queue_update();

create policy queue_members_select_self_or_owner on public.queue_members for select to authenticated
  using (member_id = (select auth.uid()) or exists (
    select 1 from public.queues q where q.id = queue_members.queue_id and q.owner_id = (select auth.uid())
  ));
create policy queue_members_insert_owner_friend on public.queue_members for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and member_id <> (select auth.uid())
    and exists (select 1 from public.queues q where q.id = queue_members.queue_id and q.owner_id = (select auth.uid()))
    and exists (select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester = (select auth.uid()) and f.addressee = queue_members.member_id)
        or (f.addressee = (select auth.uid()) and f.requester = queue_members.member_id)))
  );
create policy queue_members_delete_owner on public.queue_members for delete to authenticated
  using (exists (select 1 from public.queues q where q.id = queue_members.queue_id and q.owner_id = (select auth.uid())));

create policy queue_items_select_accessible_queue on public.queue_items for select to authenticated
  using (exists (select 1 from public.queues q where q.id = queue_items.queue_id));
create policy queue_items_insert_member on public.queue_items for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and exists (
      select 1 from public.queues q where q.id = queue_items.queue_id and (
        q.owner_id = (select auth.uid())
        or exists (select 1 from public.queue_members qm where qm.queue_id = q.id and qm.member_id = (select auth.uid()))
        or (q.visibility = 'friends' and exists (select 1 from public.friendships f where f.status = 'accepted'
          and ((f.requester = q.owner_id and f.addressee = (select auth.uid()))
            or (f.addressee = q.owner_id and f.requester = (select auth.uid())))))
      )
    )
    and (recommended_by is null or exists (
      select 1 from public.recommendations r where r.sender = queue_items.recommended_by
        and r.recipient = (select auth.uid()) and r.anilist_media_id = queue_items.media_id
    ))
  );
create policy queue_items_update_member on public.queue_items for update to authenticated
  using (exists (select 1 from public.queues q where q.id = queue_items.queue_id and (
    q.owner_id = (select auth.uid())
    or exists (select 1 from public.queue_members qm where qm.queue_id = q.id and qm.member_id = (select auth.uid()))
    or (q.visibility = 'friends' and exists (select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester = q.owner_id and f.addressee = (select auth.uid()))
        or (f.addressee = q.owner_id and f.requester = (select auth.uid())))))
  )))
  with check (exists (select 1 from public.queues q where q.id = queue_items.queue_id and (
    q.owner_id = (select auth.uid())
    or exists (select 1 from public.queue_members qm where qm.queue_id = q.id and qm.member_id = (select auth.uid()))
    or (q.visibility = 'friends' and exists (select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester = q.owner_id and f.addressee = (select auth.uid()))
        or (f.addressee = q.owner_id and f.requester = (select auth.uid())))))
  )));

create or replace function public.guard_queue_item_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.queue_id is distinct from old.queue_id
    or new.media_id is distinct from old.media_id or new.added_by is distinct from old.added_by
    or new.recommended_by is distinct from old.recommended_by or new.created_at is distinct from old.created_at then
    raise exception 'Queue item identity fields cannot be changed.' using errcode = '42501';
  end if;
  if new.priority not between 1 and 3 or new.status not in ('up_next', 'done') then
    raise exception 'Queue item state is not valid.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger queue_items_guard_update before update on public.queue_items
  for each row execute function public.guard_queue_item_update();
comment on function public.guard_queue_item_update() is 'Keeps queue item identity and attribution immutable while allowing members to reorder or mark done.';

create policy threads_select_authenticated on public.threads for select to authenticated using (true);
create policy thread_posts_select_authenticated on public.thread_posts for select to authenticated using (true);
-- Writes go through verified, rate-limited Edge Functions; clients cannot spoof authors or skip throttling.

-- Return only the minimal display fields for people who participated in one public thread.
create or replace function public.thread_author_profiles(p_thread_id uuid)
returns table (id uuid, username text, avatar_url text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.username, p.avatar_url
  from public.profiles p
  where auth.uid() is not null
    and exists (select 1 from public.threads t where t.id = p_thread_id)
    and (p.id = (select t.created_by from public.threads t where t.id = p_thread_id)
      or exists (select 1 from public.thread_posts tp where tp.thread_id = p_thread_id and tp.author = p.id));
$$;
comment on function public.thread_author_profiles(uuid) is 'Returns minimal profile labels only for authors in the requested authenticated discussion thread.';
revoke all on function public.thread_author_profiles(uuid) from public, anon, authenticated;
grant execute on function public.thread_author_profiles(uuid) to authenticated;

revoke all on public.queues, public.queue_members, public.queue_items, public.threads, public.thread_posts from public, anon, authenticated;
grant select, insert, update on public.queues to authenticated;
grant select, insert, delete on public.queue_members to authenticated;
grant select, insert, update on public.queue_items to authenticated;
grant select on public.threads, public.thread_posts to authenticated;
grant insert on public.threads, public.thread_posts to service_role;
grant usage on type public.recommendation_reason_tag to authenticated, service_role;
grant select, insert, update on public.recommendations to authenticated;

alter table public.queues replica identity full;
alter table public.queue_members replica identity full;
alter table public.queue_items replica identity full;
alter table public.thread_posts replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queues') then
    execute 'alter publication supabase_realtime add table public.queues';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_members') then
    execute 'alter publication supabase_realtime add table public.queue_members';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_items') then
    execute 'alter publication supabase_realtime add table public.queue_items';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'thread_posts') then
    execute 'alter publication supabase_realtime add table public.thread_posts';
  end if;
end;
$$;
