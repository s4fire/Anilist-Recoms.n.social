# Supabase handoff — ARNS

Everything in this package lives under `supabase/`; extract it at the repository root alongside the Pages frontend. No project secrets or deployed resources are included.

## Data model

| Table | What it stores |
|---|---|
| `profiles` | Auth UUID, unique AniList user ID, current AniList username/avatar/banner, and creation time. No tokens, lists, scores, or anime media data. |
| `friendships` | One unordered pair per row, requester/addressee, `pending` / `accepted` / `declined`, and creation time. Either participant can start a fresh request after decline. |
| `messages` | Sender, recipient, length-limited body, creation time, and recipient-set `read_at`. |
| `recommendations` | Sender, recipient, AniList media ID, optional <=280-character note, recipient social reply state, and creation time. No titles, covers, descriptions, or copied AniList list state. |
| `queues`, `queue_members`, `queue_items` | Shared queue names, visibility/membership, AniList media IDs, priority, social completion state, and attribution. Personal queues remain on AniList. |
| `threads`, `thread_posts` | Anime media IDs, optional episode boundaries, user-authored thread titles and replies. Spoiler progress is never stored. |
| `anilist_tokens` | One row per auth user containing versioned AES-256-GCM ciphertext for the AniList access token, plus timestamps. Its key exists only as an Edge Function secret. |
| `rate_limits` | Short-window counters keyed by one-way SHA-256 hashes of source IPs or namespaced user IDs. Raw IPs and user IDs are not stored. |

## Row Level Security, in plain language

- **Profiles:** signed-in users can search/read profiles needed for friend discovery. `auth-anilist` creates and refreshes them after verifying AniList OAuth. Authenticated users can update only their own allowed profile fields; a database trigger keeps account ID, AniList ID, and creation timestamp immutable.
- **Friendships:** only participants can read a row. A user may create a pending request only as requester; the addressee may accept or decline it. After decline, either participant can start a fresh request, with a constrained reversal of requester/addressee.
- **Messages:** only sender and recipient can read. A sender can insert only into an accepted friendship; the recipient alone may update `read_at`. Triggers reject changes to message identity/body/time.
- **Recommendations:** only sender and recipient can read. A sender can insert only between accepted friends, initially `unseen`; the recipient alone may update its social reply. Triggers reject changes to media ID, note, participants, ID, and creation time.
- **Queues:** owners control queue visibility and invited members; private queues are visible only to owners and invitees. Accepted friends can see and contribute to friends-visible queues. Item attribution is immutable, and a claimed recommender must match a recommendation received by the adder for that media ID.
- **Anime threads:** signed-in users can read threads and replies. Writes are revoked from browser roles and pass through `thread-create` / `thread-post`, which validate the Supabase JWT, set authors from the verified user, check `ALLOWED_ORIGIN`, and rate-limit with the private counter RPC. A narrow read-only RPC returns only usernames and avatars for participants in a public thread.
- **Rate limits:** RLS is enabled; browser roles have no table grants or policies. Only server functions call the atomic rate-limit RPC.
- **AniList token vault:** RLS is enabled and there are intentionally no policies; all privileges are revoked from `PUBLIC`, `anon`, and `authenticated`. Only `service_role` has the CRUD grants used by Edge Functions. No browser query can read or modify ciphertext.
- There are no client delete policies. Messages, recommendations, and friendships are in `supabase_realtime` for live updates.

## Edge Function contracts

All functions compare `Origin` with the exact `ALLOWED_ORIGIN`; non-matching origins receive no CORS permission. The two session-required functions also verify the Supabase bearer with `auth.getUser` and use the service role only server-side.

### `auth-anilist` — `verify_jwt = false`

- **Request:** `POST /functions/v1/auth-anilist`, `{ "code": string, "redirect_uri": string }`. It is the only pre-session function; the one-time authorization code is validated and rate-limited by hashed IP.
- **Success:** HTTP `200`, `{ "access_token": string, "refresh_token": string }`; both are a Supabase Auth session pair.
- **Flow:** exchanges the one-time AniList code, calls authenticated `Viewer`, creates/reuses the corresponding Supabase auth user, updates the minimal profile, encrypts the AniList access token with AES-256-GCM, upserts only the ciphertext into `anilist_tokens`, then verifies a one-use Supabase magic-link token server-side.
- **Response boundary:** it never returns or logs the AniList token. The function response remains the same Supabase session pair as before this patch.

### `anilist-add-to-list` — `verify_jwt = true`

- **Request:** `POST /functions/v1/anilist-add-to-list`, `{ "media_id": <positive 32-bit integer> }`, authenticated by the current Supabase bearer.
- **Caller checks:** verifies the bearer via Supabase Auth, then rate-limits to 10 calls per user per 60-second window using a namespaced SHA-256 identifier in the private `rate_limits` table.
- **Token/media checks:** loads that user's AniList ID and encrypted token using server-only privileges, decrypts with `TOKEN_ENCRYPTION_KEY` and user-ID authenticated data, and asks AniList for `Media(id)` plus `MediaList(mediaId, userId)`. Non-anime IDs are rejected. Missing/unreadable/invalid AniList credentials return `401` with `code: "reauth_required"`.
- **No-overwrite path:** an existing list entry returns HTTP `200` `{ "ok": true, "already_on_list": true }` before any mutation, regardless of its status or progress. A new entry uses the official `SaveMediaListEntry` mutation with `status: PLANNING`, without supplying an existing list-entry ID or changing score/progress.
- **New-entry success:** HTTP `200` `{ "ok": true }`. Errors are friendly JSON without token or upstream stack details.

### `anilist-disconnect` — `verify_jwt = true`

- **Request:** `POST /functions/v1/anilist-disconnect` with the current Supabase bearer and `{}` JSON body.
- **Action:** deletes only `anilist_tokens.user_id` matching the verified caller. It is idempotent and does not delete their profile, social records, or AniList entries.
- **Success:** HTTP `200` `{ "ok": true }`.

## Supabase Edge Function secrets

Add these names in **Edge Functions → Secrets**; values are not included in this package:

| Secret | Purpose |
|---|---|
| `ANILIST_CLIENT_ID` | AniList authorization-code exchange |
| `ANILIST_CLIENT_SECRET` | Server-only AniList OAuth secret |
| `ALLOWED_ORIGIN` | Exact website origin only |
| `TOKEN_ENCRYPTION_KEY` | Base64 encoding of exactly 32 random bytes for AES-256-GCM |

For a fresh key, generate locally with `openssl rand -base64 32`, then store the output only as the Edge Function secret. Do not commit it or place it in frontend environment variables. Changing this key makes already-stored ciphertext unreadable; reconnect users before removing an old key if planned rotation is ever required. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions; do not expose either in the browser.

For the default GitHub Pages URL, set `ALLOWED_ORIGIN` to `https://s4fire.github.io` (no repository path and no trailing slash), while AniList OAuth uses the exact redirect URI `https://s4fire.github.io/Anilist-Recoms.n.social/`. If Pages uses a custom domain, set the matching origin and callback instead.

## Deploy order

1. **Review and apply all five ordered migrations, in filename order.** From the combined repository root, link the intended Supabase project and apply them:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

2. **Set Edge Function secrets**, including a generated `TOKEN_ENCRYPTION_KEY`, `ALLOWED_ORIGIN`, and the two AniList OAuth values.
3. **Deploy the OAuth function** (it writes the encrypted token row after this migration exists):

   ```bash
   supabase functions deploy auth-anilist
   ```

4. **Deploy the authenticated AniList list-access functions:**

   ```bash
   supabase functions deploy anilist-add-to-list
   supabase functions deploy anilist-disconnect
   supabase functions deploy anilist-list-options
   ```

5. **Deploy the rate-limited discussion write functions:**

   ```bash
   supabase functions deploy thread-create
   supabase functions deploy thread-post
   ```

6. Configure the three frontend `VITE_` build values, GitHub Pages, and the exact AniList callback in `HANDOFF-PAGES.md`, then deploy the static site.
7. Smoke-test OAuth/token storage, friend requests, accepted-friend chat, recommendation history/replies, queue membership and edits, thread pagination/realtime/rate limits/spoiler blur, taste comparison with public and private lists, add-to-Planning for a new anime, existing-list detection without status/progress changes, invalid-token reauthorization, and disconnect. Confirm as an authenticated browser role that `anilist_tokens` and `rate_limits` are unreadable and unwritable.

Phase 1 adds no Storage bucket and no new function secret. The existing `ALLOWED_ORIGIN` secret is required by both thread functions.

No migration, secret, function, or Pages setting is deployed by this source package. Review and test in a development Supabase project first.
