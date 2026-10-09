-- AniList tokens are kept server-only and encrypted with AES-256-GCM before storage.
create table if not exists public.anilist_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  encrypted_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.anilist_tokens is 'Server-only vault of AES-256-GCM encrypted AniList access tokens. Plaintext tokens and encryption keys are never stored here.';
comment on column public.anilist_tokens.encrypted_token is 'Versioned ciphertext; encryption key is supplied only to Edge Functions as TOKEN_ENCRYPTION_KEY.';

alter table public.anilist_tokens enable row level security;
-- Deliberately create no policies. Browser roles cannot read, insert, update, or delete token rows.
revoke all on table public.anilist_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.anilist_tokens to service_role;

-- The existing atomic counter also accepts namespaced SHA-256 user identifiers for the list action.
comment on table public.rate_limits is 'Private short-window counters keyed by one-way SHA-256 hashes of IPs or namespaced internal user identifiers. Raw IPs and user IDs are never stored.';
comment on function public.consume_auth_rate_limit(text, integer, integer) is 'Atomically increments a short-window counter by a one-way principal hash; used for OAuth IP limits and authenticated per-user list-action limits.';
