import { logAccess } from "../lib/access.mjs";
import { clearedCookie, json } from "../lib/auth.mjs";

export default async (req, context) => {
  await logAccess(req, context, "logout");
  return json(200, { ok: true }, { "Set-Cookie": clearedCookie });
};

export const config = { path: "/api/logout" };
