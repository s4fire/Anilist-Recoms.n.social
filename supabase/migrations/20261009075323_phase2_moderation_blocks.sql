-- Block rules, site-wide moderation, and protected profile administration.
-- Both users become unable to send or read private messages while a block exists.
alter policy messages_select_participants on public.messages using (
  (sender = (select auth.uid()) or recipient = (select auth.uid()))
  and not public.user_pair_is_blocked((select auth.uid()), case when sender = (select auth.uid()) then recipient else sender end)
);
alter policy messages_insert_between_friends on public.messages with check (
  sender = (select auth.uid()) and recipient <> (select auth.uid()) and read_at is null
  and not public.user_pair_is_blocked((select auth.uid()), recipient)
  and not public.community_user_is_blocked((select auth.uid()), null)
  and exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester = sender and f.addressee = recipient) or (f.requester = recipient and f.addressee = sender)))
);

alter policy friendships_insert_requester on public.friendships with check (
  requester = (select auth.uid()) and addressee <> (select auth.uid()) and status = 'pending'
  and not public.user_pair_is_blocked((select auth.uid()), addressee)
  and not public.community_user_is_blocked((select auth.uid()), null)
);
alter policy friendships_update_answer_or_reopen on public.friendships
  using ((addressee = (select auth.uid()) and status in ('pending','declined')) or (requester = (select auth.uid()) and status = 'declined'))
  with check (
    ((addressee = (select auth.uid()) and status in ('accepted','declined')) or (requester = (select auth.uid()) and status = 'pending'))
    and not public.user_pair_is_blocked((select auth.uid()), case when requester = (select auth.uid()) then addressee else requester end)
  );

-- A site-wide ban also stops publishing in the original social features.
alter policy recommendations_insert_between_friends on public.recommendations with check (
  sender = (select auth.uid()) and recipient <> (select auth.uid()) and status = 'unseen'
  and not public.community_user_is_blocked((select auth.uid()), null)
  and exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester = sender and f.addressee = recipient) or (f.requester = recipient and f.addressee = sender)))
);
alter policy queues_insert_owner on public.queues with check (
  owner_id = (select auth.uid()) and not public.community_user_is_blocked((select auth.uid()), null)
);
alter policy queues_update_owner on public.queues
  using (owner_id = (select auth.uid()) and not public.community_user_is_blocked((select auth.uid()), null))
  with check (owner_id = (select auth.uid()) and not public.community_user_is_blocked((select auth.uid()), null));
alter policy queue_members_insert_owner_friend on public.queue_members with check (
  added_by = (select auth.uid()) and member_id <> (select auth.uid())
  and not public.community_user_is_blocked((select auth.uid()), null)
  and exists (select 1 from public.queues q where q.id = queue_members.queue_id and q.owner_id = (select auth.uid()))
  and exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester = (select auth.uid()) and f.addressee = queue_members.member_id)
      or (f.addressee = (select auth.uid()) and f.requester = queue_members.member_id)))
);
alter policy queue_members_delete_owner on public.queue_members using (
  not public.community_user_is_blocked((select auth.uid()), null)
  and exists (select 1 from public.queues q where q.id = queue_members.queue_id and q.owner_id = (select auth.uid()))
);
alter policy queue_items_insert_member on public.queue_items with check (
  added_by = (select auth.uid()) and not public.community_user_is_blocked((select auth.uid()), null)
  and exists (select 1 from public.queues q where q.id = queue_items.queue_id and (
    q.owner_id = (select auth.uid())
    or exists (select 1 from public.queue_members qm where qm.queue_id = q.id and qm.member_id = (select auth.uid()))
    or (q.visibility = 'friends' and exists (select 1 from public.friendships f where f.status = 'accepted'
      and ((f.requester = q.owner_id and f.addressee = (select auth.uid())) or (f.addressee = q.owner_id and f.requester = (select auth.uid())))))
  )) and (recommended_by is null or exists (select 1 from public.recommendations r where r.sender = queue_items.recommended_by
    and r.recipient = (select auth.uid()) and r.anilist_media_id = queue_items.media_id))
);
alter policy queue_items_update_member on public.queue_items
  using (not public.community_user_is_blocked((select auth.uid()), null) and exists (
    select 1 from public.queues q where q.id = queue_items.queue_id and (
      q.owner_id = (select auth.uid())
      or exists (select 1 from public.queue_members qm where qm.queue_id = q.id and qm.member_id = (select auth.uid()))
      or (q.visibility = 'friends' and exists (select 1 from public.friendships f where f.status = 'accepted'
        and ((f.requester = q.owner_id and f.addressee = (select auth.uid())) or (f.addressee = q.owner_id and f.requester = (select auth.uid())))))
    )
  ))
  with check (not public.community_user_is_blocked((select auth.uid()), null) and exists (
    select 1 from public.queues q where q.id = queue_items.queue_id and (
      q.owner_id = (select auth.uid())
      or exists (select 1 from public.queue_members qm where qm.queue_id = q.id and qm.member_id = (select auth.uid()))
      or (q.visibility = 'friends' and exists (select 1 from public.friendships f where f.status = 'accepted'
        and ((f.requester = q.owner_id and f.addressee = (select auth.uid())) or (f.addressee = q.owner_id and f.requester = (select auth.uid())))))
    )
  ));

-- Site admins can read all communities via policies above, but cannot grant themselves admin through app APIs.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.anilist_id is distinct from old.anilist_id or new.created_at is distinct from old.created_at then
    raise exception 'Profile identity fields cannot be changed.' using errcode = '42501';
  end if;
  if new.is_admin is distinct from old.is_admin and (session_user not in ('postgres','supabase_admin') or auth.uid() is not null) then
    raise exception 'Site admin status can only be changed in a direct SQL session.' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if auth.uid() is null and session_user not in ('postgres','supabase_admin') then
      raise exception 'Only the profile owner can update this profile.' using errcode = '42501';
    elsif auth.uid() is not null and auth.uid() <> old.id then
      raise exception 'Only the profile owner can update this profile.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke update on public.profiles from authenticated;
grant update (username, avatar_url, banner_url) on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

-- Atomic, service-role-only emoji metadata insertion enforces the per-community cap.
