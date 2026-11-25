import { logAccess } from "../lib/access.mjs";
import { currentUser, unauthorized, json, readJson } from "../lib/auth.mjs";
import { throkGet, throkError } from "../lib/throk.mjs";
import { overBudget, recordUsage } from "../lib/budget.mjs";
import { dbEnabled, rest } from "../lib/db.mjs";

// POST { username, refresh? }：投稿者のプロフィール（自己紹介・リンク・フォロワー数）
// 保存済みならクレジットを使わずに返し、無ければ throk から取る（1クレジット）
export default async (req, context) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const owner = currentUser(req);
  if (!owner) { await logAccess(req, context, "profile", false); return unauthorized(); }
  const body = await readJson(req);
  const username = String(body.username || "");
  if (!/^[A-Za-z0-9._]{1,40}$/.test(username)) return json(400, { error: "bad_request", message: "ユーザー名が正しくありません。" });
  const who = encodeURIComponent(username);
  await logAccess(req, context, "profile");

  if (dbEnabled() && !body.refresh) {
    try {
      const [row] = await rest(`authors?select=username,full_name,biography,bio_links,follower_count,profile_checked_at&owner=eq.${owner}&username=eq.${who}`);
      if (row && row.profile_checked_at) return json(200, { profile: row, cached: true });
    } catch (e) {}
  }
  const blocked = await overBudget(1);
  if (blocked) return blocked;
  try {
    const data = await throkGet(`/user/${who}`, { num_threads: 0, num_replies: 0 });
    await recordUsage("live", data, owner);
    const u = data.user || {};
    const profile = {
      owner, username, full_name: u.full_name || null, biography: u.biography || null,
      bio_links: u.bio_links ?? null, follower_count: Number.isFinite(u.follower_count) ? u.follower_count : null,
      profile_checked_at: new Date().toISOString(),
    };
    if (dbEnabled()) {
      try { await rest("authors?on_conflict=owner,username", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: [profile] }); } catch (e) {}
    }
    const { owner: _o, ...pub } = profile;
    return json(200, { profile: pub, cached: false });
  } catch (e) {
    return throkError(e);
  }
};

export const config = { path: "/api/profile" };
