// Supabase の REST（PostgREST）を service_role キーで呼ぶ。キーはサーバーの環境変数にだけ置く
const baseUrl = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const dbEnabled = () => !!(baseUrl() && key());
export const dailyLimit = () => {
  const n = parseInt(process.env.DAILY_CREDIT_LIMIT || "500", 10);
  return Number.isNaN(n) ? 500 : n;
};

export async function rest(path, { method = "GET", body, prefer } = {}) {
  const headers = { apikey: key(), Authorization: `Bearer ${key()}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${baseUrl()}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) {
    const e = new Error(`db ${r.status}: ${text.slice(0, 200)}`);
    e.code = "db_error";
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
