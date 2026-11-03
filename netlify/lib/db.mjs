// Supabase の REST（PostgREST）を service_role キーで呼ぶ。キーはサーバーの環境変数にだけ置く
// 貼り付け時に混ざりやすい空白・引用符・「Bearer 」や末尾の /rest/v1 を取り除く
const baseUrl = () => (process.env.SUPABASE_URL || "").trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
const key = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "");

export const dbEnabled = () => !!(baseUrl() && key());
export const dailyLimit = () => {
  const n = parseInt(process.env.DAILY_CREDIT_LIMIT || "500", 10);
  return Number.isNaN(n) ? 500 : n;
};

export async function rest(path, { method = "GET", body, prefer } = {}) {
  // 新しい形式の secret キー（sb_secret_...）は apikey ヘッダーだけで渡す。旧形式（JWT）は Authorization にも入れる
  const headers = { apikey: key(), "Content-Type": "application/json" };
  if (key().startsWith("eyJ")) headers.Authorization = `Bearer ${key()}`;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${baseUrl()}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) {
    let detail = "";
    try { const b = JSON.parse(text); detail = [b.code, b.message || b.msg || b.error].filter(Boolean).join(" "); } catch (e) { detail = text.slice(0, 120); }
    const e = new Error(`db ${r.status}: ${detail}`);
    e.code = "db_error";
    e.status = r.status;
    e.detail = `${r.status} ${detail}`.slice(0, 200);
    throw e;
  }
  return text ? JSON.parse(text) : null;
}

// PostgREST の in.() 用に値を引用符で囲む
export const inList = values => `(${values.map(v => `"${String(v).replace(/["\\]/g, "")}"`).join(",")})`;

// 日本時間の今日の0時（UTC表記）
function jstMidnightIso() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600 * 1000);
  jst.setUTCHours(0, 0, 0, 0);
  return new Date(jst.getTime() - 9 * 3600 * 1000).toISOString();
}

export async function creditsUsedToday() {
  const rows = await rest(`usage_log?select=credits&at=gte.${encodeURIComponent(jstMidnightIso())}`);
  return (rows || []).reduce((sum, r) => sum + (r.credits || 0), 0);
}

export async function logUsage(kind, credits) {
  if (!credits) return;
  await rest("usage_log", { method: "POST", body: { kind, credits }, prefer: "return=minimal" });
}
