import { logAccess } from "../lib/access.mjs";
import { isLoggedIn, unauthorized, json } from "../lib/auth.mjs";
import { dbEnabled, rest } from "../lib/db.mjs";

// キーワードの成績表（Supabase の keyword_report() で集計）
export default async (req, context) => {
  if (!isLoggedIn(req)) { await logAccess(req, context, "keywords_view", false); return unauthorized(); }
  await logAccess(req, context, "keywords_view");
  if (!dbEnabled()) return json(503, { error: "no_db", message: "データベースが設定されていません。" });
  try {
    const rows = await rest("rpc/keyword_report", { method: "POST", body: {} });
    return json(200, { rows: rows || [] });
  } catch (e) {
    return json(502, { error: "db_error", message: "成績表を読み込めませんでした。" });
  }
};

export const config = { path: "/api/keywords" };
