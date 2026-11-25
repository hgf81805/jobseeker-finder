import { logAccess } from "../lib/access.mjs";
import { checkCredentials, sessionCookie, json, readJson } from "../lib/auth.mjs";

export default async (req, context) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const { email, password, keep } = await readJson(req);
  const owner = checkCredentials(email || "", password || "");
  if (!owner) {
    await logAccess(req, context, "login", false);
    await new Promise(r => setTimeout(r, 600));
    return json(401, { error: "invalid", message: "メールアドレスかパスワードが違います。" });
  }
  await logAccess(req, context, "login", true, owner);
  return json(200, { ok: true }, { "Set-Cookie": sessionCookie(!!keep, owner) });
};

export const config = { path: "/api/login" };
