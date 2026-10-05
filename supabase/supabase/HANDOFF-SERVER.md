# Supabase handoff — Morrow

Everything in this archive is under `supabase/` so it can be extracted at the root of the same repository as the Pages frontend.

## Data model

| Table | What it stores |
|---|---|
| `profiles` | Auth UUID, unique AniList user ID, current AniList username/avatar/banner, and creation time. It does not store AniList tokens, lists, scores, or anime media data. |
| `friendships` | One unordered pair per row, requester/addressee, `pending` / `accepted` / `declined`, and creation time. Either participant can start a fresh request after decline; when the former recipient does so, the row reverses requester/addressee. |
| `messages` | Sender, recipient, length-limited body, creation time, and recipient-set `read_at`. Messages have no client edit/delete policy. |
| `recommendations` | Sender, recipient, AniList media ID, optional <=280-character note, recipient reply state, and creation time. No titles, covers, descriptions, or AniList list-state is copied. |
| `rate_limits` | A one-way SHA-256 hash of the source IP and a short request window counter. No raw IP is stored; this table has no browser policies/grants. |

## Row Level Security, in plain language

- **Profiles:** signed-in users may search/read profiles needed for friend discovery. The Edge Function creates profiles after verified AniList OAuth; authenticated users may update only their own profile. A database trigger keeps account ID, AniList ID, and creation timestamp immutable.
- **Friendships:** only the two participants can read a row. A user may create a pending request only as requester, and cannot friend themself. The addressee may change a pending request only to accepted or declined. After decline, either participant may initiate again; only that exact re-initiation may reverse requester/addressee. IDs and creation time cannot be changed.
- **Messages:** only sender and recipient can read. Insert is allowed only when the current user is the sender, the recipient is a different user, the row begins unread, and the pair has an accepted friendship. The recipient alone may update `read_at`; a trigger rejects edits to sender, recipient, body, ID, or creation time.
- **Recommendations:** only sender and recipient can read. Insert is allowed only by the sender, between accepted friends, with the initial social reply state `unseen`. The recipient alone may update status; a trigger rejects edits to the media ID, note, participants, ID, or creation time.
- **Rate limits:** RLS is enabled, but browser roles have no table privileges or policies. Only the `service_role` can execute the atomic rate-limit RPC.
- There are no client delete policies. The messages, recommendations, and friendships tables are in `supabase_realtime` for live updates.

## Edge Function contract

`auth-anilist` is Deno/TypeScript and is configured with `verify_jwt = false` because the caller has not signed in yet.

- **Request:** `POST /functions/v1/auth-anilist`, JSON `{ "code": string, "redirect_uri": string }`.
- **Success:** HTTP 200 JSON `{ "access_token": string, "refresh_token": string }`, both a normal Supabase Auth session token.
- **Error:** 4xx/5xx JSON `{ "error": string }` with a user-friendly explanation.
- It checks exact-origin CORS against `ALLOWED_ORIGIN`, validates the redirect URI's origin and shape, and allows preflight only from that origin.
- It rate-limits to 10 attempts per hashed IP per 60-second window in the private `rate_limits` table.
- It exchanges the one-time AniList code, calls AniList's authenticated `Viewer` GraphQL query, creates/reuses a Supabase Auth user keyed by `anilist_<id>@users.invalid`, refreshes the minimal profile fields, and verifies a single-use Supabase magic-link token server-side to obtain a real Supabase session.
- The server-only `ANILIST` access token is never returned or logged. The function returns only the Supabase session pair.

## Supabase dashboard secrets

Add these names in **Edge Functions → Secrets** (values are not included in this archive):

- `ANILIST_CLIENT_ID`
- `ANILIST_CLIENT_SECRET`
- `ALLOWED_ORIGIN`

Supabase automatically injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; do not add them to client config or source files.

`ALLOWED_ORIGIN` is the website origin only, e.g. `https://USERNAME.github.io` (no repository path and no trailing slash). In AniList's OAuth app settings, use the exact Pages redirect URI including repository path and trailing slash, e.g. `https://USERNAME.github.io/REPO_NAME/`.

## Apply and deploy

1. Review the migrations in order. Create a Supabase project and install the Supabase CLI.
2. From the combined repository root, link the project and apply the versioned migrations:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. Add the three Edge Function secret names above in the dashboard (or set them with the Supabase CLI after review).
4. Deploy the function:

   ```bash
   supabase functions deploy auth-anilist
   ```

5. Configure the frontend values and GitHub Pages workflow in `HANDOFF-PAGES.md`, with the same project URL and public anon key. Set the AniList OAuth callback to the Pages root URL and set `ALLOWED_ORIGIN` to its origin.
6. Smoke-test OAuth, a friend request, an accepted-friend message, a recommendation and receiver status update. Confirm direct reads/writes as unrelated users fail under RLS.

No migration or function is deployed by this archive. Review and apply in a non-production Supabase project first, then promote according to your normal release process.
