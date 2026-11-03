import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { throkGet, throkError } from "../lib/throk.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!isLoggedIn(req)) return unauthorized();
  const body = await readJson(req);
  const codes = (Array.isArray(body.codes) ? body.codes : [])
    .map(c => String(c).trim()).filter(c => /^[A-Za-z0-9_-]{5,20}$/.test(c)).slice(0, 10);
  if (!codes.length) return json(400, { error: "bad_request", message: "投稿コードがありません。" });
  try {
    return json(200, await throkGet("/live/posts", { codes }));
  } catch (e) {
    return throkError(e);
  }
};

export const config = { path: "/api/live" };
