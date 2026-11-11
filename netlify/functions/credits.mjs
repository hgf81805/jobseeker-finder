import { isLoggedIn, unauthorized, json } from "../lib/auth.mjs";
import { dbEnabled, rest, dailyLimit } from "../lib/db.mjs";

// 日ごと（日本時間）のクレジット使用量（Supabase の credit_daily() で集計）
export default async (req) => {
  if (!isLoggedIn(req)) return unauthorized();
  if (!dbEnabled()) return json(503, { error: "no_db", message: "データベースが設定されていません。" });
  try {
    const days = await rest("rpc/credit_daily", { method: "POST", body: {} });
    return json(200, { days: days || [], limit: await dailyLimit() });
  } catch (e) {
    return json(502, { error: "db_error", message: "使用量を読み込めませんでした。" });
  }
};

export const config = { path: "/api/credits" };
