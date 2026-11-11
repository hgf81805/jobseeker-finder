import { logAccess } from "../lib/access.mjs";
import { isLoggedIn, json } from "../lib/auth.mjs";
import { dbEnabled } from "../lib/db.mjs";

export default async (req, context) => {
  const loggedIn = isLoggedIn(req);
  await logAccess(req, context, "open", loggedIn);
  return json(200, { loggedIn, hasKey: !!process.env.THROK_API_KEY, hasDb: dbEnabled() });
};

export const config = { path: "/api/me" };
