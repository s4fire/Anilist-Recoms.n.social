-- Tighten security-advisor findings without changing trigger behavior.
-- Trigger functions run through triggers and do not need direct RPC EXECUTE grants.
revoke execute on function public.guard_friendship_update() from anon, authenticated;
revoke execute on function public.guard_message_update() from anon, authenticated;
revoke execute on function public.guard_profile_update() from anon, authenticated;
revoke execute on function public.guard_recommendation_update() from anon, authenticated;

-- The auth rate-limit table is server-side state only.
create policy rate_limits_no_client_access
  on public.rate_limits
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- The profile directory exposes only public-search fields under caller RLS.
alter view public.profile_directory set (security_invoker = true);
