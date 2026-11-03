import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { throkGet, throkError } from "../lib/throk.mjs";

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
  try {
    return json(200, await throkGet("/post/search", {
      keywords,
      language: "ja",
      post_type: body.threadOnly === false ? "all" : "thread",
      max_age_hours: clamp(body.days, 1, 7, 5) * 24,
      sort: "replies:asc",
      size: clamp(body.size, 1, 100, 50),
      page: clamp(body.page, 1, 20, 1),
      include_details: true,
    }));
  } catch (e) {
    return throkError(e);
  }
};

export const config = { path: "/api/search" };
