import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function json(body: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", Vary: "Origin",
  } });
}

export function cors(request: Request) {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.trim() || "";
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigin || origin !== allowedOrigin) return { allowedOrigin, response: new Response("Origin is not allowed.", { status: 403 }) };
  if (request.method === "OPTIONS") return { allowedOrigin, response: new Response("ok", { headers: {
    "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", Vary: "Origin",
  } }) };
  if (request.method !== "POST") return { allowedOrigin, response: json({ error: "Use POST for this action." }, 405, allowedOrigin) };
  return { allowedOrigin, response: null };
}

export async function context(request: Request): Promise<{ admin: SupabaseClient; user: { id: string }; error?: string }> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return { admin: null as unknown as SupabaseClient, user: { id: "" }, error: "Function is not configured." };
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { admin: null as unknown as SupabaseClient, user: { id: "" }, error: "Sign in to continue." };
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return { admin, user: { id: "" }, error: "Your session needs a refresh. Sign in again." };
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`arns-community:${data.user.id}`));
  const hash = [...new Uint8Array(hashBuffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const { data: allowed, error: rateError } = await admin.rpc("consume_auth_rate_limit", { p_ip_hash: hash, p_window_seconds: 60, p_max_requests: 20 });
  if (rateError || allowed !== true) return { admin, user: { id: "" }, error: rateError ? "This request could not be checked. Try again shortly." : "You’ve made several changes in a row. Take a moment and try again." };
  return { admin, user: { id: data.user.id } };
}

export function isUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }

export async function roleFor(admin: SupabaseClient, userId: string, communityId: string) {
  const [{ data: profile }, { data: membership }] = await Promise.all([
    admin.from("profiles").select("is_admin").eq("id", userId).maybeSingle(),
    admin.from("community_members").select("role").eq("community_id", communityId).eq("member_id", userId).maybeSingle(),
  ]);
  return { admin: profile?.is_admin === true, role: membership?.role as "owner" | "mod" | "member" | undefined };
}

export async function audit(admin: SupabaseClient, fields: {
  community_id: string | null; actor: string; action: string; target_type: string; target_id: string | null;
  target_user: string | null; reason: string; expires_at?: string | null;
}) {
  const { error } = await admin.from("mod_actions").insert(fields);
  if (error) console.error("Moderation audit record could not be saved.");
}
