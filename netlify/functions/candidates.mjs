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
      const filter = status === "not_vendor" ? "&status=neq.vendor" : STATUSES.includes(status) ? `&status=eq.${status}` : "";
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
      const [before] = patch.status !== undefined ? await rest(`candidates?select=status&code=eq.${code}`) : [];
      const [row] = await rest(`candidates?code=eq.${code}`, { method: "PATCH", prefer: "return=representation", body: patch });
      if (row && row.username) {
        const who = encodeURIComponent(row.username);
        if (patch.status === "vendor") {
          // 業者マーク：この投稿者の他の投稿も、次の検索から外す
          await rest(`authors?username=eq.${who}`, { method: "PATCH", prefer: "return=minimal", body: { is_vendor: true } });
        } else if (patch.status === "contacted") {
          await rest(`authors?username=eq.${who}`, { method: "PATCH", prefer: "return=minimal", body: { last_contacted_at: patch.updated_at } });
        } else if (patch.status !== undefined && before && before.status === "vendor") {
          // 業者マークの取り消し：投稿者の業者フラグと、覚えていた「業者」の投稿を解除する
          await rest(`authors?username=eq.${who}`, { method: "PATCH", prefer: "return=minimal", body: { is_vendor: false } });
          await rest(`skipped_posts?username=eq.${who}&reason=eq.vendor`, { method: "DELETE", prefer: "return=minimal" });
        }
      }
      return json(200, { item: row || null });
    }
    return json(405, { error: "method_not_allowed" });
  } catch (e) {
    const hint = e.status === 401 || e.status === 403 ? "（Supabase のキーが正しくない可能性があります。service_role／secret キーか確認してください）"
      : e.status === 404 ? "（SUPABASE_URL かテーブルの作成を確認してください）" : "";
    return json(502, { error: "db_error", message: `データベースの読み書きに失敗しました。${hint} 詳細：${e.detail || e.message}` });
  }
};

export const config = { path: "/api/candidates" };
