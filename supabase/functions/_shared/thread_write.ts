import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const encoder = new TextEncoder();
type WriteKind = "create" | "post";

function response(body: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  } });
}

function integer(value: unknown, min = 1, max = 2_147_483_647): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

async function hashPrincipal(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function handleThreadWrite(request: Request, kind: WriteKind) {
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
  if (request.method !== "POST") return response({ error: "Use the discussion form to post." }, 405, allowedOrigin);
  if (Number(request.headers.get("Content-Length") || 0) > 8192) return response({ error: "That post is too large." }, 413, allowedOrigin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return response({ error: "Discussions are taking a short pause." }, 503, allowedOrigin);
  const bearer = (request.headers.get("Authorization") || "").match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!bearer) return response({ error: "Please sign in to join this discussion." }, 401, allowedOrigin);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(bearer);
  const user = authData.user;
  if (authError || !user) return response({ error: "Your session needs a refresh. Please sign in again." }, 401, allowedOrigin);
  const { data: siteBan } = await admin.from("site_bans").select("user_id").eq("user_id", user.id).maybeSingle();
  if (siteBan) return response({ error: "This account can’t post to ARNS right now." }, 403, allowedOrigin);

  let body: unknown;
  try { body = await request.json(); } catch { return response({ error: "That post didn’t come through. Try again." }, 400, allowedOrigin); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "That post didn’t come through. Try again." }, 400, allowedOrigin);
  const input = body as Record<string, unknown>;
  const expectedKeys = kind === "create" ? ["media_id", "episode", "title"] : ["thread_id", "body", "episode_tag"];
  if (Object.keys(input).some((key) => !expectedKeys.includes(key)) || expectedKeys.some((key) => !(key in input))) {
    return response({ error: "That discussion request isn’t valid." }, 400, allowedOrigin);
  }
  if (kind === "create") {
    if (!integer(input.media_id) || (input.episode !== null && !integer(input.episode)) || typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 120) {
      return response({ error: "Add a title and a valid AniList ID or episode number." }, 400, allowedOrigin);
    }
  } else {
    if (typeof input.thread_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.thread_id)
      || typeof input.body !== "string" || !input.body.trim() || input.body.trim().length > 2000
      || (input.episode_tag !== null && !integer(input.episode_tag))) {
      return response({ error: "Keep your reply under 2,000 characters and check its episode tag." }, 400, allowedOrigin);
    }
  }

  try {
    const limitHash = await hashPrincipal(`thread-${kind}:${user.id}`);
    const { data: allowed, error: rateError } = await admin.rpc("consume_auth_rate_limit", {
      p_ip_hash: limitHash,
      p_window_seconds: 60,
      p_max_requests: kind === "create" ? 5 : 30,
    });
    if (rateError) {
      console.error(`thread-${kind} rate-limit check failed.`);
      return response({ error: "That discussion is busy. Try again in a moment." }, 503, allowedOrigin);
    }
    if (allowed !== true) return response({ error: "You’ve posted a few times in a row. Take a moment and try again." }, 429, allowedOrigin);

    if (kind === "create") {
      const { data, error } = await admin.from("threads").insert({ media_id: input.media_id, episode: input.episode, title: (input.title as string).trim(), created_by: user.id }).select("id,media_id,episode,title,created_by,created_at").single();
      if (error || !data) {
        console.error("thread-create could not save the thread.");
        return response({ error: "That thread couldn’t be started just now." }, 503, allowedOrigin);
      }
      return response({ thread: data }, 201, allowedOrigin);
    }
    const { data: thread, error: threadError } = await admin.from("threads").select("id").eq("id", input.thread_id).maybeSingle();
    if (threadError || !thread) return response({ error: "That thread isn’t available." }, 404, allowedOrigin);
    const { data, error } = await admin.from("thread_posts").insert({ thread_id: input.thread_id, author: user.id, body: (input.body as string).trim(), episode_tag: input.episode_tag }).select("id,thread_id,author,body,episode_tag,created_at").single();
    if (error || !data) {
      console.error("thread-post could not save the reply.");
      return response({ error: "Your reply couldn’t be sent just now." }, 503, allowedOrigin);
    }
    return response({ post: data }, 201, allowedOrigin);
  } catch {
    console.error(`thread-${kind} encountered an unexpected error.`);
    return response({ error: "That discussion couldn’t be updated just now." }, 500, allowedOrigin);
  }
}
