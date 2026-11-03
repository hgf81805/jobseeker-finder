import { checkCredentials, sessionCookie, json, readJson } from "../lib/auth.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const { email, password, keep } = await readJson(req);
  if (!checkCredentials(email || "", password || "")) {
    await new Promise(r => setTimeout(r, 600));
    return json(401, { error: "invalid", message: "メールアドレスかパスワードが違います。" });
  }
  return json(200, { ok: true }, { "Set-Cookie": sessionCookie(!!keep) });
};

export const config = { path: "/api/login" };
