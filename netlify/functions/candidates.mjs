import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { dbEnabled, rest } from "../lib/db.mjs";

const STATUSES = ["new", "contacted", "replied", "meeting", "won", "skip", "vendor"];

// GET：候補一覧（?status= で絞り込み）／PATCH：進み具合とメモの更新
export default async (req) => {
  if (!isLoggedIn(req)) return unauthorized();
  if (!dbEnabled()) return json(503, { error: "no_db", message: "データベースが設定されていません。" });
  try {
    if (req.method === "GET") {
      const status = new URL(req.url).searchParams.get("status");
      const filter = STATUSES.includes(status) ? `&status=eq.${status}` : "";
      const rows = await rest(`candidates?select=code,url,caption,posted_at,username,found_at,status,contacted_at,note,authors(full_name)&order=found_at.desc&limit=200${filter}`);
      return json(200, { items: rows || [] });
    }
    if (req.method === "PATCH") {
      const body = await readJson(req);
      const code = String(body.code || "");
      if (!/^[A-Za-z0-9_-]{5,20}$/.test(code)) return json(400, { error: "bad_request", message: "投稿コードが正しくありません。" });
      const patch = { updated_at: new Date().toISOString() };
      if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) return json(400, { error: "bad_request", message: "進み具合の値が正しくありません。" });
        patch.status = body.status;
        if (body.status === "contacted") patch.contacted_at = patch.updated_at;
      }
      if (body.note !== undefined) patch.note = String(body.note).slice(0, 1000);
      const [row] = await rest(`candidates?code=eq.${code}`, { method: "PATCH", prefer: "return=representation", body: patch });
      if (row && row.username && (patch.status === "vendor" || patch.status === "contacted")) {
        const authorPatch = patch.status === "vendor" ? { is_vendor: true } : { last_contacted_at: patch.updated_at };
        await rest(`authors?username=eq.${encodeURIComponent(row.username)}`, { method: "PATCH", prefer: "return=minimal", body: authorPatch });
      }
      return json(200, { item: row || null });
    }
    return json(405, { error: "method_not_allowed" });
  } catch (e) {
    return json(502, { error: "db_error", message: "データベースの読み書きに失敗しました。" });
  }
};

export const config = { path: "/api/candidates" };
