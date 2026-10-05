# Pages handoff — Morrow

## Before publishing

1. Replace the `REPO_NAME` placeholder in `vite.config.ts` with the actual GitHub repository name. This determines the exact static root path.
2. Set up an AniList OAuth application. Its redirect URI must exactly match the Pages root URL including path and trailing slash, for example `https://USERNAME.github.io/REPO_NAME/`.
3. Apply and deploy the Supabase SQL and Edge Function described in `HANDOFF-SERVER.md` first.
4. Add the three frontend environment values below to local `.env.local` or the GitHub Actions variables/secrets. `VITE_` values are public in the compiled client by definition.
5. Set the Edge Function `ALLOWED_ORIGIN` to the **origin only**, e.g. `https://USERNAME.github.io` (no repo path and no trailing slash). Set the OAuth redirect URI to the full Pages root URL above.
6. Enable GitHub Pages with GitHub Actions. The included workflow builds `main` and deploys `dist/`.

## Frontend environment variables

| Name | Required | Where it is used |
|---|---:|---|
| `VITE_ANILIST_CLIENT_ID` | Yes | Creates AniList's `/api/v2/oauth/authorize` URL. Never put the AniList client secret in this frontend. |
| `VITE_SUPABASE_URL` | Yes | Creates the public Supabase client and POST URL for `auth-anilist`. |
| `VITE_SUPABASE_ANON_KEY` | Yes | `apikey` header for the unauthenticated, `verify_jwt = false` Edge Function call and public Supabase client. It is not a service key. |

`.env.example` contains empty values only. `.gitignore` excludes real `.env*` files (while retaining `.env.example`), dependencies, and build output.

## Exact `auth-anilist` contract used by this frontend

- **Request:** `POST {VITE_SUPABASE_URL}/functions/v1/auth-anilist`
- **Headers:** `Content-Type: application/json`, `apikey: VITE_SUPABASE_ANON_KEY`
- **Body:** `{ "code": "<one-time AniList authorization code>", "redirect_uri": "<exact Pages root URL with trailing slash>" }`
- **Success:** HTTP `200`, JSON `{ "access_token": "<Supabase access token>", "refresh_token": "<Supabase refresh token>" }`
- **Error:** non-2xx JSON `{ "error": "<friendly message>" }`
- **After success:** call `supabase.auth.setSession({ access_token, refresh_token })`.
- The Edge Function does **not** return an AniList token. The frontend reads `window.location.search` and removes OAuth query parameters before mounting `HashRouter`.

## Design decisions

- **Name:** Morrow — an independent, companion-like name; replace it if the product owner wants a different identity.
- **Visual direction:** calm editorial stationery, somewhere between a well-used notebook and a small independent magazine. Warm paper surfaces, ink-green structure, a single muted coral accent (`#bf6047`), and a restrained moss secondary neutral. No AniList logo or copied layout.
- **Type:** DM Serif Display for expressive headlines and DM Sans for readable interface text.
- **Layout:** persistent friend rail, roomy conversation canvas, optional in-chat recommendation composer, and a three-destination mobile bottom bar.
- **Interaction:** brief ease-out transitions, reduced-motion support, understated hover lift, live presence, optimistic message sending, and compact empty/loading/error states.
- **Voice:** friendly and specific (“No messages yet. Send them something good to watch.”); no watch-tracking language for recommendation statuses.

## Deliberate scope boundaries

- No local anime library, list editing, progress tracking, or ratings.
- Supabase stores only profile identity fields, social records, and the AniList media ID/note/status for recommendations. AniList media fields are fetched live and cached only in the current tab's memory for a short time.
- Recommendation states are a recipient's reply (`unseen`, `watching`, `watched`, `not_for_me`) and never write to AniList.
