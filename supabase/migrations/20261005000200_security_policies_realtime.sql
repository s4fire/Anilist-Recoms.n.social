-- Row Level Security is the primary boundary; triggers defend immutable columns and legal transitions.
alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.messages enable row level security;
alter table public.recommendations enable row level security;
alter table public.rate_limits enable row level security;

create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id
    or new.anilist_id is distinct from old.anilist_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Profile identity fields cannot be changed.' using errcode = '42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (auth.uid() is null or auth.uid() <> old.id) then
    raise exception 'Only the profile owner can update this profile.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger profiles_guard_update before update on public.profiles
  for each row execute function public.guard_profile_update();

create or replace function public.guard_friendship_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
    raise exception 'Friendship ID and creation time are immutable.' using errcode = '42501';
  end if;
  if new.requester is distinct from old.requester or new.addressee is distinct from old.addressee then
    if auth.uid() = old.addressee and old.status = 'declined'
      and new.requester = old.addressee and new.addressee = old.requester and new.status = 'pending' then
      return new;
    end if;
    raise exception 'Friendship participants cannot be changed except to re-initiate a declined pair request.' using errcode = '42501';
  end if;
  if auth.uid() = old.addressee and old.status = 'pending' and new.status in ('accepted', 'declined') then
    return new;
  end if;
  if auth.uid() = old.requester and old.status = 'declined' and new.status = 'pending' then
    return new;
  end if;
  raise exception 'Only the recipient may answer a pending request; either participant may re-initiate after decline.' using errcode = '42501';
end;
$$;
create trigger friendships_guard_update before update on public.friendships
  for each row execute function public.guard_friendship_update();

create or replace function public.guard_message_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.sender is distinct from old.sender
    or new.recipient is distinct from old.recipient or new.body is distinct from old.body
    or new.created_at is distinct from old.created_at then
    raise exception 'Messages are immutable except for recipient read state.' using errcode = '42501';
  end if;
  if auth.uid() is null or auth.uid() <> old.recipient then
    raise exception 'Only the recipient may mark this message read.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger messages_guard_update before update on public.messages
  for each row execute function public.guard_message_update();

create or replace function public.guard_recommendation_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.sender is distinct from old.sender
    or new.recipient is distinct from old.recipient or new.anilist_media_id is distinct from old.anilist_media_id
    or new.note is distinct from old.note or new.created_at is distinct from old.created_at then
    raise exception 'Recommendations are immutable except for recipient status.' using errcode = '42501';
  end if;
  if auth.uid() is null or auth.uid() <> old.recipient then
    raise exception 'Only the recipient may reply to this recommendation.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger recommendations_guard_update before update on public.recommendations
  for each row execute function public.guard_recommendation_update();

-- Profile lookup is available to signed-in users for username search and friend displays.
create policy profiles_select_authenticated on public.profiles for select to authenticated using (true);
create policy profiles_update_owner on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy friendships_select_participants on public.friendships for select to authenticated
  using (requester = auth.uid() or addressee = auth.uid());
create policy friendships_insert_requester on public.friendships for insert to authenticated
  with check (requester = auth.uid() and addressee <> auth.uid() and status = 'pending');
create policy friendships_update_answer_or_reopen on public.friendships for update to authenticated
  using ((addressee = auth.uid() and status in ('pending', 'declined')) or (requester = auth.uid() and status = 'declined'))
  with check ((addressee = auth.uid() and status in ('accepted', 'declined')) or (requester = auth.uid() and status = 'pending'));

create policy messages_select_participants on public.messages for select to authenticated
  using (sender = auth.uid() or recipient = auth.uid());
create policy messages_insert_between_friends on public.messages for insert to authenticated
  with check (
    sender = auth.uid()
    and recipient <> auth.uid()
    and read_at is null
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = sender and f.addressee = recipient) or (f.requester = recipient and f.addressee = sender))
    )
  );
create policy messages_update_recipient_read_state on public.messages for update to authenticated
  using (recipient = auth.uid()) with check (recipient = auth.uid());

create policy recommendations_select_participants on public.recommendations for select to authenticated
  using (sender = auth.uid() or recipient = auth.uid());
create policy recommendations_insert_between_friends on public.recommendations for insert to authenticated
  with check (
    sender = auth.uid()
    and recipient <> auth.uid()
    and status = 'unseen'
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = sender and f.addressee = recipient) or (f.requester = recipient and f.addressee = sender))
    )
  );
create policy recommendations_update_recipient_status on public.recommendations for update to authenticated
  using (recipient = auth.uid()) with check (recipient = auth.uid());

-- The service function is not exposed to browser roles. Keep rate_limits private even to authenticated users.
revoke all on public.rate_limits from anon, authenticated;
revoke all on function public.consume_auth_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text, integer, integer) to service_role;
revoke all on public.profiles, public.friendships, public.messages, public.recommendations from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.friendships, public.messages, public.recommendations to authenticated;
grant usage on schema public to authenticated;

-- Supabase Realtime is used for online presence and these three row-change streams.
alter table public.friendships replica identity full;
alter table public.messages replica identity full;
alter table public.recommendations replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships') then
    execute 'alter publication supabase_realtime add table public.friendships';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'recommendations') then
    execute 'alter publication supabase_realtime add table public.recommendations';
  end if;
end;
$$;
