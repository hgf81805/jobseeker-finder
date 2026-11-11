import { logAccess } from "../lib/access.mjs";
import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { dbEnabled, rest } from "../lib/db.mjs";

const COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"];
const cleanName = v => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
const validId = v => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };
const validCode = v => /^[A-Za-z0-9_-]{5,20}$/.test(String(v || ""));

// GET：ラベルの一覧（付いている候補の数つき）
// POST {name, color}：作る ／ PATCH {id, name?, color?}：名前・色を変える ／ DELETE ?id=：消す（付けた印も外れる）
// POST {action:"assign", code, label_id, on}：候補にラベルを付ける・外す
export default async (req, context) => {
  if (!isLoggedIn(req)) { await logAccess(req, context, "labels", false); return unauthorized(); }
  if (!dbEnabled()) return json(503, { error: "no_db", message: "データベースが設定されていません。" });
  try {
    if (req.method === "GET") {
      const [labels, links] = await Promise.all([
        rest("labels?select=id,name,color,created_at&order=created_at.asc"),
        rest("candidate_labels?select=label_id&limit=100000"),
      ]);
      const counts = {};
      for (const l of links || []) counts[l.label_id] = (counts[l.label_id] || 0) + 1;
      return json(200, { labels: (labels || []).map(l => ({ ...l, count: counts[l.id] || 0 })), colors: COLORS });
    }
    await logAccess(req, context, "labels");
    if (req.method === "POST") {
      const body = await readJson(req);
      if (body.action === "assign") {
        const id = validId(body.label_id);
        if (!id || !validCode(body.code)) return json(400, { error: "bad_request", message: "ラベルか投稿の指定が正しくありません。" });
        if (body.on) {
          await rest("candidate_labels?on_conflict=code,label_id", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal", body: [{ code: body.code, label_id: id }] });
        } else {
          await rest(`candidate_labels?code=eq.${body.code}&label_id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
        }
        return json(200, { ok: true });
      }
      const name = cleanName(body.name);
      if (!name) return json(400, { error: "bad_request", message: "ラベルの名前を入れてください。" });
      const color = COLORS.includes(body.color) ? body.color : "gray";
      const dup = await rest(`labels?select=id&name=eq.${encodeURIComponent(name)}`);
      if (dup && dup.length) return json(409, { error: "duplicate", message: "同じ名前のラベルがあります。" });
      const [row] = await rest("labels", { method: "POST", prefer: "return=representation", body: [{ name, color }] });
      return json(200, { label: { ...row, count: 0 } });
    }
    if (req.method === "PATCH") {
      const body = await readJson(req);
      const id = validId(body.id);
      if (!id) return json(400, { error: "bad_request", message: "ラベルの指定が正しくありません。" });
      const patch = {};
      if (body.name !== undefined) {
        patch.name = cleanName(body.name);
        if (!patch.name) return json(400, { error: "bad_request", message: "ラベルの名前を入れてください。" });
        const dup = await rest(`labels?select=id&name=eq.${encodeURIComponent(patch.name)}&id=neq.${id}`);
        if (dup && dup.length) return json(409, { error: "duplicate", message: "同じ名前のラベルがあります。" });
      }
      if (body.color !== undefined) {
        if (!COLORS.includes(body.color)) return json(400, { error: "bad_request", message: "色の指定が正しくありません。" });
        patch.color = body.color;
      }
      const [row] = await rest(`labels?id=eq.${id}`, { method: "PATCH", prefer: "return=representation", body: patch });
      return json(200, { label: row || null });
    }
    if (req.method === "DELETE") {
      const id = validId(new URL(req.url).searchParams.get("id"));
      if (!id) return json(400, { error: "bad_request", message: "ラベルの指定が正しくありません。" });
      await rest(`labels?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
      return json(200, { ok: true });
    }
    return json(405, { error: "method_not_allowed" });
  } catch (e) {
    return json(502, { error: "db_error", message: `ラベルを保存できませんでした。詳細：${e.detail || e.message}` });
  }
};

export const config = { path: "/api/labels" };
