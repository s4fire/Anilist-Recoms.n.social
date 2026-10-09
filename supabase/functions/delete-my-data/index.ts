import { context, cors, json } from "../_shared/community_moderation.ts";

Deno.serve(async (request: Request) => {
  const { allowedOrigin, response } = cors(request);
  if (response) return response;
  if (!allowedOrigin) return new Response("Function is not configured.", { status: 500 });
  const { admin, user, error } = await context(request);
  if (error) return json({ error }, error.includes("several changes") ? 429 : 401, allowedOrigin);
  try {
    const { data: owned, error: ownedError } = await admin.from("communities").select("id").eq("created_by", user.id);
    if (ownedError) return json({ error: "Your community files couldn’t be found for cleanup. Please try again." }, 503, allowedOrigin);
    const communityIds = (owned || []).map((row) => row.id as string);
    const uploadedQuery = admin.from("community_emojis").select("path").eq("uploaded_by", user.id);
    const communityQuery = communityIds.length
      ? admin.from("community_emojis").select("path").in("community_id", communityIds)
      : Promise.resolve({ data: [] as { path: string }[] });
    const [uploaded, communityEmojiRows] = await Promise.all([uploadedQuery, communityQuery]);
    if (uploaded.error || communityEmojiRows.error) return json({ error: "Your emoji files couldn’t be found for cleanup. Please try again." }, 503, allowedOrigin);
    const paths = [...new Set([...(uploaded.data || []), ...(communityEmojiRows.data || [])].map((row) => row.path))];
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error: storageError } = await admin.storage.from("community-emojis").remove(paths.slice(offset, offset + 100));
      if (storageError) return json({ error: "Your data couldn’t be fully removed just now. Please try again." }, 503, allowedOrigin);
    }
    const { error: tokenError } = await admin.from("anilist_tokens").delete().eq("user_id", user.id);
    if (tokenError) return json({ error: "Your AniList connection couldn’t be removed just now. Please try again." }, 503, allowedOrigin);
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) return json({ error: "Your account couldn’t be removed just now. Please try again." }, 503, allowedOrigin);
    return json({ ok: true }, 200, allowedOrigin);
  } catch {
    console.error("delete-my-data could not complete the account removal request.");
    return json({ error: "Your data couldn’t be fully removed just now. Please try again." }, 500, allowedOrigin);
  }
});
