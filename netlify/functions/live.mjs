import { logAccess } from "../lib/access.mjs";
import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { throkGet, throkError } from "../lib/throk.mjs";
import { overBudget, recordUsage } from "../lib/budget.mjs";
import { dbEnabled, rest } from "../lib/db.mjs";

export default async (req, context) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!isLoggedIn(req)) { await logAccess(req, context, "live_check", false); return unauthorized(); }
  const body = await readJson(req);
  const codes = (Array.isArray(body.codes) ? body.codes : [])
    .map(c => String(c).trim()).filter(c => /^[A-Za-z0-9_-]{5,20}$/.test(c)).slice(0, 10);
  if (!codes.length) return json(400, { error: "bad_request", message: "投稿コードがありません。" });
  await logAccess(req, context, "live_check");
  const blocked = await overBudget(codes.length * 3);
  if (blocked) return blocked;
  try {
    const data = await throkGet("/live/posts", { codes });
    await recordUsage("live", data);
    const gone = (data.content || []).filter(r => r && r.success === false && r.post_code).map(r => ({ code: String(r.post_code), reason: "deleted" }));
    if (gone.length && dbEnabled()) {
      try { await rest("skipped_posts?on_conflict=code", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: gone }); } catch (e) {}
    }
    return json(200, data);
  } catch (e) {
    return throkError(e);
  }
};

export const config = { path: "/api/live" };
