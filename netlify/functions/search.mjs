import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { throkGet, throkError } from "../lib/throk.mjs";
import { overBudget, recordUsage } from "../lib/budget.mjs";

const clamp = (v, min, max, d) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? d : Math.min(max, Math.max(min, n));
};

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!isLoggedIn(req)) return unauthorized();
  const body = await readJson(req);
  const keywords = (Array.isArray(body.keywords) ? body.keywords : [])
    .map(k => String(k).trim()).filter(Boolean).slice(0, 30);
  if (!keywords.length) return json(400, { error: "bad_request", message: "キーワードを1つ以上入れてください。" });
  const size = clamp(body.size, 1, 30, 30);
  // 期間の始まり。前回の検索日時（since）が期間内なら、そこから後だけを取る
  const days = clamp(body.days, 1, 7, 5);
  const windowStart = Math.floor(Date.now() / 1000) - days * 24 * 3600;
  const since = parseInt(body.since, 10);
  const from = Number.isNaN(since) ? windowStart : Math.max(windowStart, since);
  const details = body.details === true;
  const blocked = await overBudget(size * (details ? 2 : 1));
  if (blocked) return blocked;
  try {
    const data = await throkGet("/post/search", {
      keywords,
      language: "ja",
      post_type: "thread", // 返信は除き、元投稿だけ（常に）
      from_timestamp: from,
      sort: "replies:asc",
      size,
      page: clamp(body.page, 1, 3, 1),
      include_details: details,
    });
    await recordUsage("search", data);
    return json(200, data);
  } catch (e) {
    return throkError(e);
  }
};

export const config = { path: "/api/search" };
