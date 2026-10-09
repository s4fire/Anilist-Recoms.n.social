-- Emoji storage and final table grants/realtime publication.
create or replace function public.add_community_emoji(p_community_id uuid, p_name text, p_path text, p_uploaded_by uuid)
returns public.community_emojis language plpgsql security definer set search_path = public, pg_temp as $$
declare result public.community_emojis;
begin
  perform 1 from public.communities where id = p_community_id for update;
  if not found then raise exception 'Community does not exist.' using errcode = '23503'; end if;
  if (select count(*) from public.community_emojis where community_id = p_community_id) >= 50 then
    raise exception 'This community has reached its emoji limit.' using errcode = '23514';
  end if;
  insert into public.community_emojis(community_id, name, path, uploaded_by)
    values (p_community_id, p_name, p_path, p_uploaded_by) returning * into result;
  return result;
end;
$$;
revoke all on function public.add_community_emoji(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.add_community_emoji(uuid, text, text, uuid) to service_role;

-- Public emoji reads; uploads are restricted to community moderators/owners in both Storage RLS and emoji-upload.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('community-emojis', 'community-emojis', true, 262144, array['image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 262144, allowed_mime_types = array['image/png','image/webp','image/gif'];
create policy community_emojis_public_read on storage.objects for select to public using (bucket_id = 'community-emojis');
-- No authenticated Storage INSERT policy is created. All writes must pass emoji-upload, which validates the moderator role and image bytes before using the server-only Storage client.

revoke all on public.user_blocks, public.communities, public.community_members, public.channels, public.channel_messages,
  public.reports, public.mod_actions, public.community_bans, public.community_mutes, public.site_bans, public.community_emojis
  from public, anon, authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
grant select, insert, update on public.communities to authenticated;
grant select, insert, delete on public.community_members to authenticated;
grant select, insert, update on public.channels to authenticated;
grant select, insert on public.channel_messages to authenticated;
grant select on public.reports to authenticated;
grant select on public.mod_actions, public.community_bans, public.community_mutes, public.site_bans, public.community_emojis to authenticated;
grant select, insert, update, delete on public.reports, public.mod_actions, public.community_bans,
  public.community_mutes, public.site_bans, public.community_emojis to service_role;
grant all on public.user_blocks, public.communities, public.community_members, public.channels,
  public.channel_messages, public.reports, public.mod_actions, public.community_bans,
  public.community_mutes, public.site_bans, public.community_emojis to service_role;

alter table public.channel_messages replica identity full;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='community_members') then execute 'alter publication supabase_realtime add table public.community_members'; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='channel_messages') then execute 'alter publication supabase_realtime add table public.channel_messages'; end if;
end $$;
