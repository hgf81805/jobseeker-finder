import Anthropic from "@anthropic-ai/sdk";
import { isLoggedIn, unauthorized, json, readJson } from "../lib/auth.mjs";
import { dbEnabled, rest, inList } from "../lib/db.mjs";
import { aiEnabled, analyzePosts } from "../lib/insights.mjs";

// POST { posts: [{code, caption, username, full_name}], cachedOnly? }
// 保存済みの読み取り結果を返し、無い投稿だけ AI で読み取って保存する（同じ投稿は二度分析しない）
export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!isLoggedIn(req)) return unauthorized();
  const body = await readJson(req);
  const posts = (Array.isArray(body.posts) ? body.posts : [])
    .filter(p => p && /^[A-Za-z0-9_-]{5,20}$/.test(String(p.code)))
    .slice(0, 30);
  if (!posts.length) return json(200, { insights: {}, enabled: aiEnabled() });

  const insights = {};
  if (dbEnabled()) {
    try {
      const rows = await rest(`post_insights?select=code,is_seeker,stage,job,area,worries,summary,distress,work_style,age_group,openness&code=in.${encodeURIComponent(inList(posts.map(p => p.code)))}`);
      for (const r of rows || []) insights[r.code] = r;
    } catch (e) {}
  }
  const missing = posts.filter(p => !insights[p.code] && p.caption);
  if (body.cachedOnly || !missing.length) return json(200, { insights, enabled: aiEnabled() });
  // APIキーが無いときは、Claude Code が定期的に読み取って保存した結果だけを返す
  if (!aiEnabled()) return json(200, { insights, enabled: false, pending: missing.length, message: `AIの読み取りは自動で行われます（毎日6時〜翌2時の毎時0分）。まだの${missing.length}件は、あとで付きます。` });

  try {
    // 10件ずつまとめて読み取る
    for (let i = 0; i < missing.length; i += 10) {
      const results = await analyzePosts(missing.slice(i, i + 10));
      for (const r of results) insights[r.code] = r;
      if (results.length && dbEnabled()) {
        try {
          await rest("post_insights?on_conflict=code", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: results });
        } catch (e) {}
      }
    }
    return json(200, { insights, enabled: true });
  } catch (e) {
    let message = "AIの読み取りに失敗しました。時間をおいてもう一度お試しください。";
    if (e instanceof Anthropic.AuthenticationError) message = "AIのAPIキーが正しくありません（ANTHROPIC_API_KEY を確認してください）。";
    else if (e instanceof Anthropic.RateLimitError) message = "AIの利用が混み合っています。少し待ってからもう一度お試しください。";
    else if (e instanceof Anthropic.APIError) message = `AIの読み取りでエラーが起きました（${e.status}）。`;
    return json(200, { insights, enabled: true, error: "ai_error", message });
  }
};

export const config = { path: "/api/analyze" };
