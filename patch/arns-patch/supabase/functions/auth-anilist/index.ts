import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { encryptAniListToken, validateTokenEncryptionKey } from "../_shared/token_crypto.ts";

const ANILIST_TOKEN_URL = "https://anilist.co/api/v2/oauth/token";
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const VIEWER_QUERY = `query { Viewer { id name avatar { large } bannerImage } }`;
const encoder = new TextEncoder();

type JsonRecord = Record<string, unknown>;

function response(body: JsonRecord, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Vary": "Origin",
    },
  });
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientIp(request: Request) {
  const cloudflare = request.headers.get("cf-connecting-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return cloudflare || forwarded || request.headers.get("x-real-ip") || "unknown";
}

function validRedirectUri(value: string, allowedOrigin: string) {
  try {
    const url = new URL(value);
    return url.origin === allowedOrigin && url.pathname.endsWith("/") && !url.search && !url.hash && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

async function findProfile(admin: ReturnType<typeof createClient>, anilistId: number) {
  const { data, error } = await admin.from("profiles").select("id").eq("anilist_id", anilistId).maybeSingle();
  if (error) throw new Error("Could not look up the account profile.");
  return data as { id: string } | null;
}

Deno.serve(async (request: Request) => {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.trim();
  if (!allowedOrigin) return new Response("Function is not configured.", { status: 500 });
  const origin = request.headers.get("Origin") || "";
  if (origin !== allowedOrigin) return new Response("Origin not allowed.", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  } });
  if (request.method !== "POST") return response({ error: "Please use the sign-in button to continue." }, 405, allowedOrigin);

  try {
    const clientId = Deno.env.get("ANILIST_CLIENT_ID");
    const clientSecret = Deno.env.get("ANILIST_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!clientId || !clientSecret || !supabaseUrl || !serviceRoleKey) {
      console.error("auth-anilist configuration is incomplete.");
      return response({ error: "Sign-in is not ready yet. Please try again later." }, 503, allowedOrigin);
    }
    try { await validateTokenEncryptionKey(); }
    catch {
      console.error("auth-anilist secure token storage is not configured.");
      return response({ error: "Secure AniList list access is not ready yet. Please try again later." }, 503, allowedOrigin);
    }

    let input: unknown;
    try { input = await request.json(); } catch { return response({ error: "That sign-in request was incomplete. Please try again." }, 400, allowedOrigin); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return response({ error: "That sign-in request was incomplete. Please try again." }, 400, allowedOrigin);
    const body = input as Record<string, unknown>;
    if (typeof body.code !== "string" || body.code.length < 8 || body.code.length > 1024 || /[\u0000-\u001f\u007f]/.test(body.code)) {
      return response({ error: "AniList sent an invalid sign-in code. Please try signing in again." }, 400, allowedOrigin);
    }
    if (typeof body.redirect_uri !== "string" || body.redirect_uri.length > 2048 || !validRedirectUri(body.redirect_uri, allowedOrigin)) {
      return response({ error: "This sign-in address doesn’t match the app’s configured origin." }, 400, allowedOrigin);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const ipHash = await sha256(clientIp(request));
    const { data: allowed, error: rateError } = await admin.rpc("consume_auth_rate_limit", {
      p_ip_hash: ipHash,
      p_window_seconds: 60,
      p_max_requests: 10,
    });
    if (rateError) {
      console.error("auth-anilist rate-limit check failed.");
      return response({ error: "Sign-in is taking a short pause. Please try again shortly." }, 503, allowedOrigin);
    }
    if (allowed !== true) return response({ error: "Too many sign-in attempts. Please wait a minute and try again." }, 429, allowedOrigin);

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(ANILIST_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: body.redirect_uri,
          code: body.code,
        }),
      });
    } catch {
      return response({ error: "AniList couldn’t be reached. Please try signing in again." }, 502, allowedOrigin);
    }
    if (!tokenResponse.ok) return response({ error: "That AniList sign-in code has expired or was already used. Please sign in again." }, 401, allowedOrigin);
    const tokenPayload = await tokenResponse.json().catch(() => null) as { access_token?: string } | null;
    if (!tokenPayload?.access_token || typeof tokenPayload.access_token !== "string") {
      return response({ error: "AniList didn’t finish sign-in. Please try again." }, 502, allowedOrigin);
    }

    let viewerResponse: Response;
    try {
      viewerResponse = await fetch(ANILIST_GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${tokenPayload.access_token}` },
        body: JSON.stringify({ query: VIEWER_QUERY }),
      });
    } catch {
      return response({ error: "We couldn’t read your AniList profile just now. Please try again." }, 502, allowedOrigin);
    }
    const viewerPayload = await viewerResponse.json().catch(() => null) as { data?: { Viewer?: { id?: number; name?: string; avatar?: { large?: string | null }; bannerImage?: string | null } } } | null;
    const viewer = viewerPayload?.data?.Viewer;
    if (!viewerResponse.ok || !viewer || !Number.isSafeInteger(viewer.id) || !viewer.id || typeof viewer.name !== "string" || !viewer.name.trim()) {
      return response({ error: "AniList couldn’t confirm your profile. Please sign in again." }, 401, allowedOrigin);
    }

    const email = `anilist_${viewer.id}@users.invalid`;
    let profile = await findProfile(admin, viewer.id);
    let authUserId = profile?.id;
    if (!authUserId) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: randomPassword(),
        email_confirm: true,
        user_metadata: { anilist_id: viewer.id },
      });
      if (!createError && created.user) authUserId = created.user.id;
      else {
        // A simultaneous first login may have created the auth user/profile. Wait briefly for its profile upsert.
        for (let attempt = 0; attempt < 5 && !authUserId; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 160));
          profile = await findProfile(admin, viewer.id);
          authUserId = profile?.id;
        }
        if (!authUserId) {
          console.error("auth-anilist could not establish an auth user.");
          return response({ error: "We couldn’t create your ARNS account. Please try again." }, 500, allowedOrigin);
        }
      }
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: authUserId,
      anilist_id: viewer.id,
      username: viewer.name.trim(),
      avatar_url: viewer.avatar?.large || null,
      banner_url: viewer.bannerImage || null,
    }, { onConflict: "id" });
    if (profileError) {
      console.error("auth-anilist profile refresh failed.");
      return response({ error: "Your AniList profile could not be refreshed. Please try again." }, 500, allowedOrigin);
    }

    if (!authUserId) return response({ error: "We couldn’t open your ARNS account. Please try again." }, 500, allowedOrigin);
    const encryptedToken = await encryptAniListToken(authUserId, tokenPayload.access_token);
    const { error: tokenStoreError } = await admin.from("anilist_tokens").upsert({
      user_id: authUserId,
      encrypted_token: encryptedToken,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (tokenStoreError) {
      console.error("auth-anilist encrypted token storage failed.");
      return response({ error: "Your secure AniList connection could not be saved. Please try again." }, 500, allowedOrigin);
    }

    // generateLink creates a single-use Supabase magic-link token without emailing it. Verifying it
    // server-side yields a normal Supabase session; only that session (never the AniList token) leaves this function.
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const hashedToken = linkData?.properties?.hashed_token;
    if (linkError || !hashedToken) {
      console.error("auth-anilist Supabase session-link creation failed.");
      return response({ error: "Your account is ready, but sign-in could not be completed. Please try again." }, 500, allowedOrigin);
    }
    const { data: sessionData, error: sessionError } = await admin.auth.verifyOtp({ email, token: hashedToken, type: "magiclink" });
    if (sessionError || !sessionData.session?.access_token || !sessionData.session.refresh_token) {
      console.error("auth-anilist Supabase session verification failed.");
      return response({ error: "Your account is ready, but the session could not be opened. Please try again." }, 500, allowedOrigin);
    }

    return response({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
    }, 200, allowedOrigin);
  } catch {
    console.error("auth-anilist encountered an unexpected error.");
    return response({ error: "Something unexpected interrupted sign-in. Please try again." }, 500, allowedOrigin);
  }
});
