# Pages handoff — ARNS

## Before publishing

1. The Vite project-site base is set to `/Anilist-Recoms.n.social/` for `s4fire/Anilist-Recoms.n.social`. If the repository uses a custom Pages domain, change `base` in `vite.config.ts` to `/` before building.
2. With the default GitHub Pages hostname, set AniList's OAuth redirect URI to the exact URL `https://s4fire.github.io/Anilist-Recoms.n.social/` (including path and trailing slash). For a custom domain, use the matching root URL instead.
3. Apply the twelve ordered Supabase migrations and deploy the ten configured Edge Functions as described in `supabase/HANDOFF-SERVER.md` before testing the frontend.
4. Set the three required frontend build values in local `.env.local` or GitHub Actions repository variables/secrets. Set `VITE_DAILYMOTION_PLAYER_ID` only if you want to enable that adapter. `VITE_` values are public in the compiled client by definition.
5. Set Supabase Edge Function `ALLOWED_ORIGIN` to the website **origin only**: `https://s4fire.github.io` for the default Pages URL (no repository path and no trailing slash).
6. In GitHub **Settings → Pages**, use **GitHub Actions**. The included workflow builds `main` and deploys `dist/`.

## Frontend environment variables

| Name | Required | Where it is used |
|---|---:|---|
| `VITE_ANILIST_CLIENT_ID` | Yes | Starts AniList's `/api/v2/oauth/authorize` flow; it is public. |
| `VITE_SUPABASE_URL` | Yes | Creates the public Supabase client and Edge Function URLs. |
| `VITE_SUPABASE_ANON_KEY` | Yes | Browser `apikey` header and public Supabase client; it is not a service key. |
| `VITE_DAILYMOTION_PLAYER_ID` | No | Public Dailymotion Studio Player ID used to initialize its official Web SDK player. |

`.env.example` contains empty public values only. `.gitignore` excludes real `.env*` files, dependencies, and build output. Never put the AniList client secret, encryption key, or Supabase service-role key in this frontend package or a `VITE_` value.

## Phase 3 watch rooms

- Start at `/watch-together`, choose an anime using AniList search, select an episode and one of the supported room modes, then share the invite link or choose friends/community access.
- `watch_rooms` stores the AniList media ID and episode, adapter name, provider/direct URL, room access and authoritative playback state. `watch_room_members` authorizes room access; Presence is the live participant list. `room_messages` is separate from direct messages.
- Only the current host can write room state under RLS. A verified `watch-room` Edge Function handles room creation, access checks, host transfer, leave, and rate-limited room chat. Host transfer is checked against current room membership.
- YouTube, Vimeo, Twitch, and Dailymotion use provider SDK embeds; provider settings and embedding restrictions are honored. Twitch requires `parent` to match the deployed domain and its player requires a sufficiently wide viewport. Dailymotion requires the public `VITE_DAILYMOTION_PLAYER_ID` value.
- Direct file/HLS links are HTTPS and require the host to confirm they have rights to play the content. Cross-origin HLS servers must permit browser CORS. External sync embeds no video; AniList external links are shown when available and each person uses their own legal stream.
- Player controls update shared state only on play, pause, seek, or episode change. Clients estimate the room clock locally and correct drift above about 1.5 seconds; they do not write timer ticks.
- Provider research and terms notes are in [`../RESEARCH.md`](../RESEARCH.md). No resolver, scraper, screen sharing, or subscription-service rebroadcast is included.

## Function contracts used by the frontend

### `auth-anilist` (pre-session OAuth exchange)

- **Request:** `POST {VITE_SUPABASE_URL}/functions/v1/auth-anilist`
- **Headers:** `Content-Type: application/json`, `apikey: VITE_SUPABASE_ANON_KEY`
- **Body:** `{ "code": "<one-time AniList authorization code>", "redirect_uri": "<exact Pages root URL with trailing slash>" }`
- **Success:** HTTP `200`, `{ "access_token": "<Supabase access token>", "refresh_token": "<Supabase refresh token>" }`
- **After success:** install that pair using `supabase.auth.setSession(...)`.
- The AniList token is encrypted and stored server-side; it is never included in the response. OAuth query parameters are removed before `HashRouter` mounts.

### `anilist-add-to-list` (session required)

- **Request:** `POST {VITE_SUPABASE_URL}/functions/v1/anilist-add-to-list`
- **Headers:** `Content-Type: application/json`, `apikey: VITE_SUPABASE_ANON_KEY`, and `Authorization: Bearer <current Supabase access token>`.
- **Body:** `{ "media_id": <positive AniList anime ID> }`.
- **Success:** HTTP `200`, `{ "ok": true }` for a newly added Planning entry or `{ "ok": true, "already_on_list": true }` when an entry already exists.
- **Reauthorization:** HTTP `401`, `{ "error": "...", "code": "reauth_required" }`. The card offers “Log in with AniList again.”
- The browser never receives or handles the AniList access token. The backend checks that the media is anime and checks `MediaList(mediaId, userId)` before using `SaveMediaListEntry(status: PLANNING)`.

### `anilist-disconnect` (session required)

- **Request:** `POST {VITE_SUPABASE_URL}/functions/v1/anilist-disconnect`, with the same public `apikey` and current Supabase bearer header, and an empty JSON object body.
- **Success:** HTTP `200`, `{ "ok": true }`. It deletes the signed-in user's encrypted token row only; it does not alter chats, recommendations, or AniList list entries.

## Design decisions

- **Name:** ARNS, an independent social companion for AniList.
- **Type:** Manrope throughout: legible, modern sans serif for interface and headings.
- **Themes:** Ink is the dark default; Sakura Night, Tokyo, and Mist are also available. The quick theme button cycles them, Settings offers explicit selection, and the choice is stored locally. Theme tokens also drive the Tailwind palette; the app does not infer appearance from the OS.
- **Palette:** one clear accent per theme, cool neutral surfaces, visible borders, and dedicated semantic success/danger colors. Cover art remains the only intentionally image-driven color source; the UI uses no background gradients.
- **Layout:** the existing friend rail, conversation canvas, recommendation inbox, composer, and mobile navigation remain in place. A Settings route now contains theme selection and list-access disconnect.
- **Motion:** 240 ms theme color transitions respect `prefers-reduced-motion` alongside the existing presence/message transitions.

## Phase 1 anime-aware social core

- Recommendations use `unseen`, `on_my_list`, `seen`, and `not_for_me`. The history page filters sent/received recommendations and reply state. Reason tags, similar-to media IDs, and optional notes are stored; titles and covers are fetched live.
- Watch Next queues are shared social lists only. They store AniList media IDs, who added an item, priority, and `up_next`/`done`; the existing Add to AniList action still uses its server-only token vault and only adds new items to Planning.
- Anime discussion threads store media IDs and optional episode boundaries. `thread-create` and `thread-post` require Supabase user JWTs and rate-limit; replies use Realtime and paginated reads.
- Episode spoiler blur checks the current viewer’s AniList public progress in memory. Missing, private, or unavailable progress keeps tagged posts blurred until the viewer taps to reveal. This is a courtesy, not access control.
- Taste comparison fetches each public list directly from AniList GraphQL with paginated, short-lived in-memory caching and request pacing. The comparison results are not written to Supabase.
- AniList documents a limit of 90 GraphQL requests per minute; the frontend keeps its existing slower request pacing and retries one 429 according to `Retry-After`.
- Communities include public and unlisted discovery, member chat/discussion channels, Realtime updates, member moderation, reports, and a site admin queue. Messages and anime references are social content; titles, covers, lists, scores, and progress still come from AniList or stay out of storage.
- Community emoji pass through `emoji-upload`: only PNG, WebP, and GIF, 256 KB maximum, 128 × 128 maximum, unique names, and 50 per community. Browser Storage writes are denied; only the validated server function writes to the public-read bucket.
- The Settings page can block accounts and request ARNS account deletion. Deletion removes the server-stored AniList token and associated ARNS rows/files; it never edits AniList.
- Terms, Privacy, and Community Guidelines are plain-language project drafts, not legal advice.

## Deliberate scope boundaries

- ARNS is a social layer, not an anime tracker. It never imports list contents, changes a current status/progress/score, or edits user tracking data.
- The Add button is a separate, explicit user action and targets Planning only. Existing AniList entries return an “already on your list” state; inbox reply statuses remain social responses and are not AniList list states.
- Supabase stores profile identity, social records, recommendation media IDs/notes/replies, and encrypted AniList access tokens in a service-role-only vault. Titles, cover art, descriptions, and AniList lists are still fetched from AniList, not copied to the database.
- The app is independently built and not affiliated with or endorsed by AniList.
