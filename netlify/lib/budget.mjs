import { json } from "./auth.mjs";
import { dbEnabled, dailyLimit, creditsUsedToday, logUsage } from "./db.mjs";

// 呼ぶ前に、今日の使用量にこの呼び出しの最大消費を足して上限を超えないか確かめる
export async function overBudget(maxCost) {
  if (!dbEnabled()) return null;
  const limit = await dailyLimit();
  let used;
  try { used = await creditsUsedToday(); } catch (e) { return null; }
  if (used + maxCost <= limit) return null;
  return json(429, { error: "daily_limit", message: `今日の上限（${limit}クレジット）に達しました。明日また検索できます。` });
}

export async function recordUsage(kind, data) {
  if (!dbEnabled()) return;
  try { await logUsage(kind, (data && data.metadata && data.metadata.credits_consumed) || 0); } catch (e) {}
}
