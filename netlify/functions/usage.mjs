import { logAccess } from "../lib/access.mjs";
import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { dbEnabled, dailyLimit, setDailyLimit, creditsUsedToday, MAX_DAILY_LIMIT } from "../lib/db.mjs";

// GET：今日（日本時間）使ったクレジットと1日の上限／POST：1日の上限を変える（/up の画面から）
export default async (req, context) => {
  if (!isLoggedIn(req)) return unauthorized();
  if (req.method === "POST") {
    await logAccess(req, context, "limit_change");
    if (!dbEnabled()) return json(503, { error: "no_db", message: "データベースが設定されていないため、上限を保存できません。" });
    const body = await readJson(req);
    const n = parseInt(body.limit, 10);
    if (Number.isNaN(n) || n < 0 || n > MAX_DAILY_LIMIT) {
      return json(400, { error: "bad_request", message: `上限は 0〜${MAX_DAILY_LIMIT.toLocaleString()} の数字で入れてください。` });
    }
    try { await setDailyLimit(n); } catch (e) { return json(502, { error: "db_error", message: "上限を保存できませんでした。" }); }
  }
  const limit = await dailyLimit();
  if (!dbEnabled()) return json(200, { used: null, limit });
  try {
    return json(200, { used: await creditsUsedToday(), limit });
  } catch (e) {
    return json(200, { used: null, limit });
  }
};

export const config = { path: "/api/usage" };
