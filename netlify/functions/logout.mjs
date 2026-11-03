import { clearedCookie, json } from "../lib/auth.mjs";

export default async () => json(200, { ok: true }, { "Set-Cookie": clearedCookie });

export const config = { path: "/api/logout" };
