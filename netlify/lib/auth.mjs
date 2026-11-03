import crypto from "node:crypto";

const COOKIE = "jf_session";
const LONG_SEC = 60 * 60 * 24 * 30;
const SHORT_SEC = 60 * 60 * 12;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

// メールアドレスとパスワードの組は、ソルト付きハッシュ（LOGIN_HASH）とだけ照合する
export function checkCredentials(email, password) {
  const expected = process.env.LOGIN_HASH || "";
  const salt = process.env.LOGIN_SALT || "jf-login-v1";
  const got = crypto.createHash("sha256")
    .update(`${salt}|${String(email).trim().toLowerCase()}|${String(password)}`)
    .digest("hex");
  return expected.length > 0 && safeEqual(got, expected);
}

export function sessionCookie(keep) {
  const maxAge = keep ? LONG_SEC : SHORT_SEC;
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const parts = [`${COOKIE}=${exp}.${sign(String(exp))}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
  if (keep) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

export const clearedCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readCookie(req) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
}

export function isLoggedIn(req) {
  const token = readCookie(req);
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  try { return safeEqual(sig, sign(exp)); } catch (e) { return false; }
}

export const unauthorized = () => json(401, { error: "unauthorized", message: "ログインしてください。" });

export async function readJson(req) {
  try { return await req.json(); } catch (e) { return {}; }
}
