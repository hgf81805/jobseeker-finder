import Anthropic from "@anthropic-ai/sdk";

// 投稿から「本人の求職投稿か・転職の段階・職種・地域・悩み」を読み取る
export const MODEL = "claude-opus-5-5";
export const STAGES = ["考え中", "活動中", "内定・退職決定", "不明"];
export const DISTRESS = ["none", "caution", "urgent"];
export const WORRIES = ["給与", "残業・労働時間", "人間関係", "休日", "将来性", "仕事内容", "体調・メンタル", "家庭・育児", "年齢", "通勤・勤務地", "評価・待遇", "その他"];

const SYSTEM = `あなたは人材紹介会社のリサーチ担当です。Threads の日本語の投稿を読み、投稿者について分かることだけを記録します。
- is_seeker：投稿者本人が転職・退職・仕事探しを考えている、または活動している投稿なら true。転職エージェント・求人企業・キャリア相談やノウハウの発信者・アンケートで集客する投稿・転職と関係ない投稿なら false。
- stage：考え中（辞めたい・迷っている）／活動中（応募・面接・求人探し中）／内定・退職決定（内定が出た・退職が決まった）／不明。is_seeker が false なら「不明」。
- job：今の職種または目指す職種を短い言葉で（例：看護師、事務、営業、介護、ITエンジニア）。書かれていなければ「不明」。
- area：都道府県や市区町村など、書かれている地域。書かれていなければ「不明」。
- worries：転職を考える理由や悩みを、選択肢から当てはまるものだけ選ぶ（無ければ空）。
- summary：投稿者の状況を40字以内で。
- distress：心の不調のサイン。死にたい・消えたい・自分を傷つけたいなど命に関わる表現があれば urgent。鬱・適応障害・眠れない・涙が止まらない・限界・つらくて動けない・大切な人を亡くした悲しみなど、心身のつらさがはっきり書かれていれば caution。仕事の愚痴や疲れ、軽い落ち込みだけなら none。
推測で埋めず、投稿に書かれていることだけを根拠にしてください。結果は必ず record_insights ツールで、渡された投稿すべてについて返してください。`;

const TOOL = {
  name: "record_insights",
  description: "投稿ごとの読み取り結果を記録する。渡されたすべての投稿について1件ずつ入れる。",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            code: { type: "string", description: "投稿コード（渡されたものをそのまま）" },
            is_seeker: { type: "boolean" },
            stage: { type: "string", enum: STAGES },
            job: { type: "string" },
            area: { type: "string" },
            worries: { type: "array", items: { type: "string", enum: WORRIES } },
            summary: { type: "string" },
            distress: { type: "string", enum: DISTRESS },
          },
          required: ["code", "is_seeker", "stage", "job", "area", "worries", "summary", "distress"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  },
};

let client = null;
export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

export async function analyzePosts(posts) {
  if (!client) client = new Anthropic();
  const list = posts.map(p => ({
    code: p.code,
    author: [p.username ? `@${p.username}` : "", p.full_name || ""].filter(Boolean).join(" "),
    text: String(p.caption || "").slice(0, 1500),
  }));
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: `次の${list.length}件の投稿を読み取り、record_insights で記録してください。\n\n${JSON.stringify(list, null, 1)}` }],
  });
  if (response.stop_reason === "refusal") return [];
  const call = response.content.find(b => b.type === "tool_use" && b.name === "record_insights");
  if (!call) return [];
  const results = Array.isArray(call.input && call.input.results) ? call.input.results : [];
  const wanted = new Set(posts.map(p => p.code));
  return results
    .filter(r => r && wanted.has(r.code))
    .map(r => ({
      code: r.code,
      is_seeker: !!r.is_seeker,
      stage: STAGES.includes(r.stage) ? r.stage : "不明",
      job: String(r.job || "不明").slice(0, 40),
      area: String(r.area || "不明").slice(0, 40),
      worries: (Array.isArray(r.worries) ? r.worries : []).filter(w => WORRIES.includes(w)),
      summary: String(r.summary || "").slice(0, 80),
      distress: DISTRESS.includes(r.distress) ? r.distress : "none",
      model: response.model || MODEL,
    }));
}
