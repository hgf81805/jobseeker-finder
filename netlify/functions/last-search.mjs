import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { dbEnabled, rest } from "../lib/db.mjs";

// 同じキーワードで最後に検索した日時を返す（前回より新しい投稿だけを取るため）
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!isLoggedIn(req)) return unauthorized();
  if (!dbEnabled()) return json(200, { at: null });
  const body = await readJson(req);
  const keywords = (Array.isArray(body.keywords) ? body.keywords : []).map(k => String(k).trim()).filter(Boolean).slice(0, 30).sort();
  if (!keywords.length) return json(200, { at: null });
  // PostgreSQL の配列リテラル {"a","b"}
  const literal = `{${keywords.map(k => `"${k.replace(/["\\]/g, "")}"`).join(",")}}`;
  try {
    const rows = await rest(`searches?select=created_at&keywords=eq.${encodeURIComponent(literal)}&order=created_at.desc&limit=1`);
    return json(200, { at: rows && rows[0] ? rows[0].created_at : null });
  } catch (e) {
    return json(200, { at: null });
  }
};

export const config = { path: "/api/last-search" };
