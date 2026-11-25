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

const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

// ログインできるアカウント。データ（候補・検索履歴・ラベル・印・AI読み取りなど）は id ごとに分かれる
// main：メールアドレスとパスワードの組を、ソルト付きハッシュ（LOGIN_HASH）とだけ照合する（管理ページも開ける）
// hgf ：メールアドレスはハッシュで照合し、パスワードは Netlify の環境変数 LOGIN2_PASSWORD と照合する
export const ACCOUNTS = {
  main: { name: "メインアカウント", admin: true },
  hgf: { name: "サブアカウント", admin: false },
};

export function checkCredentials(email, password) {
  const mail = String(email).trim().toLowerCase();
  const expected = process.env.LOGIN_HASH || "";
  const salt = process.env.LOGIN_SALT || "jf-login-v1";
  if (expected && safeEqual(sha256(`${salt}|${mail}|${String(password)}`), expected)) return "main";
  const pw2 = process.env.LOGIN2_PASSWORD || "";
  if (pw2.length >= 8 && safeEqual(sha256(`jf-account-v1|${mail}`), "54f7a83d1eef114be88e4e8a153d04a133bdc2afb73901b493a54674aaf57e7d")
    && safeEqual(sha256(String(password)), sha256(pw2))) return "hgf";
  return null;
}

export function sessionCookie(keep, owner) {
  const maxAge = keep ? LONG_SEC : SHORT_SEC;
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const payload = `${owner}.${exp}`;
  const parts = [`${COOKIE}=${payload}.${sign(payload)}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
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

// ログイン中のアカウントの id（main / hgf）。ログインしていなければ null
// 複数アカウントにする前のクッキー（期限.署名）は main として扱う
export function currentUser(req) {
  const token = readCookie(req);
  if (!token) return null;
  const parts = token.split(".");
  let owner, exp, sig, payload;
  if (parts.length === 2) { [exp, sig] = parts; owner = "main"; payload = exp; }
  else if (parts.length === 3) { [owner, exp, sig] = parts; payload = `${owner}.${exp}`; }
  else return null;
  if (!ACCOUNTS[owner] || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  try { return safeEqual(sig, sign(payload)) ? owner : null; } catch (e) { return null; }
}
export const isLoggedIn = req => !!currentUser(req);
export const isAdmin = req => { const o = currentUser(req); return !!(o && ACCOUNTS[o].admin); };

export const unauthorized = () => json(401, { error: "unauthorized", message: "ログインしてください。" });
export const forbidden = () => json(403, { error: "forbidden", message: "このページはメインアカウントだけが開けます。" });

export async function readJson(req) {
  try { return await req.json(); } catch (e) { return {}; }
}
