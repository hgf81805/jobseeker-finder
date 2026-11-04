import { isLoggedIn, unauthorized, json } from "../lib/auth.mjs";
import { dbEnabled, dailyLimit, creditsUsedToday } from "../lib/db.mjs";

// 今日（日本時間）使ったクレジットと1日の上限
export default async (req) => {
  if (!isLoggedIn(req)) return unauthorized();
  if (!dbEnabled()) return json(200, { used: null, limit: dailyLimit() });
  try {
    return json(200, { used: await creditsUsedToday(), limit: dailyLimit() });
  } catch (e) {
    return json(200, { used: null, limit: dailyLimit() });
  }
};

export const config = { path: "/api/usage" };
