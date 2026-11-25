import { logAccess } from "../lib/access.mjs";
import { currentUser, ACCOUNTS, json } from "../lib/auth.mjs";
import { dbEnabled } from "../lib/db.mjs";

export default async (req, context) => {
  const owner = currentUser(req);
  await logAccess(req, context, "open", !!owner);
  return json(200, {
    loggedIn: !!owner, account: owner ? ACCOUNTS[owner].name : null, admin: !!(owner && ACCOUNTS[owner].admin),
    hasKey: !!process.env.THROK_API_KEY, hasDb: dbEnabled(),
  });
};

export const config = { path: "/api/me" };
