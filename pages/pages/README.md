# Morrow — Pages frontend

Morrow is a social companion that works with AniList. AniList remains the source of truth for lists, ratings, and progress; this frontend stores no anime title, cover, or description in Supabase.

## Local setup

1. Copy `.env.example` to `.env.local` and fill in the three public build-time values listed below.
2. Replace `/REPO_NAME/` in `vite.config.ts` with the GitHub repository name. For local root hosting, `/` is also valid.
3. Install Node.js 20+ and run:

   ```bash
   npm install
   npm run dev
   ```

4. The app needs the Supabase migrations and `auth-anilist` Edge Function from the companion `server.zip` before sign-in and social features can work.

## GitHub Pages

- Enable **GitHub Pages → Build and deployment → GitHub Actions** in repository settings.
- Keep the Pages source at the repository root (the root of this archive is intended to be the root of your combined repository).
- Replace the `REPO_NAME` TODO in `vite.config.ts` with the repo name. The Pages redirect URI is derived from this Vite base and always includes the trailing slash.
- Register the exact Pages root URL (including the repository path and trailing slash, for example `https://USERNAME.github.io/REPO_NAME/`) as the AniList OAuth redirect URI.
- Configure the three GitHub Actions values in the deployment workflow: `VITE_ANILIST_CLIENT_ID` and `VITE_SUPABASE_URL` as repository variables, and `VITE_SUPABASE_ANON_KEY` as a repository secret. The anon key is public by design; it grants no privileged access without the database policies.
- The workflow builds and deploys on pushes to `main` and supports manual runs.

## Environment variables

| Variable | Purpose | Secret? |
|---|---|---|
| `VITE_ANILIST_CLIENT_ID` | Public AniList OAuth application ID used to start authorization | No |
| `VITE_SUPABASE_URL` | Supabase project URL used for Auth, Realtime, and database API calls | No |
| `VITE_SUPABASE_ANON_KEY` | Public Supabase anon/publishable key used by the browser client and Edge Function request | No; restricted by RLS and function logic |

Never place the AniList client secret or Supabase service-role key in the frontend, `.env.example`, or GitHub Pages variables.

## Security and data boundaries

- OAuth query parameters are read and removed before `HashRouter` mounts. The one-time AniList authorization code is POSTed to `auth-anilist`; the browser receives only a Supabase session and never receives the AniList access/refresh token.
- Supabase Auth persists and refreshes its own session. Logout clears it.
- Friend and message operations are protected by the server-side RLS policies. The browser cannot read `rate_limits`.
- AniList GraphQL is called publicly for profile snapshots and media searches. Responses are cached in memory for a short time; search is debounced and requests are spaced to respect the 90-request/minute limit.
- Recommendations store the AniList media ID, optional note, and the recipient's social reply status only. Every media card links to AniList.
- The app is an independent companion and is not affiliated with or endorsed by AniList.
