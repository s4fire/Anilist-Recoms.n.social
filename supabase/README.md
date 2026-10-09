# ARNS Supabase backend

This is a review-ready Supabase CLI project containing ordered SQL migrations and configured Deno Edge Functions for AniList OAuth/list actions, anime discussions, community moderation, emoji uploads, account deletion, and watch rooms. It contains no project URL, service key, AniList OAuth secret, encryption key, or deployed resources. Community emoji writes pass through the validated server function; the public bucket has no authenticated direct-upload policy.

Start with [`HANDOFF-SERVER.md`](HANDOFF-SERVER.md) for the data model, RLS protections, token encryption, Edge Function contracts, required dashboard secrets, and the explicit migration/function deploy order. Review and test in a development Supabase project before applying to production.
