import { isLoggedIn, json } from "../lib/auth.mjs";

export default async (req) => json(200, { loggedIn: isLoggedIn(req), hasKey: !!process.env.THROK_API_KEY });

export const config = { path: "/api/me" };
