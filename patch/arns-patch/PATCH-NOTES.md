# ARNS patch notes

This is a source-only patch against the existing frontend and Supabase packages. Frontend paths are at the ZIP root; backend paths are under `supabase/`. No `node_modules`, `dist`, environment files, or deployment secrets are included.

## Files added

| Path in patch ZIP | Purpose |
|---|---|
| `PATCH-NOTES.md` | This patch manifest. |
| `src/components/AniListListAction.tsx` | Add-to-Planning card control with loading, success, existing-entry, error, and AniList reauthorization states. |
| `src/components/SettingsPage.tsx` | Four live theme swatches and AniList list-access disconnect action. |
| `src/components/ThemeProvider.tsx` | Dark-first, persisted theme state, cycle control, and browser theme-color synchronization. |
| `src/lib/edgeFunctions.ts` | Supabase-session-authenticated Edge Function caller; does not handle AniList tokens. |
| `supabase/functions/_shared/token_crypto.ts` | Versioned AES-256-GCM encrypt/decrypt helper with per-user authenticated data. |
| `supabase/functions/anilist-add-to-list/index.ts` | Authenticated, rate-limited, existing-entry-aware Planning-only AniList action. |
| `supabase/functions/anilist-disconnect/index.ts` | Authenticated idempotent removal of the caller's encrypted token row. |
| `supabase/migrations/20261005000300_add_anilist_token_vault.sql` | RLS-enabled token-vault table and server-only grants. |

## Files modified

| Path in patch ZIP | Change |
|---|---|
| `.github/workflows/deploy.yml` | ARNS workflow label; existing Pages deployment behavior retained. |
| `HANDOFF-PAGES.md` | ARNS branding, exact GitHub Pages path, theme tokens, new function contracts, and configuration steps. |
| `README.md` | ARNS setup, Pages path, security boundaries, themes, and add-to-list behavior. |
| `index.html` | ARNS metadata/Manrope and a parser-blocking dark-default theme bootstrap to avoid first-paint flash. |
| `package-lock.json` | Keep the lockfile root package identity in sync with the ARNS package name. |
| `package.json` | Rename the frontend package identity to ARNS; dependency versions and scripts are unchanged. |
| `public/manus-routes.json` | Update the title and add the Settings route. |
| `src/App.tsx` | ARNS branding, Settings route/nav, quick theme control, and flat image-only home banner. |
| `src/components/AuthView.tsx` | ARNS branding and aligned sign-in copy. |
| `src/components/ChatPage.tsx` | Planning action on chat recommendations and social-only “Interested” reply label. |
| `src/components/FriendsPage.tsx` | ARNS/member-directory wording. |
| `src/components/InboxPage.tsx` | Planning action on inbox recommendations and clear separation from social reply status. |
| `src/main.tsx` | ARNS bootstrap and auth-error copy. |
| `src/styles.css` | Replace warm palette/fonts with tokenized Ink, Sakura Night, Tokyo, and Mist themes; add responsive theme/settings/action styles and reduced-motion handling. |
| `tailwind.config.js` | Map Tailwind colors and type to runtime theme tokens and Manrope. |
| `vite.config.ts` | Set the project-site base to `/Anilist-Recoms.n.social/`. |
| `supabase/HANDOFF-SERVER.md` | Document the encrypted vault, new Edge Functions, secret, migration, and deploy order. |
| `supabase/README.md` | ARNS backend package overview and handoff pointer. |
| `supabase/config.toml` | Rename the local project label and register both authenticated functions. |
| `supabase/functions/auth-anilist/index.ts` | Encrypt/upsert the AniList token server-side while preserving the Supabase-only response contract. |

## Behavior and deployment notes

The AniList credential is encrypted with AES-256-GCM under the server-only `TOKEN_ENCRYPTION_KEY`; the browser receives only its normal Supabase session. A recommendation action validates the media and checks the user's existing AniList entry before writing `PLANNING`. Existing list entries are not intentionally changed, and disconnection deletes only ARNS's encrypted token row. Social recommendations and recipient replies remain separate from AniList tracking.

Apply the three ordered migrations, set the Supabase secrets (including a fresh 32-byte Base64 encryption key), deploy `auth-anilist`, then deploy `anilist-add-to-list` and `anilist-disconnect`. For default Pages hosting, the AniList redirect URI is `https://s4fire.github.io/Anilist-Recoms.n.social/`, while `ALLOWED_ORIGIN` is `https://s4fire.github.io`. Review both handoffs before deployment.
