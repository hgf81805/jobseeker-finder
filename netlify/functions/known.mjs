import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { dbEnabled, rest, inList } from "../lib/db.mjs";

// 登録済みの投稿と、業者と分かっている投稿者を返す（存在確認の前に外してクレジットを節約する）
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!isLoggedIn(req)) return unauthorized();
  if (!dbEnabled()) return json(200, { enabled: false, codes: {}, vendors: [] });
  const body = await readJson(req);
  const codes = (Array.isArray(body.codes) ? body.codes : []).map(String).filter(c => /^[A-Za-z0-9_-]{5,20}$/.test(c)).slice(0, 100);
  const usernames = (Array.isArray(body.usernames) ? body.usernames : []).map(String).filter(u => /^[A-Za-z0-9._]{1,40}$/.test(u)).slice(0, 100);
  try {
    const known = codes.length ? await rest(`candidates?select=code,status&code=in.${encodeURIComponent(inList(codes))}`) : [];
    const vendors = usernames.length ? await rest(`authors?select=username&is_vendor=eq.true&username=in.${encodeURIComponent(inList(usernames))}`) : [];
    return json(200, {
      enabled: true,
      codes: Object.fromEntries((known || []).map(r => [r.code, r.status])),
      vendors: (vendors || []).map(r => r.username),
    });
  } catch (e) {
    return json(200, { enabled: false, codes: {}, vendors: [] });
  }
};

export const config = { path: "/api/known" };
