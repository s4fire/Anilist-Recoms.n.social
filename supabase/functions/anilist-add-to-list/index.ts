import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { decryptAniListToken } from "../_shared/token_crypto.ts";

const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const CHECK_QUERY = `query CheckEntry($mediaId: Int!) {
  media: Media(id: $mediaId, type: ANIME) {
    id
    type
    mediaListEntry { id status progress }
  }
}`;
const LIST_OPTIONS_QUERY = `query {
  Viewer {
    mediaListOptions {
      animeList { customLists }
    }
  }
}`;
const ADD_QUERY = `mutation AddToPlanning($mediaId: Int!, $customLists: [String]) {
  SaveMediaListEntry(mediaId: $mediaId, status: PLANNING, customLists: $customLists) { id status progress customLists }
}`;
const encoder = new TextEncoder();

type AniListPayload = {
  data?: {
    media?: { id: number; type: string; mediaListEntry?: { id: number; status: string; progress: number } | null } | null;
    SaveMediaListEntry?: { id: number; status: string; progress: number } | null;
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
  if (request.method !== "POST") return json({ error: "Please use the Add to my AniList button." }, 405, allowedOrigin);
  if (Number(request.headers.get("Content-Length") || 0) > 4096) return json({ error: "That request is too large." }, 413, allowedOrigin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "AniList list access is temporarily unavailable." }, 503, allowedOrigin);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const authorization = request.headers.get("Authorization") || "";
  const bearer = authorization.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!bearer) return reauth(allowedOrigin);
  const { data: authData, error: authError } = await admin.auth.getUser(bearer);
  const user = authData.user;
  if (authError || !user) return reauth(allowedOrigin);

  let input: unknown;
  try { input = await request.json(); } catch { return json({ error: "Send a recommendation to add." }, 400, allowedOrigin); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "Send a recommendation to add." }, 400, allowedOrigin);
  const body = input as Record<string, unknown>;
  const mediaId = body.media_id;
  if (typeof mediaId !== "number" || !Number.isSafeInteger(mediaId) || mediaId < 1 || mediaId > 2_147_483_647 || Object.keys(body).some((key) => key !== "media_id")) {
    return json({ error: "That AniList anime ID is not valid." }, 400, allowedOrigin);
  }

  try {
    const userHash = await sha256(`anilist-add-to-list:${user.id}`);
    const { data: allowed, error: rateError } = await admin.rpc("consume_auth_rate_limit", {
      p_ip_hash: userHash,
      p_window_seconds: 60,
      p_max_requests: 10,
    });
    if (rateError) {
      console.error("anilist-add-to-list rate-limit check failed.");
      return json({ error: "AniList list access is taking a short pause. Try again shortly." }, 503, allowedOrigin);
    }
    if (allowed !== true) return json({ error: "Too many list updates in a short time. Please wait a minute and try again." }, 429, allowedOrigin);

    const { data: tokenRow, error: tokenError } = await admin.from("anilist_tokens").select("encrypted_token").eq("user_id", user.id).maybeSingle();
    if (tokenError) {
      console.error("anilist-add-to-list could not load account token.");
      return json({ error: "Your AniList connection could not be checked just now." }, 503, allowedOrigin);
    }
    if (!tokenRow?.encrypted_token) return reauth(allowedOrigin);

    let aniListToken: string;
    try { aniListToken = await decryptAniListToken(user.id, tokenRow.encrypted_token); }
    catch { return reauth(allowedOrigin); }

    let checkResponse: Response;
    try {
      checkResponse = await fetch(ANILIST_GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${aniListToken}` },
        body: JSON.stringify({ query: CHECK_QUERY, variables: { mediaId } }),
      });
    } catch { return json({ error: "AniList could not be reached. Please try again." }, 502, allowedOrigin); }
    const checkPayload = await checkResponse.json().catch(() => null) as AniListPayload | null;
    if (isAuthFailure(checkResponse.status, checkPayload?.errors)) return reauth(allowedOrigin);
    if (!checkResponse.ok || checkPayload?.errors?.length || !checkPayload?.data) {
      return json({ error: "AniList could not check this anime just now. Please try again." }, 502, allowedOrigin);
    }
    if (!checkPayload.data.media) return json({ error: "That anime could not be found on AniList." }, 404, allowedOrigin);
    if (checkPayload.data.media.type !== "ANIME") return json({ error: "Only anime recommendations can be added here." }, 400, allowedOrigin);
    if (checkPayload.data.media.mediaListEntry) return json({ ok: true, already_on_list: true }, 200, allowedOrigin);

    if (customLists.length) {
      let optionsResponse: Response;
      try {
        optionsResponse = await fetch(ANILIST_GRAPHQL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${aniListToken}` },
          body: JSON.stringify({ query: LIST_OPTIONS_QUERY }),
        });
      } catch {
        return json({ error: "AniList could not load your custom lists just now. Please try again." }, 502, allowedOrigin);
      }
      const optionsPayload = await optionsResponse.json().catch(() => null) as AniListPayload & {
        data?: { Viewer?: { mediaListOptions?: { animeList?: { customLists?: unknown } } | null } | null }
      } | null;
      if (isAuthFailure(optionsResponse.status, optionsPayload?.errors)) return reauth(allowedOrigin);
      if (!optionsResponse.ok || optionsPayload?.errors?.length || !optionsPayload?.data?.Viewer) {
        return json({ error: "AniList could not load your custom lists just now. Please try again." }, 502, allowedOrigin);
      }
      const configured = Array.isArray(optionsPayload.data.Viewer.mediaListOptions?.animeList?.customLists)
        ? optionsPayload.data.Viewer.mediaListOptions?.animeList?.customLists.filter((name): name is string => typeof name === "string")
        : [];
      if (customLists.some((name) => !configured.includes(name))) {
        return json({ error: "One of those custom lists is no longer available. Refresh the list choices and try again." }, 400, allowedOrigin);
      }
    }

    // Check first so SaveMediaListEntry never intentionally overwrites an existing status or progress.
    let addResponse: Response;
    try {
      addResponse = await fetch(ANILIST_GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${aniListToken}` },
        body: JSON.stringify({ query: ADD_QUERY, variables: { mediaId, customLists: customLists.length ? customLists : null } }),
      });
    } catch { return json({ error: "AniList could not be reached. Please try again." }, 502, allowedOrigin); }
    const addPayload = await addResponse.json().catch(() => null) as AniListPayload | null;
    if (isAuthFailure(addResponse.status, addPayload?.errors)) return reauth(allowedOrigin);
    if (!addResponse.ok || addPayload?.errors?.length || !addPayload?.data?.SaveMediaListEntry) {
      return json({ error: "AniList could not add this anime to Planning. Please try again." }, 502, allowedOrigin);
    }
    return json({ ok: true }, 200, allowedOrigin);
  } catch {
    console.error("anilist-add-to-list encountered an unexpected error.");
    return json({ error: "That anime could not be added just now. Please try again." }, 500, allowedOrigin);
  }
});
