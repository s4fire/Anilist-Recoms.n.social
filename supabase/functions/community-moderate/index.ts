import { audit, context, cors, isUuid, json, roleFor } from "../_shared/community_moderation.ts";

const MAX_BODY = 16_000;
const SAFE_ACTIONS = new Set(["report", "close-report", "delete-message", "delete-emoji", "delete-channel", "mute", "unmute", "remove", "ban", "unban", "promote-mod", "demote-mod", "delete-community", "site-ban", "site-unban"]);

Deno.serve(async (request: Request) => {
  const { allowedOrigin, response } = cors(request);
  if (response) return response;
  if (!allowedOrigin) return new Response("Function is not configured.", { status: 500 });
  const { admin, user, error: authError } = await context(request);
  if (authError) return json({ error: authError }, authError.includes("several changes") ? 429 : 401, allowedOrigin);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) return json({ error: "That moderation request is too large." }, 413, allowedOrigin);
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return json({ error: "That moderation request isn’t valid JSON." }, 400, allowedOrigin); }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["action", "community_id", "target_id", "target_type", "target_user", "reason", "duration_minutes", "report_id"].includes(key))) {
    return json({ error: "That moderation request includes unsupported fields." }, 400, allowedOrigin);
  }
  const action = input.action;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (typeof action !== "string" || !SAFE_ACTIONS.has(action) || reason.length > 500) return json({ error: "Choose a valid action and keep its reason under 500 characters." }, 400, allowedOrigin);
  const { data: actorProfile } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  const isAdmin = actorProfile?.is_admin === true;
  const { data: callerBan } = await admin.from("site_bans").select("user_id").eq("user_id", user.id).maybeSingle();
  if (callerBan) return json({ error: "This account can’t use moderation tools." }, 403, allowedOrigin);

  try {
    if (action === "report") {
      const targetType = input.target_type;
      if (!isUuid(input.target_id) || !reason || !["message", "emoji", "community"].includes(String(targetType))) return json({ error: "Choose a reportable item and add a short reason." }, 400, allowedOrigin);
      let communityId: string | null = null;
      if (targetType === "community") communityId = input.target_id;
      else if (targetType === "message") {
        const { data: message } = await admin.from("channel_messages").select("channel_id").eq("id", input.target_id).maybeSingle();
        if (!message) return json({ error: "That message is no longer available." }, 404, allowedOrigin);
        const { data: channel } = await admin.from("channels").select("community_id").eq("id", message.channel_id).maybeSingle();
        communityId = channel?.community_id || null;
      } else {
        const { data: emoji } = await admin.from("community_emojis").select("community_id").eq("id", input.target_id).maybeSingle();
        if (!emoji) return json({ error: "That emoji is no longer available." }, 404, allowedOrigin);
        communityId = emoji.community_id;
      }
      if (!communityId) return json({ error: "That item could not be placed in its community." }, 404, allowedOrigin);
      const { data: report, error } = await admin.from("reports").insert({ reporter: user.id, community_id: communityId, target_type: targetType, target_id: input.target_id, reason }).select("id").single();
      if (error || !report) throw new Error("report insert failed");
      return json({ ok: true }, 201, allowedOrigin);
    }

    const communityId = isUuid(input.community_id) ? input.community_id : null;
    const targetId = isUuid(input.target_id) ? input.target_id : null;
    if (!["site-ban", "site-unban"].includes(action) && !communityId) return json({ error: "Choose a valid community." }, 400, allowedOrigin);
    if (["close-report", "delete-message", "delete-emoji", "delete-channel", "delete-community"].includes(action) && !targetId) return json({ error: "Choose a valid item or member." }, 400, allowedOrigin);
    const { admin: callerIsAdmin, role } = communityId ? await roleFor(admin, user.id, communityId) : { admin: isAdmin, role: undefined };
    if (!callerIsAdmin && !isAdmin && !["owner", "mod"].includes(role || "")) return json({ error: "Only this community’s moderators can do that." }, 403, allowedOrigin);
    if (["site-ban", "site-unban"].includes(action) && !isAdmin) return json({ error: "Only a site admin can change a site-wide ban." }, 403, allowedOrigin);

    if (action === "close-report") {
      const { data: report } = await admin.from("reports").select("community_id").eq("id", targetId).maybeSingle();
      if (!report || (communityId && report.community_id !== communityId)) return json({ error: "That report is no longer available." }, 404, allowedOrigin);
      if (!isAdmin && report.community_id !== communityId) return json({ error: "That report belongs to another community." }, 403, allowedOrigin);
      const { error } = await admin.from("reports").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", targetId);
      if (error) throw new Error("report close failed");
      await audit(admin, { community_id: report.community_id, actor: user.id, action, target_type: "report", target_id: targetId, target_user: null, reason });
      return json({ ok: true }, 200, allowedOrigin);
    }

    if (action === "delete-message") {
      const { data: msg } = await admin.from("channel_messages").select("channel_id").eq("id", targetId).maybeSingle();
      const { data: channel } = msg ? await admin.from("channels").select("community_id").eq("id", msg.channel_id).maybeSingle() : { data: null };
      if (!msg || channel?.community_id !== communityId) return json({ error: "That message is no longer in this community." }, 404, allowedOrigin);
      const { error } = await admin.from("channel_messages").delete().eq("id", targetId);
      if (error) throw new Error("message delete failed");
      await audit(admin, { community_id: communityId, actor: user.id, action, target_type: "message", target_id: targetId, target_user: null, reason });
    } else if (action === "delete-emoji") {
      const { data: emoji } = await admin.from("community_emojis").select("community_id,path").eq("id", targetId).maybeSingle();
      if (!emoji || emoji.community_id !== communityId) return json({ error: "That emoji is no longer in this community." }, 404, allowedOrigin);
      const { error: storageError } = await admin.storage.from("community-emojis").remove([emoji.path]);
      if (storageError) throw new Error("emoji storage remove failed");
      const { error } = await admin.from("community_emojis").delete().eq("id", targetId);
      if (error) throw new Error("emoji metadata delete failed");
      await audit(admin, { community_id: communityId, actor: user.id, action, target_type: "emoji", target_id: targetId, target_user: null, reason });
    } else if (action === "delete-channel") {
      const { data: channel } = await admin.from("channels").select("community_id,name").eq("id", targetId).maybeSingle();
      if (!channel || channel.community_id !== communityId) return json({ error: "That channel is no longer in this community." }, 404, allowedOrigin);
      if (["general", "recommendations"].includes(channel.name)) return json({ error: "The default channels can’t be removed." }, 400, allowedOrigin);
      const { error } = await admin.from("channels").delete().eq("id", targetId);
      if (error) throw new Error("channel delete failed");
      await audit(admin, { community_id: communityId, actor: user.id, action, target_type: "channel", target_id: targetId, target_user: null, reason });
    } else if (["mute", "unmute", "remove", "ban", "unban", "promote-mod", "demote-mod", "site-ban", "site-unban"].includes(action)) {
      const targetUser = isUuid(input.target_user) ? input.target_user : null;
      if (!targetUser) return json({ error: "Choose a valid account." }, 400, allowedOrigin);
      if (targetUser === user.id && action !== "site-ban") return json({ error: "You can’t moderate your own account here." }, 400, allowedOrigin);
      const targetRole = communityId ? await roleFor(admin, targetUser, communityId) : { admin: false, role: undefined };
      if (communityId && ["mute", "remove", "ban", "promote-mod", "demote-mod"].includes(action) && !targetRole.role) return json({ error: "That account isn’t a member of this community." }, 404, allowedOrigin);
      if (targetRole.admin && !isAdmin) return json({ error: "A community moderator can’t act on a site admin." }, 403, allowedOrigin);
      if (["mute", "remove", "ban", "unmute", "unban"].includes(action) && !isAdmin && role === "mod" && targetRole.role && targetRole.role !== "member") return json({ error: "A moderator can only act on a community member." }, 403, allowedOrigin);
      if (["promote-mod", "demote-mod"].includes(action) && (role !== "owner" || targetRole.role === "owner")) return json({ error: "Only the community owner can change moderator roles." }, 403, allowedOrigin);
      if (action === "mute") {
        const minutes = Number(input.duration_minutes);
        if (!Number.isInteger(minutes) || minutes < 5 || minutes > 10080) return json({ error: "Choose a mute between 5 minutes and 7 days." }, 400, allowedOrigin);
        const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
        const { error } = await admin.from("community_mutes").upsert({ community_id: communityId, user_id: targetUser, actor: user.id, reason, expires_at: expiresAt });
        if (error) throw new Error("mute failed");
        await audit(admin, { community_id: communityId, actor: user.id, action, target_type: "user", target_id: targetUser, target_user: targetUser, reason, expires_at: expiresAt });
      } else if (action === "unmute" || action === "unban") {
        const table = action === "unmute" ? "community_mutes" : "community_bans";
        const { error } = await admin.from(table).delete().eq("community_id", communityId).eq("user_id", targetUser);
        if (error) throw new Error("community sanction removal failed");
        await audit(admin, { community_id: communityId, actor: user.id, action, target_type: "user", target_id: targetUser, target_user: targetUser, reason });
      } else if (action === "ban" || action === "remove") {
        if (action === "ban") {
          const { error } = await admin.from("community_bans").upsert({ community_id: communityId, user_id: targetUser, actor: user.id, reason });
          if (error) throw new Error("ban failed");
        }
        const { error } = await admin.from("community_members").delete().eq("community_id", communityId).eq("member_id", targetUser);
        if (error) throw new Error("member removal failed");
        await audit(admin, { community_id: communityId, actor: user.id, action, target_type: "user", target_id: targetUser, target_user: targetUser, reason });
      } else if (action === "promote-mod" || action === "demote-mod") {
        const nextRole = action === "promote-mod" ? "mod" : "member";
        const { error } = await admin.from("community_members").update({ role: nextRole }).eq("community_id", communityId).eq("member_id", targetUser).neq("role", "owner");
        if (error) throw new Error("role update failed");
        await audit(admin, { community_id: communityId, actor: user.id, action, target_type: "user", target_id: targetUser, target_user: targetUser, reason });
      } else {
        const { error } = action === "site-ban"
          ? await admin.from("site_bans").upsert({ user_id: targetUser, actor: user.id, reason })
          : await admin.from("site_bans").delete().eq("user_id", targetUser);
        if (error) throw new Error("site ban failed");
        await audit(admin, { community_id: null, actor: user.id, action, target_type: "user", target_id: targetUser, target_user: targetUser, reason });
      }
    } else if (action === "delete-community") {
      const { data: community } = await admin.from("communities").select("created_by").eq("id", communityId).maybeSingle();
      if (!isAdmin && community?.created_by !== user.id) return json({ error: "Only the community owner or a site admin can remove it." }, 403, allowedOrigin);
      const { data: emojis } = await admin.from("community_emojis").select("path").eq("community_id", communityId);
      const paths = (emojis || []).map((emoji) => emoji.path as string);
      if (paths.length) {
        const { error: storageError } = await admin.storage.from("community-emojis").remove(paths);
        if (storageError) throw new Error("community emoji cleanup failed");
      }
      const { error } = await admin.from("communities").delete().eq("id", communityId);
      if (error) throw new Error("community delete failed");
      await audit(admin, { community_id: null, actor: user.id, action, target_type: "community", target_id: communityId, target_user: null, reason });
    }
    return json({ ok: true }, 200, allowedOrigin);
  } catch {
    console.error("community-moderate could not complete a validated action.");
    return json({ error: "That moderation action couldn’t be completed just now." }, 500, allowedOrigin);
  }
});
