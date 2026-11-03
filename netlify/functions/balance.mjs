import { isLoggedIn, unauthorized, json } from "../lib/auth.mjs";
import { throkGet, throkError } from "../lib/throk.mjs";

// 残高の照会はクレジットを使わない
export default async (req) => {
  if (!isLoggedIn(req)) return unauthorized();
  try {
    const b = await throkGet("/balance", {});
    return json(200, { credits: b.credits });
  } catch (e) {
    return throkError(e);
  }
};

export const config = { path: "/api/balance" };
