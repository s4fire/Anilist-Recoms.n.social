import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADAPTERS = new Set(["youtube", "vimeo", "twitch", "dailymotion", "direct", "hls", "external"]);
type Input = Record<string, unknown>;

function json(body: Record<string, unknown>, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", Vary: "Origin",
  } });
}

function validSource(adapter: string, value: unknown): value is string | null {
  if (adapter === "external") return value === null;
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (adapter === "youtube") {
      if (!["youtube.com", "youtu.be", "youtube-nocookie.com"].some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return false;
      const id = host === "youtu.be" ? url.pathname.split("/")[1] : url.searchParams.get("v") || /^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1];
      return Boolean(id && /^[a-zA-Z0-9_-]{11}$/.test(id));
    }
    if (adapter === "vimeo") return (host === "vimeo.com" || host.endsWith(".vimeo.com")) && /(?:^|\/)(\d{5,})(?:\/|$)/.test(url.pathname);
    if (adapter === "twitch") return (host === "twitch.tv" || host.endsWith(".twitch.tv")) && (/^\/videos\/\d+\/?$/.test(url.pathname) || /^\/[a-zA-Z0-9_]+\/?$/.test(url.pathname));
    if (adapter === "dailymotion") return ((host === "dailymotion.com" || host.endsWith(".dailymotion.com")) && /^\/video\/[a-zA-Z0-9]+/.test(url.pathname)) || (host === "dai.ly" && /^\/[a-zA-Z0-9]+\/?$/.test(url.pathname));
    return true;
  } catch { return false; }
}

export async function handleWatchRoom(request: Request) {
  const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN")?.trim() || "";
  const origin = request.headers.get("Origin") || "";
  if (!allowedOrigin || origin !== allowedOrigin) return new Response("Origin is not allowed.", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": allowedOrigin, "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", Vary: "Origin",
  } });
  if (request.method !== "POST") return json({ error: "Use POST for watch room actions." }, 405, allowedOrigin);
  if (Number(request.headers.get("content-length") || 0) > 8192) return json({ error: "That room request is too large." }, 413, allowedOrigin);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!url || !serviceKey) return json({ error: "Watch rooms are taking a short pause." }, 503, allowedOrigin);
  if (!bearer) return json({ error: "Sign in to use watch rooms." }, 401, allowedOrigin);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await admin.auth.getUser(bearer);
  if (authError || !auth.user) return json({ error: "Your session needs a refresh. Sign in again." }, 401, allowedOrigin);
  const userId = auth.user.id;
  const { data: siteBan } = await admin.from("site_bans").select("user_id").eq("user_id", userId).maybeSingle();
  if (siteBan) return json({ error: "This account can’t use watch rooms right now." }, 403, allowedOrigin);
  let raw: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 8192) return json({ error: "That room request is too large." }, 413, allowedOrigin);
    raw = JSON.parse(body);
  } catch { return json({ error: "That room request isn’t valid JSON." }, 400, allowedOrigin); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "That room request isn’t valid." }, 400, allowedOrigin);
  const input = raw as Input;
  const action = input.action;
  const keys: Record<string, string[]> = {
    create: ["action", "media_id", "episode", "adapter", "source_ref", "access", "community_id", "rights_confirmed"],
    join: ["action", "room_id", "invite_code"], transfer: ["action", "room_id", "next_host"], message: ["action", "room_id", "body"], leave: ["action", "room_id"],
  };
  if (typeof action !== "string" || !keys[action] || Object.keys(input).some((key) => !keys[action].includes(key))) return json({ error: "Choose a valid room action." }, 400, allowedOrigin);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`watch-room:${userId}`));
  const rateKey = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const { data: allowed, error: rateError } = await admin.rpc("consume_auth_rate_limit", { p_ip_hash: rateKey, p_window_seconds: 60, p_max_requests: action === "message" ? 35 : 12 });
  if (rateError || allowed !== true) return json({ error: rateError ? "That room request couldn’t be checked. Try again shortly." : "You’ve made several room changes. Take a moment and try again." }, rateError ? 503 : 429, allowedOrigin);

  if (action === "create") {
    const { media_id, episode, adapter, source_ref: sourceRef, access, community_id: communityId } = input;
    if (!Number.isSafeInteger(media_id) || Number(media_id) < 1 || !Number.isSafeInteger(episode) || Number(episode) < 1 || typeof adapter !== "string" || !ADAPTERS.has(adapter) || !validSource(adapter, sourceRef)) return json({ error: "Choose an anime, episode, and valid provider link." }, 400, allowedOrigin);
    if ((adapter === "direct" || adapter === "hls") && input.rights_confirmed !== true) return json({ error: "Confirm that you have the rights to this video before creating the room." }, 400, allowedOrigin);
    if (!(access === "invite" || access === "friends" || access === "community")) return json({ error: "Choose who can join this room." }, 400, allowedOrigin);
    if ((access === "community") !== (typeof communityId === "string" && UUID.test(communityId))) return json({ error: "Choose a community for a community room." }, 400, allowedOrigin);
    if (access !== "community" && communityId !== null) return json({ error: "This room shouldn’t include a community." }, 400, allowedOrigin);
    if (access === "community") {
      const { data: hostMembership } = await admin.from("community_members").select("member_id").eq("community_id", communityId).eq("member_id", userId).maybeSingle();
      if (!hostMembership) return json({ error: "Join that community before starting a room there." }, 403, allowedOrigin);
    }
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    const inviteCode = access === "invite" ? btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "") : null;
    const { data: room, error } = await admin.from("watch_rooms").insert({ host_id: userId, media_id, episode, adapter, source_ref: sourceRef, access, community_id: communityId, invite_code: inviteCode }).select("*").single();
    if (error || !room) return json({ error: "That room couldn’t be started just now." }, 503, allowedOrigin);
    const { error: memberError } = await admin.from("watch_room_members").insert({ room_id: room.id, user_id: userId });
    if (memberError) { await admin.from("watch_rooms").delete().eq("id", room.id); return json({ error: "That room couldn’t be started just now." }, 503, allowedOrigin); }
    return json({ room }, 201, allowedOrigin);
  }

  if (action === "join") {
    if (typeof input.room_id !== "string" || !UUID.test(input.room_id) || (input.invite_code !== undefined && (typeof input.invite_code !== "string" || input.invite_code.length > 64))) return json({ error: "That room link isn’t valid." }, 400, allowedOrigin);
    const { data: room } = await admin.from("watch_rooms").select("id,host_id,access,community_id,invite_code").eq("id", input.room_id).maybeSingle();
    if (!room) return json({ error: "This room has ended or the link is out of date." }, 404, allowedOrigin);
    const { data: existingMembership } = await admin.from("watch_room_members").select("user_id").eq("room_id", room.id).eq("user_id", userId).maybeSingle();
    let canJoin = room.host_id === userId || Boolean(existingMembership);
    if (room.access === "invite") canJoin ||= typeof input.invite_code === "string" && input.invite_code === room.invite_code;
    if (room.access === "friends" && room.host_id !== userId) {
      const { data: friendship } = await admin.from("friendships").select("id").eq("status", "accepted").or(`and(requester.eq.${userId},addressee.eq.${room.host_id}),and(requester.eq.${room.host_id},addressee.eq.${userId})`).maybeSingle();
      canJoin ||= Boolean(friendship);
    }
    if (room.access === "community" && room.community_id) {
      const { data: member } = await admin.from("community_members").select("member_id").eq("community_id", room.community_id).eq("member_id", userId).maybeSingle();
      canJoin ||= Boolean(member);
    }
    if (!canJoin) return json({ error: "You don’t have access to this room." }, 403, allowedOrigin);
    const { error } = await admin.from("watch_room_members").upsert({ room_id: room.id, user_id: userId }, { onConflict: "room_id,user_id" });
    if (error) return json({ error: "Couldn’t join this room just now." }, 503, allowedOrigin);
    const { data: fullRoom } = await admin.from("watch_rooms").select("id,host_id,media_id,episode,adapter,source_ref,state,position_seconds,state_updated_at,access,community_id,created_at").eq("id", room.id).single();
    return json({ room: fullRoom }, 200, allowedOrigin);
  }

  if (action === "transfer") {
    if (typeof input.room_id !== "string" || !UUID.test(input.room_id) || typeof input.next_host !== "string" || !UUID.test(input.next_host)) return json({ error: "Choose a room participant to host." }, 400, allowedOrigin);
    const { data: room } = await admin.from("watch_rooms").select("host_id").eq("id", input.room_id).maybeSingle();
    if (!room || room.host_id !== userId) return json({ error: "Only the current host can transfer the controls." }, 403, allowedOrigin);
    const { data: next } = await admin.from("watch_room_members").select("user_id").eq("room_id", input.room_id).eq("user_id", input.next_host).maybeSingle();
    if (!next) return json({ error: "That person has left the room." }, 400, allowedOrigin);
    const { error } = await admin.from("watch_rooms").update({ host_id: input.next_host }).eq("id", input.room_id).eq("host_id", userId);
    if (error) return json({ error: "Host controls couldn’t be transferred." }, 503, allowedOrigin);
    return json({ ok: true }, 200, allowedOrigin);
  }

  if (action === "leave") {
    if (typeof input.room_id !== "string" || !UUID.test(input.room_id)) return json({ error: "That room isn’t available." }, 400, allowedOrigin);
    const { data: room } = await admin.from("watch_rooms").select("host_id").eq("id", input.room_id).maybeSingle();
    if (!room) return json({ ok: true }, 200, allowedOrigin);
    if (room.host_id === userId) return json({ error: "Transfer the host controls before leaving." }, 409, allowedOrigin);
    const { error } = await admin.from("watch_room_members").delete().eq("room_id", input.room_id).eq("user_id", userId);
    if (error) return json({ error: "You couldn’t leave this room just now." }, 503, allowedOrigin);
    return json({ ok: true }, 200, allowedOrigin);
  }

  if (typeof input.room_id !== "string" || !UUID.test(input.room_id)) return json({ error: "That room isn’t available." }, 400, allowedOrigin);
  const { data: member } = await admin.from("watch_room_members").select("user_id").eq("room_id", input.room_id).eq("user_id", userId).maybeSingle();
  if (!member) return json({ error: "Join the room before sending a message." }, 403, allowedOrigin);
  if (typeof input.body !== "string" || !input.body.trim() || input.body.trim().length > 1000) return json({ error: "Keep room messages under 1,000 characters." }, 400, allowedOrigin);
  const { data: message, error } = await admin.from("room_messages").insert({ room_id: input.room_id, author: userId, body: input.body.trim() }).select("id,room_id,author,body,created_at").single();
  if (error || !message) return json({ error: "Your message couldn’t be sent just now." }, 503, allowedOrigin);
  return json({ message }, 201, allowedOrigin);
}
