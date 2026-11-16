import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { dbEnabled, rest } from "../lib/db.mjs";
import { logAccess } from "../lib/access.mjs";

// GET：アクセス記録の新しい順の一覧（最大500件）、IPアドレスごとのまとめ、登録した利用者名
// POST {ip, name}：IPアドレスに利用者名を登録する（name を空にすると登録を消す）
export default async (req, context) => {
  if (!isLoggedIn(req)) { await logAccess(req, context, "access_view", false); return unauthorized(); }
  if (!dbEnabled()) return json(503, { error: "no_db", message: "データベースが設定されていません。" });
  if (req.method === "POST") {
    const body = await readJson(req);
    const ip = String(body.ip || "").trim();
    if (!/^[0-9A-Fa-f:.]{3,45}$/.test(ip)) return json(400, { error: "bad_request", message: "IPアドレスが正しくありません。" });
    const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    await logAccess(req, context, "ip_name");
    try {
      if (name) {
        await rest("ip_names?on_conflict=ip", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: [{ ip, name, updated_at: new Date().toISOString() }] });
      } else {
        await rest(`ip_names?ip=eq.${encodeURIComponent(ip)}`, { method: "DELETE", prefer: "return=minimal" });
      }
      return json(200, { ip, name });
    } catch (e) {
      return json(502, { error: "db_error", message: "利用者名を保存できませんでした。" });
    }
  }
  await logAccess(req, context, "access_view");
  try {
    const [rows, summary, names] = await Promise.all([
      rest("access_log?select=at,ip,action,ok,user_agent&order=at.desc&limit=500"),
      rest("rpc/access_summary", { method: "POST", body: {} }),
      rest("ip_names?select=ip,name"),
    ]);
    const nameMap = Object.fromEntries((names || []).map(n => [n.ip, n.name]));
    return json(200, { rows: rows || [], summary: summary || [], names: nameMap });
  } catch (e) {
    return json(502, { error: "db_error", message: "アクセス記録を読み込めませんでした。" });
  }
};

export const config = { path: "/api/access" };
