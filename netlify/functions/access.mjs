import { isLoggedIn, unauthorized, json } from "../lib/auth.mjs";
import { dbEnabled, rest } from "../lib/db.mjs";
import { logAccess } from "../lib/access.mjs";

// アクセス記録：新しい順の一覧（最大500件）と、IPアドレスごとのまとめ
export default async (req, context) => {
  if (!isLoggedIn(req)) { await logAccess(req, context, "access_view", false); return unauthorized(); }
  if (!dbEnabled()) return json(503, { error: "no_db", message: "データベースが設定されていません。" });
  await logAccess(req, context, "access_view");
  try {
    const [rows, summary] = await Promise.all([
      rest("access_log?select=at,ip,action,ok,user_agent&order=at.desc&limit=500"),
      rest("rpc/access_summary", { method: "POST", body: {} }),
    ]);
    return json(200, { rows: rows || [], summary: summary || [] });
  } catch (e) {
    return json(502, { error: "db_error", message: "アクセス記録を読み込めませんでした。" });
  }
};

export const config = { path: "/api/access" };
