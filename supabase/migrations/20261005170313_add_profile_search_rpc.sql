-- Search ARNS members without weakening profiles RLS.
-- The function is exposed only to authenticated clients and returns the minimum
-- fields required by the Friends search UI.
create or replace function public.search_arns_profiles(search_query text)
returns table (
  id uuid,
  username text,
  avatar_url text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.username, p.avatar_url
  from public.profiles p
  where auth.uid() is not null
    and char_length(btrim(search_query)) between 2 and 64
    and lower(p.username) like '%' || lower(btrim(search_query)) || '%'
    and p.id <> auth.uid()
  order by lower(p.username), p.id
  limit 12;
$$;

revoke all on function public.search_arns_profiles(text) from public, anon, authenticated;
grant execute on function public.search_arns_profiles(text) to authenticated;
