import { dbEnabled, rest } from "./db.mjs";

// アクセス記録：日時・IPアドレス・操作・成否・ブラウザ。90日より古い記録はときどき消す
export function clientIp(req, context) {
  if (context && context.ip) return String(context.ip);
  const h = req.headers;
  return (h.get("x-nf-client-connection-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || "").trim() || null;
}

export async function logAccess(req, context, action, ok = true) {
  if (!dbEnabled()) return;
  try {
    await rest("access_log", {
      method: "POST",
      prefer: "return=minimal",
      body: { ip: clientIp(req, context), action, ok, user_agent: (req.headers.get("user-agent") || "").slice(0, 300) },
    });
    if (Math.random() < 0.02) await rest("rpc/access_purge", { method: "POST", body: {} });
  } catch (e) {}
}
