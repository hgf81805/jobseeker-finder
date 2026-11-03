import { isLoggedIn, json } from "../lib/auth.mjs";
import { dbEnabled } from "../lib/db.mjs";

export default async (req) => json(200, { loggedIn: isLoggedIn(req), hasKey: !!process.env.THROK_API_KEY, hasDb: dbEnabled() });

export const config = { path: "/api/me" };
