import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { dbEnabled, rest } from "../lib/db.mjs";

const int = v => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);

// 検索1回分の履歴と、表示した投稿を候補として保存する
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!isLoggedIn(req)) return unauthorized();
  if (!dbEnabled()) return json(200, { saved: false });
  const { search = {}, items = [] } = await readJson(req);
  try {
    const [row] = await rest("searches", {
      method: "POST",
      prefer: "return=representation",
      body: {
        keywords: (Array.isArray(search.keywords) ? search.keywords : []).map(String).slice(0, 30),
        days: int(search.days), max_replies: int(search.maxReplies),
        fetched: int(search.fetched), shown: int(search.shown), excluded: int(search.excluded), credits: int(search.credits),
      },
    });
    const posts = (Array.isArray(items) ? items : []).slice(0, 10)
      .filter(i => i && /^[A-Za-z0-9_-]{5,20}$/.test(String(i.code)) && /^https:\/\/(www\.)?threads\.(com|net)\//.test(String(i.url)));
    const authors = [...new Map(posts.filter(p => p.username).map(p => [p.username, { username: String(p.username), full_name: p.full_name ? String(p.full_name) : null }])).values()];
    if (authors.length) await rest("authors?on_conflict=username", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: authors });
    if (posts.length) {
      await rest("candidates?on_conflict=code", {
        method: "POST",
        prefer: "resolution=ignore-duplicates,return=minimal",
        body: posts.map(p => ({
          code: String(p.code), url: String(p.url), caption: p.caption ? String(p.caption).slice(0, 2000) : null,
          posted_at: p.posted_at ? new Date(int(p.posted_at) * 1000).toISOString() : null,
          username: p.username ? String(p.username) : null, search_id: row.id,
        })),
      });
    }
    return json(200, { saved: true });
  } catch (e) {
    return json(200, { saved: false });
  }
};

export const config = { path: "/api/record" };
