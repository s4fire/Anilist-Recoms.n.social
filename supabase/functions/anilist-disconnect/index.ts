import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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
  if (request.method !== "POST") return json({ error: "Please use the Disconnect AniList list access button." }, 405, allowedOrigin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "AniList list access is temporarily unavailable." }, 503, allowedOrigin);
  const bearer = (request.headers.get("Authorization") || "").match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!bearer) return json({ error: "Sign in with AniList again to continue.", code: "reauth_required" }, 401, allowedOrigin);

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error: authError } = await admin.auth.getUser(bearer);
    if (authError || !data.user) return json({ error: "Sign in with AniList again to continue.", code: "reauth_required" }, 401, allowedOrigin);
    const { error } = await admin.from("anilist_tokens").delete().eq("user_id", data.user.id);
    if (error) {
      console.error("anilist-disconnect could not remove the account token row.");
      return json({ error: "AniList list access could not be disconnected just now." }, 503, allowedOrigin);
    }
    return json({ ok: true }, 200, allowedOrigin);
  } catch {
    console.error("anilist-disconnect encountered an unexpected error.");
    return json({ error: "AniList list access could not be disconnected just now." }, 500, allowedOrigin);
  }
});
