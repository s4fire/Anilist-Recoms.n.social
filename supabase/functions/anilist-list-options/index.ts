import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { decryptAniListToken } from "../_shared/token_crypto.ts";

const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const LIST_OPTIONS_QUERY = `query {
  Viewer {
    mediaListOptions {
      animeList { customLists }
    }
  }
}`;
const encoder = new TextEncoder();

type AniListPayload = {
  data?: {
    Viewer?: {
      mediaListOptions?: {
        animeList?: { customLists?: unknown } | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

function json(body: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  } });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isAuthFailure(status: number, errors: AniListPayload["errors"]) {
  const text = (errors || []).map((error) => error.message || "").join(" ").toLowerCase();
  return status === 401 || status === 403 || /unauthori[sz]ed|invalid token|expired token|access token.*(invalid|expired)|authentication required/.test(text);
}

function reauth(origin: string) {
  return json({ error: "Your AniList list access needs to be reconnected. Please log in with AniList again.", code: "reauth_required" }, 401, origin);
}

Deno.serve(async (request: Request) => {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.trim();
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigin) return new Response("Function is not configured.", { status: 500 });
  if (origin !== allowedOrigin) return new Response("Origin not allowed.", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  } });
  if (request.method !== "POST") return json({ error: "Please use the recommendation composer." }, 405, allowedOrigin);
  if (Number(request.headers.get("Content-Length") || 0) > 2048) return json({ error: "That request is too large." }, 413, allowedOrigin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "AniList list access is temporarily unavailable." }, 503, allowedOrigin);

  const bearer = (request.headers.get("Authorization") || "").match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!bearer) return reauth(allowedOrigin);

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(bearer);
    const user = authData.user;
    if (authError || !user) return reauth(allowedOrigin);

    const userHash = await sha256(`anilist-list-options:${user.id}`);
    const { data: allowed, error: rateError } = await admin.rpc("consume_auth_rate_limit", {
      p_ip_hash: userHash,
      p_window_seconds: 60,
      p_max_requests: 10,
    });
    if (rateError) {
      console.error("anilist-list-options rate-limit check failed.");
      return json({ error: "AniList list access is taking a short pause. Try again shortly." }, 503, allowedOrigin);
    }
    if (allowed !== true) return json({ error: "Too many list requests in a short time. Please wait a minute and try again." }, 429, allowedOrigin);

    const { data: tokenRow, error: tokenError } = await admin.from("anilist_tokens").select("encrypted_token").eq("user_id", user.id).maybeSingle();
    if (tokenError) {
      console.error("anilist-list-options could not load account token.");
      return json({ error: "Your AniList connection could not be checked just now." }, 503, allowedOrigin);
    }
    if (!tokenRow?.encrypted_token) return reauth(allowedOrigin);

    let aniListToken: string;
    try { aniListToken = await decryptAniListToken(user.id, tokenRow.encrypted_token); }
    catch { return reauth(allowedOrigin); }

    let response: Response;
    try {
      response = await fetch(ANILIST_GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${aniListToken}` },
        body: JSON.stringify({ query: LIST_OPTIONS_QUERY }),
      });
    } catch {
      return json({ error: "AniList could not load your custom lists. Please try again." }, 502, allowedOrigin);
    }

    const payload = await response.json().catch(() => null) as AniListPayload | null;
    if (isAuthFailure(response.status, payload?.errors)) return reauth(allowedOrigin);
    if (response.status === 429) return json({ error: "AniList is busy just now. Please try again in a few seconds." }, 429, allowedOrigin);
    if (!response.ok || payload?.errors?.length || !payload?.data?.Viewer) {
      return json({ error: "AniList could not load your custom lists. Please try again." }, 502, allowedOrigin);
    }

    const customLists = Array.isArray(payload.data.Viewer.mediaListOptions?.animeList?.customLists)
      ? payload.data.Viewer.mediaListOptions?.animeList?.customLists.filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      : [];

    return json({ custom_lists: customLists }, 200, allowedOrigin);
  } catch {
    console.error("anilist-list-options encountered an unexpected error.");
    return json({ error: "Your custom lists could not be loaded just now. Please try again." }, 500, allowedOrigin);
  }
});