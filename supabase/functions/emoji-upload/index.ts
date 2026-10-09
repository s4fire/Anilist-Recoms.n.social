import { context, cors, isUuid, json, roleFor } from "../_shared/community_moderation.ts";

function dims(bytes: Uint8Array, type: string): [number, number] | null {
  const u8 = (index: number) => bytes[index] || 0;
  const u16le = (index: number) => u8(index) | (u8(index + 1) << 8);
  const u24le = (index: number) => u8(index) | (u8(index + 1) << 8) | (u8(index + 2) << 16);
  if (type === "image/png" && bytes.length >= 24) return [new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16), new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20)];
  if (type === "image/gif" && bytes.length >= 10) return [u16le(6), u16le(8)];
  if (type !== "image/webp" || bytes.length < 30) return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X") return [u24le(24) + 1, u24le(27) + 1];
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return [u16le(26) & 0x3fff, u16le(28) & 0x3fff];
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const width = 1 + u8(21) + ((u8(22) & 0x3f) << 8);
    const height = 1 + ((u8(22) >> 6) & 0x03) + (u8(23) << 2) + ((u8(24) & 0x0f) << 10);
    return [width, height];
  }
  return null;
}

function validBytes(bytes: Uint8Array, type: string) {
  if (type === "image/png") return bytes.length >= 24 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value) && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR";
  if (type === "image/gif") return bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.slice(0, 6)));
  if (type === "image/webp") return bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

Deno.serve(async (request: Request) => {
  const { allowedOrigin, response } = cors(request);
  if (response) return response;
  if (!allowedOrigin) return new Response("Function is not configured.", { status: 500 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 280_000) return json({ error: "Keep the emoji file under 256 KB." }, 413, allowedOrigin);
  const { admin, user, error: authError } = await context(request);
  if (authError) return json({ error: authError }, authError.includes("several changes") ? 429 : 401, allowedOrigin);
  const { data: siteBan } = await admin.from("site_bans").select("user_id").eq("user_id", user.id).maybeSingle();
  if (siteBan) return json({ error: "This account can’t upload community emoji." }, 403, allowedOrigin);
  let form: FormData;
  try {
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.byteLength > 280_000) return json({ error: "Keep the emoji file under 256 KB." }, 413, allowedOrigin);
    const contentType = request.headers.get("Content-Type") || "multipart/form-data";
    form = await new Response(raw, { headers: { "Content-Type": contentType } }).formData();
  } catch { return json({ error: "Choose an emoji image and name." }, 400, allowedOrigin); }
  const communityId = form.get("community_id");
  const name = form.get("name");
  const file = form.get("file");
  if (!isUuid(communityId) || typeof name !== "string" || !/^[a-z0-9_]{2,32}$/.test(name) || !(file instanceof File)) {
    return json({ error: "Use a name with 2–32 lowercase letters, numbers, or underscores." }, 400, allowedOrigin);
  }
  if (file.size < 1 || file.size > 262_144) return json({ error: "Keep the emoji file under 256 KB." }, 413, allowedOrigin);
  if (!["image/png", "image/webp", "image/gif"].includes(file.type)) return json({ error: "Choose a PNG, WebP, or GIF image." }, 415, allowedOrigin);
  const { admin: isAdmin, role } = await roleFor(admin, user.id, communityId);
  if (!isAdmin && !["owner", "mod"].includes(role || "")) return json({ error: "Only this community’s moderators can add emoji." }, 403, allowedOrigin);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validBytes(bytes, file.type)) return json({ error: "That file doesn’t match its image type." }, 415, allowedOrigin);
  const dimensions = dims(bytes, file.type);
  if (!dimensions) return json({ error: "That image format couldn’t be read. Try a standard PNG, WebP, or GIF." }, 415, allowedOrigin);
  if (dimensions[0] < 1 || dimensions[1] < 1 || dimensions[0] > 128 || dimensions[1] > 128) return json({ error: "Emoji images must be 128 × 128 pixels or smaller." }, 422, allowedOrigin);

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "gif";
  const path = `${communityId}/${crypto.randomUUID()}.${extension}`;
  try {
    const { error: uploadError } = await admin.storage.from("community-emojis").upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploadError) return json({ error: "That emoji couldn’t be uploaded just now." }, 503, allowedOrigin);
    const { data: emoji, error } = await admin.rpc("add_community_emoji", { p_community_id: communityId, p_name: name, p_path: path, p_uploaded_by: user.id });
    if (error || !emoji) {
      await admin.storage.from("community-emojis").remove([path]);
      if (error?.code === "23505") return json({ error: "That emoji name is already taken in this community." }, 409, allowedOrigin);
      if (error?.code === "23514") return json({ error: "This community already has 50 emoji." }, 409, allowedOrigin);
      return json({ error: "That emoji couldn’t be added just now." }, 503, allowedOrigin);
    }
    const { data: publicUrl } = admin.storage.from("community-emojis").getPublicUrl(path);
    return json({ emoji: { ...emoji, url: publicUrl.publicUrl } }, 201, allowedOrigin);
  } catch {
    await admin.storage.from("community-emojis").remove([path]);
    console.error("emoji-upload could not finish a validated upload.");
    return json({ error: "That emoji couldn’t be added just now." }, 500, allowedOrigin);
  }
});
