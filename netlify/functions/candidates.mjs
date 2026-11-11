import { logAccess } from "../lib/access.mjs";
import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { dbEnabled, rest } from "../lib/db.mjs";

const STATUSES = ["new", "contacted", "replied", "meeting", "won", "skip", "vendor"];

// GET：候補一覧（?status= で絞り込み）／PATCH：進み具合とメモの更新
// POST：除外した投稿に印を付ける（候補一覧に無ければ投稿ごと登録、status "none" で登録を取り消す）
export default async (req, context) => {
  if (!isLoggedIn(req)) { await logAccess(req, context, "list", false); return unauthorized(); }
  if (!dbEnabled()) return json(503, { error: "no_db", message: "データベースが設定されていません。" });
  try {
    await logAccess(req, context, req.method === "GET" ? "list" : "mark");
    if (req.method === "GET") {
      const status = new URL(req.url).searchParams.get("status");
      const filter = status === "not_vendor" ? "&status=not.in.(vendor,contacted,skip)" : STATUSES.includes(status) ? `&status=eq.${status}` : "";
      // つぶやいた時間の新しい順に、50件ずつ
      const PER_PAGE = 50;
      const page = Math.max(1, parseInt(new URL(req.url).searchParams.get("page"), 10) || 1);
      const { data, total } = await rest(
        `candidates?select=code,url,caption,posted_at,username,found_at,status,contacted_at,note,reply_count,like_count,authors(full_name,biography,bio_links,follower_count,profile_checked_at)&order=posted_at.desc.nullslast,found_at.desc&limit=${PER_PAGE}&offset=${(page - 1) * PER_PAGE}${filter}`,
        { withCount: true });
      return json(200, { items: data || [], total, page, perPage: PER_PAGE });
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
    if (req.method === "POST") {
      const body = await readJson(req);
      const post = body.post || {};
      const code = String(post.code || "");
      if (!/^[A-Za-z0-9_-]{5,20}$/.test(code)) return json(400, { error: "bad_request", message: "投稿コードが正しくありません。" });
      const username = /^[A-Za-z0-9._]{1,40}$/.test(String(post.username || "")) ? String(post.username) : null;
      const [before] = await rest(`candidates?select=status,username&code=eq.${code}`);
      if (body.status === "none") {
        if (before) await rest(`candidates?code=eq.${code}`, { method: "DELETE", prefer: "return=minimal" });
        const who = (before && before.username) || username;
        if (before && before.status === "vendor" && who) {
          await rest(`authors?username=eq.${encodeURIComponent(who)}`, { method: "PATCH", prefer: "return=minimal", body: { is_vendor: false } });
        }
        return json(200, { item: null });
      }
      if (!["skip", "vendor"].includes(body.status)) return json(400, { error: "bad_request", message: "印の値が正しくありません。" });
      if (username) {
        await rest("authors?on_conflict=username", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: [{ username, full_name: post.full_name ? String(post.full_name) : null }] });
      }
      const url = /^https:\/\/(www\.)?threads\.(com|net)\//.test(String(post.url || "")) ? String(post.url) : `https://www.threads.com/t/${code}`;
      const ts = parseInt(post.posted_at, 10);
      const [row] = await rest("candidates?on_conflict=code", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: [{
          code, url, caption: post.caption ? String(post.caption).slice(0, 2000) : null,
          posted_at: Number.isNaN(ts) ? null : new Date(ts * 1000).toISOString(),
          username: username || (before && before.username) || null,
          status: body.status, updated_at: new Date().toISOString(),
          ...(post.reply_count != null ? { reply_count: post.reply_count != null && Number.isFinite(Number(post.reply_count)) ? Math.max(0, Math.round(Number(post.reply_count))) : null } : {}),
          ...(post.like_count != null ? { like_count: post.like_count != null && Number.isFinite(Number(post.like_count)) ? Math.max(0, Math.round(Number(post.like_count))) : null } : {}),
        }],
      });
      const who = (row && row.username) || null;
      if (who && body.status === "vendor") {
        await rest(`authors?username=eq.${encodeURIComponent(who)}`, { method: "PATCH", prefer: "return=minimal", body: { is_vendor: true } });
      } else if (who && before && before.status === "vendor") {
        await rest(`authors?username=eq.${encodeURIComponent(who)}`, { method: "PATCH", prefer: "return=minimal", body: { is_vendor: false } });
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
