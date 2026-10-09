# ARNS — GitHub Pages frontend

ARNS is a social companion for AniList: friends, conversations, recommendations, shared Watch Next queues, and anime discussion threads. AniList remains the source of truth for anime lists, ratings, and progress. ARNS stores media IDs and social replies, not an imported anime library.

## Local setup

1. Copy `.env.example` to `.env.local` and fill the three public build-time values below.
2. Install Node.js 20+ and run:

   ```bash
   npm ci
   npm run dev
   ```

3. Apply and deploy the Supabase migrations and Edge Functions from the companion `supabase/` folder before testing sign-in or social features.

## GitHub Pages

- In **Settings → Pages**, select **GitHub Actions** as the build and deployment source.
- Keep the Pages source at the repository root; the root of this package is intended to be the frontend root.
- `vite.config.ts` is set to the project-site path `/Anilist-Recoms.n.social/` for `s4fire/Anilist-Recoms.n.social`. If a custom domain is configured in Pages, change Vite `base` to `/` instead.
- With the default GitHub Pages hostname, register this exact redirect URI in AniList OAuth: `https://s4fire.github.io/Anilist-Recoms.n.social/`.
- For Supabase `ALLOWED_ORIGIN`, use only the origin `https://s4fire.github.io` (no repository path and no trailing slash). If using a custom domain, use that domain's origin and matching root callback.
- Configure `VITE_ANILIST_CLIENT_ID` and `VITE_SUPABASE_URL` as GitHub Actions repository variables, and `VITE_SUPABASE_ANON_KEY` as a repository secret. The anon key is public by design; database grants, RLS, and Edge Function logic provide the protections.
- The included workflow builds and deploys on pushes to `main` and supports manual runs.

## Frontend environment variables

| Variable | Purpose | Secret? |
|---|---|---|
| `VITE_ANILIST_CLIENT_ID` | Public AniList OAuth application ID used to start authorization | No |
| `VITE_SUPABASE_URL` | Supabase project URL used for Auth, Realtime, and Edge Function calls | No |
| `VITE_SUPABASE_ANON_KEY` | Public Supabase anon/publishable key used by the browser client and function requests | No; restricted by RLS and function logic |

Never put `ANILIST_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` in the frontend, `.env.example`, or GitHub Pages variables.

## Theme and interactions

The dark **Ink** theme is the first-visit default. **Ink**, **Sakura Night**, **Tokyo**, and **Mist** are selectable from Settings; the top-bar sun/moon button cycles through them. The preference is saved locally under `arns-theme`. It does not follow the operating-system appearance setting.

Every recommendation card has an **Add to my AniList** action with the nearby note that it adds to Planning only. A user's existing AniList entry is checked first; existing status and progress are left untouched. The inbox reply is a separate social response and does not edit AniList. If the saved AniList grant is no longer valid, the card offers a new AniList login. Settings can delete ARNS's stored token.

## Privacy and data boundaries

- The browser exchanges a one-time AniList authorization code with `auth-anilist` and receives only a Supabase session. The AniList token is encrypted with AES-256-GCM and stored in a server-only table; it is never returned to or stored by the browser.
- `anilist-add-to-list` receives only the media ID and the current Supabase session. The Edge Function reads and decrypts the saved AniList token, verifies the caller's AniList profile, checks the user's existing entry, and only then uses `SaveMediaListEntry` with `PLANNING` for a new entry.
- `anilist-disconnect` deletes only the signed-in user's encrypted token row. It does not delete social data or change AniList list entries.
- Friend, message, recommendation, and token access are protected by server-side RLS and explicit grants. The browser cannot read the token vault or `rate_limits`.
- Public AniList GraphQL requests provide profile snapshots and media search. Search is debounced and responses are cached only in the current tab's memory for a short time.
- Recommendation history, shared queues, anime threads, courtesy spoiler blur, and client-only taste comparison are documented in [`HANDOFF-PAGES.md`](HANDOFF-PAGES.md). Public list comparison and spoiler progress checks remain in browser memory and are never written to Supabase.
- ARNS is an independent companion and is not affiliated with or endorsed by AniList.
