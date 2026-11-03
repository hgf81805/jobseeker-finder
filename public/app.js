const PAGE_SIZE = 50;
const MAX_PAGES = 2;
const LIVE_BATCH = 20;
const DEFAULT_VENDOR_WORDS = [
  "募集中", "募集して", "採用中", "採用情報", "求人情報", "求人中", "ご応募", "応募はこちら", "応募から",
  "一緒に働きませんか", "働きませんか", "お祝い金", "未経験歓迎", "大歓迎",
  "弊社", "当社", "株式会社", "公式LINE", "LINE登録", "DMください", "DMで", "プロフから", "プロフのリンク",
  "無料相談", "キャリア相談", "転職支援", "ご紹介します", "お伝えします", "コメントしてもらえたら",
  "人に聞きたい", "ノウハウ", "攻略", "キャリアコンサル", "採用担当", "人材", "転職のリアル", "転職ノート"
];
const NAME_MARKERS = ["転職", "キャリア", "採用", "求人", "人材", "株式会社", "公式", "支援", "コンサル", "ノウハウ", "|", "｜"];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = ts => new Date(ts * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

class ApiError extends Error { constructor(status, body) { super(body.message || "エラー"); this.status = status; this.code = body.error; } }
async function api(path, body) {
  const r = await fetch(path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  let data = {};
  try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw new ApiError(r.status, data);
  return data;
}

// ログイン
function showApp(on) { $("login").hidden = on; $("app").hidden = !on; if (!on) $("loginEmail").focus(); }
async function checkSession() {
  try {
    const me = await api("/api/me");
    showApp(me.loggedIn);
    $("keyWarn").hidden = me.hasKey;
  } catch (e) { showApp(false); }
}
$("loginForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  $("loginBtn").disabled = true;
  $("loginErr").textContent = "";
  try {
    await api("/api/login", { email: $("loginEmail").value, password: $("loginPass").value, keep: $("loginKeep").checked });
    $("loginPass").value = "";
    await checkSession();
  } catch (e) {
    $("loginErr").textContent = e.status === 401 ? "メールアドレスかパスワードが違います。" : "ログインできませんでした。時間をおいてもう一度お試しください。";
    $("loginPass").value = "";
  } finally { $("loginBtn").disabled = false; }
});
$("logout").addEventListener("click", async () => { try { await api("/api/logout", {}); } catch (e) {} showApp(false); });
checkSession();

// 検索フォーム
$("vendorWords").value = DEFAULT_VENDOR_WORDS.join(" ");
try { const saved = localStorage.getItem("jf-vendor-words"); if (saved) $("vendorWords").value = saved; } catch (e) {}
$("vendorWords").addEventListener("change", () => { try { localStorage.setItem("jf-vendor-words", $("vendorWords").value); } catch (e) {} });

document.querySelectorAll(".preset").forEach(b => b.addEventListener("click", () => {
  const words = parseKeywords($("q").value);
  if (!words.includes(b.textContent)) words.push(b.textContent);
  $("q").value = words.join(" ");
}));

function parseKeywords(text) {
  return [...new Set(String(text).split(/[\s,、，]+/).map(s => s.trim()).filter(Boolean))].slice(0, 30);
}
function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function readForm() {
  const days = clampInt($("days").value, 1, 7, 5); $("days").value = days;
  const maxReplies = clampInt($("maxReplies").value, 0, 999, 0); $("maxReplies").value = maxReplies;
  const likesRaw = $("maxLikes").value.trim();
  const maxLikes = likesRaw === "" ? null : clampInt(likesRaw, 0, 1e7, null);
  const want = clampInt($("want").value, 1, 30, 10); $("want").value = want;
  return {
    keywords: parseKeywords($("q").value), days, maxReplies, maxLikes, want,
    noVendor: $("noVendor").checked, noDeleted: $("noDeleted").checked, threadOnly: $("threadOnly").checked,
    vendorWords: parseKeywords($("vendorWords").value)
  };
}
function updateEstimate() {
  const f = readForm();
  const search = PAGE_SIZE * MAX_PAGES * 2;
  const live = f.noDeleted ? Math.min(f.want + 10, PAGE_SIZE * MAX_PAGES) * 3 : 0;
  $("estimate").textContent = (search + live).toLocaleString();
}
["days", "maxReplies", "maxLikes", "want", "noDeleted"].forEach(id => $(id).addEventListener("change", updateEstimate));
updateEstimate();

function vendorReason(item, words) {
  const caption = item.post.caption || "";
  const name = (item.user.full_name || "") + " " + (item.user.username || "");
  const hitCaption = words.find(w => caption.includes(w));
  if (hitCaption) return `本文に「${hitCaption}」`;
  const hitName = NAME_MARKERS.find(w => name.includes(w));
  if (hitName) return `表示名に「${hitName}」（発信・業者アカウント）`;
  if (/[①②③④⑤⑥]/.test(caption) && /(聞きたい|どれ|教えて)/.test(caption)) return "アンケート型の集客投稿";
  return null;
}

function showStatus(kind, html) { const el = $("status"); el.className = "status " + kind; el.innerHTML = html; el.hidden = false; }
function hideStatus() { $("status").hidden = true; }

let running = false;
$("form").addEventListener("submit", async ev => {
  ev.preventDefault();
  if (running) return;
  const f = readForm();
  if (!f.keywords.length) { showStatus("bad", "キーワードを1つ以上入れてください。"); $("q").focus(); return; }
  running = true; $("go").disabled = true;
  try { await runSearch(f); } finally { running = false; $("go").disabled = false; }
});

async function runSearch(f) {
  showStatus("info", '<span class="progress" id="prog">検索しています…</span>');
  const prog = msg => { const el = $("prog"); if (el) el.textContent = msg; };
  const excluded = [], passed = [], seen = new Set();
  let credits = 0, fetched = 0, total = null;
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      prog(`投稿を検索中… ${page}ページ目`);
      const p = await api("/api/search", { keywords: f.keywords, days: f.days, threadOnly: f.threadOnly, size: PAGE_SIZE, page });
      const items = p.content || [];
      const meta = p.metadata || {};
      credits += meta.credits_consumed || 0;
      if (total == null) total = meta.total_count ?? null;
      fetched += items.length;
      let overReplies = false;
      for (const it of items) {
        if (!it || !it.post || seen.has(it.post.code)) continue;
        seen.add(it.post.code);
        const rc = it.post.reply_count || 0;
        if (rc > f.maxReplies) { excluded.push({ it, tag: "replies", label: "コメント数", why: `コメント${rc}件` }); overReplies = true; continue; }
        if (f.maxLikes != null && (it.post.like_count || 0) > f.maxLikes) { excluded.push({ it, tag: "replies", label: "いいね数", why: `いいね${it.post.like_count}件` }); continue; }
        const vr = f.noVendor ? vendorReason(it, f.vendorWords) : null;
        if (vr) { excluded.push({ it, tag: "vendor", label: "業者", why: vr }); continue; }
        passed.push(it);
      }
      // コメントの少ない順なので、上限を超えたら以降のページも超える
      if (overReplies || items.length < PAGE_SIZE || passed.length >= f.want + 10) break;
    }

    let shown = [];
    if (f.noDeleted) {
      for (let i = 0; i < passed.length && shown.length < f.want; i += LIVE_BATCH) {
        const batch = passed.slice(i, i + LIVE_BATCH);
        prog(`削除されていないか確認中… ${Math.min(i + LIVE_BATCH, passed.length)}/${passed.length}`);
        const p = await api("/api/live", { codes: batch.map(b => b.post.code) });
        credits += (p.metadata && p.metadata.credits_consumed) || 0;
        const byCode = new Map((p.content || []).map(r => [r.post_code, r]));
        for (const it of batch) {
          const r = byCode.get(it.post.code);
          if (!r || !r.success) { excluded.push({ it, tag: "deleted", label: "削除済み", why: "Threads で表示できません" }); continue; }
          const live = { ...it.post, ...r.post, url: r.post.url || it.post.url };
          if ((live.reply_count || 0) > f.maxReplies) { excluded.push({ it, tag: "replies", label: "コメント数", why: `確認時点でコメント${live.reply_count}件` }); continue; }
          if (shown.length < f.want) shown.push({ post: live, user: it.user, verified: true });
        }
      }
    } else {
      shown = passed.slice(0, f.want);
    }
    hideStatus();
    render(shown, excluded, { credits, fetched, total });
  } catch (e) {
    if (e.status === 401) { showApp(false); return; }
    showStatus("bad", `<div><b>検索できませんでした。</b>${esc(e.message)}</div>`);
    if (credits) render([], excluded, { credits, fetched, total });
  }
}

function render(shown, excluded, stats) {
  const count = tag => excluded.filter(x => x.tag === tag).length;
  $("summary").innerHTML = [
    ["該当", stats.total != null ? stats.total.toLocaleString() + (stats.total >= 10000 ? "+" : "") : "—"],
    ["確認", stats.fetched], ["表示", shown.length], ["業者を除外", count("vendor")],
    ["削除済みを除外", count("deleted")], ["件数超えを除外", count("replies")], ["使ったクレジット", stats.credits]
  ].map(([k, v]) => `<span class="s">${k}<b>${v}</b></span>`).join("");
  $("summary").hidden = false;

  $("results").innerHTML = shown.length ? shown.map(({ post, user, verified }) => `
    <article class="card">
      <div class="head">
        <span class="who">@${esc(user.username)}${user.full_name ? `<small>${esc(user.full_name)}</small>` : ""}</span>
        <span class="when">${fmtTime(post.post_timestamp)} 投稿</span>
      </div>
      <p>${esc(post.caption)}</p>
      <div class="foot">
        <span class="metrics">
          <span>コメント <strong>${post.reply_count ?? 0}</strong></span>
          <span>いいね <strong>${post.like_count ?? 0}</strong></span>
          ${post.impression_count != null ? `<span>閲覧 <strong>${post.impression_count}</strong></span>` : ""}
        </span>
        <span>${verified ? `<span class="pill">表示確認済</span> ` : ""}<a href="${esc(post.url)}" target="_blank" rel="noopener">Threadsで開く</a></span>
      </div>
    </article>`).join("")
    : `<div class="empty">条件に合う投稿が見つかりませんでした。期間を延ばすか、コメント数の上限を上げるか、キーワードを足してください。</div>`;

  $("exSummary").textContent = `除外した投稿（${excluded.length}件）`;
  $("exList").innerHTML = excluded.map(x => `
    <div class="ex-row"><span class="ex-tag ${x.tag}">${esc(x.label)}</span>
    <span class="t" title="${esc(x.it.post.caption)}"><b>@${esc(x.it.user.username)}</b>${esc(x.why)} ・ ${esc((x.it.post.caption || "").replace(/\s+/g, " ").slice(0, 60))}</span></div>`).join("");
  $("excluded").hidden = excluded.length === 0;
}
