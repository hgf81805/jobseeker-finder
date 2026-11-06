// Supabase の REST（PostgREST）を service_role キーで呼ぶ。キーはサーバーの環境変数にだけ置く
// 貼り付け時に混ざりやすい空白・引用符・「Bearer 」や末尾の /rest/v1 を取り除く
const baseUrl = () => (process.env.SUPABASE_URL || "").trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
const key = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "");

export const dbEnabled = () => !!(baseUrl() && key());
const envDailyLimit = () => {
  const n = parseInt(process.env.DAILY_CREDIT_LIMIT || "500", 10);
  return Number.isNaN(n) ? 500 : n;
};
export const MAX_DAILY_LIMIT = 15000;

// 1日の上限：/up の画面で保存した値（app_settings）を優先し、無ければ環境変数（既定 500）
export async function dailyLimit() {
  if (!dbEnabled()) return envDailyLimit();
  try {
    const rows = await rest("app_settings?select=value&key=eq.daily_credit_limit");
    const n = rows && rows[0] ? parseInt(rows[0].value, 10) : NaN;
    return Number.isNaN(n) ? envDailyLimit() : n;
  } catch (e) {
    return envDailyLimit();
  }
}

export async function setDailyLimit(n) {
  await rest("app_settings?on_conflict=key", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: [{ key: "daily_credit_limit", value: n, updated_at: new Date().toISOString() }],
  });
}

export async function rest(path, { method = "GET", body, prefer, withCount = false } = {}) {
  // 新しい形式の secret キー（sb_secret_...）は apikey ヘッダーだけで渡す。旧形式（JWT）は Authorization にも入れる
  const headers = { apikey: key(), "Content-Type": "application/json" };
  if (key().startsWith("eyJ")) headers.Authorization = `Bearer ${key()}`;
  if (prefer) headers.Prefer = prefer;
  if (withCount) headers.Prefer = [headers.Prefer, "count=exact"].filter(Boolean).join(",");
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
  const data = text ? JSON.parse(text) : null;
  if (!withCount) return data;
  // Content-Range: 0-49/123 の最後の数が全件数
  const total = parseInt(String(r.headers.get("content-range") || "").split("/")[1], 10);
  return { data, total: Number.isNaN(total) ? (data || []).length : total };
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
