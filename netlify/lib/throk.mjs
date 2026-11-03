import { json } from "./auth.mjs";

const BASE = "https://premium-api.throk.ai";

export async function throkGet(path, params) {
  const key = process.env.THROK_API_KEY;
  if (!key) {
    const e = new Error("THROK_API_KEY is not set");
    e.code = "no_key";
    throw e;
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach(x => qs.append(k, x));
    else qs.append(k, String(v));
  }
  const r = await fetch(`${BASE}${path}?${qs}`, { headers: { Authorization: `Bearer ${key}` } });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { body = { message: text.slice(0, 300) }; }
  if (!r.ok) {
    const e = new Error((body && (body.detail || body.message)) || `throk ${r.status}`);
    e.code = r.status === 401 || r.status === 403 ? "bad_key" : r.status === 402 ? "no_credits" : "upstream_error";
    throw e;
  }
  return body;
}

export function throkError(e) {
  const status = e.code === "no_key" ? 503 : e.code === "no_credits" ? 402 : 502;
  const messages = {
    no_key: "検索用の APIキーがサーバーに設定されていません。",
    bad_key: "検索用の APIキーが正しくないか、無効になっています。",
    no_credits: "検索用のクレジットが足りません。",
  };
  return json(status, { error: e.code || "upstream_error", message: messages[e.code] || "検索サービスがエラーを返しました。時間をおいてもう一度お試しください。" });
}
