// クレジット：検索は1件2（投稿者情報つき）、削除の確認は1件3
// 検索は20件ずつ取り、表示が足りないときだけ次の20件を取る
const PAGE_SIZE = 20;
const MAX_PAGES = 3;
const DEFAULT_VENDOR_WORDS = [
  "募集中", "募集して", "採用中", "採用情報", "求人情報", "求人中", "ご応募", "応募はこちら", "応募から",
  "一緒に働きませんか", "働きませんか", "お祝い金", "未経験歓迎", "大歓迎",
  "弊社", "当社", "株式会社", "公式LINE", "LINE登録", "DMください", "DMで", "プロフから", "プロフのリンク",
  "無料相談", "キャリア相談", "転職支援", "ご紹介します", "お伝えします", "コメントしてもらえたら",
  "人に聞きたい", "ノウハウ", "攻略", "キャリアコンサル", "採用担当", "人材", "転職のリアル", "転職ノート"
];
const NAME_MARKERS = ["転職", "キャリア", "採用", "求人", "人材", "株式会社", "公式", "支援", "コンサル", "ノウハウ", "|", "｜"];

const $ = id => document.getElementById(id);
// Threads の投稿URL。投稿者が分かれば /@ユーザー名/post/コード、分からなければ短縮形の /t/コード にする
function threadsUrl(post, user) {
  const code = encodeURIComponent(post.code || "");
  if (user && user.username) return `https://www.threads.com/@${encodeURIComponent(user.username)}/post/${code}`;
  if (post.url && /\/@[^/]+\/post\//.test(post.url)) return post.url;
  return `https://www.threads.com/t/${code}`;
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = ts => new Date(ts * 1000).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

const STATUS_LABEL = { new: "候補", contacted: "声かけ済", replied: "返信あり", meeting: "面談", won: "成約", skip: "対象外", vendor: "業者" };
let hasDb = false;

class ApiError extends Error { constructor(status, body) { super(body.message || "エラー"); this.status = status; this.code = body.error; } }
async function api(path, body, method) {
  const r = await fetch(path, { method: method || (body ? "POST" : "GET"), headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
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
    hasDb = !!me.hasDb;
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
    refreshUsage();
  } catch (e) {
    $("loginErr").textContent = e.status === 401 ? "メールアドレスかパスワードが違います。" : "ログインできませんでした。時間をおいてもう一度お試しください。";
    $("loginPass").value = "";
  } finally { $("loginBtn").disabled = false; }
});
$("logout").addEventListener("click", async () => { try { await api("/api/logout", {}); } catch (e) {} showApp(false); });
checkSession().then(() => { if (!$("app").hidden) refreshUsage(); });

// 今日（日本時間）使ったクレジット ／ 1日の上限
async function refreshUsage() {
  try {
    const u = await api("/api/usage");
    $("usage").textContent = u.used == null ? "—" : `${u.used.toLocaleString()} ／ ${u.limit.toLocaleString()} クレジット`;
  } catch (e) { $("usage").textContent = "—"; }
}

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
  const want = clampInt($("want").value, 1, 10, 10); $("want").value = want;
  return {
    keywords: parseKeywords($("q").value), days, maxReplies, want,
    noVendor: $("noVendor").checked, onlyNew: $("onlyNew").checked,
    vendorWords: parseKeywords($("vendorWords").value)
  };
}
function updateEstimate() {
  $("estimate").textContent = (PAGE_SIZE * MAX_PAGES * 2).toLocaleString();
}
["days", "maxReplies", "want"].forEach(id => $(id).addEventListener("change", updateEstimate));
updateEstimate();

// 本文での判定は検索直後に、表示名での判定は存在確認で投稿者が分かってから行う
function captionVendorReason(post, words) {
  const caption = post.caption || "";
  const hit = words.find(w => caption.includes(w));
  if (hit) return `本文に「${hit}」`;
  if (/[①②③④⑤⑥]/.test(caption) && /(聞きたい|どれ|教えて)/.test(caption)) return "アンケート型の集客投稿";
  return null;
}
function nameVendorReason(user) {
  if (!user) return null;
  const name = (user.full_name || "") + " " + (user.username || "");
  const hit = NAME_MARKERS.find(w => name.includes(w));
  return hit ? `表示名に「${hit}」（発信・業者アカウント）` : null;
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


function render(shown, excluded, stats) {
  const count = tag => excluded.filter(x => x.tag === tag).length;
  $("summary").innerHTML = [
    ["該当", stats.total != null ? stats.total.toLocaleString() + (stats.total >= 10000 ? "+" : "") : "—"],
    ["確認", stats.fetched], ["表示", shown.length], ["業者を除外", count("vendor")],
    ["削除済みを除外", count("deleted")], ["件数超えを除外", count("replies")],
    ...(stats.alreadySaved ? [["取得済みで非表示", stats.alreadySaved]] : []),
    ["使ったクレジット", stats.credits],
    ...(stats.since ? [["取得した範囲", `${fmtTime(stats.since)} 以降`]] : [])
  ].map(([k, v]) => `<span class="s">${k}<b>${v}</b></span>`).join("");
  $("summary").hidden = false;

  $("results").innerHTML = shown.length ? shown.map(({ post, user, verified }) => `
    <article class="card" data-code="${esc(post.code)}" data-username="${esc(user && user.username || "")}" data-time="${post.post_timestamp || 0}">
      <div class="head">
        <span class="who">@${esc(user && user.username)}${user && user.full_name ? `<small>${esc(user.full_name)}</small>` : ""}</span>
        <span class="when">${fmtTime(post.post_timestamp)} 投稿</span>
      </div>
      <p>${esc(post.caption)}</p>
      <div class="foot">
        <span class="metrics">
          <span>コメント <strong>${post.reply_count ?? 0}</strong></span>
          <span>いいね <strong>${post.like_count ?? 0}</strong></span>
          ${post.impression_count != null ? `<span>閲覧 <strong>${post.impression_count}</strong></span>` : ""}
        </span>
        <span>${verified ? `<span class="pill">表示確認済</span> ` : ""}${user && user.username ? `<button type="button" class="check-profile">プロフィール（1クレジット）</button>` : ""}<a href="${esc(threadsUrl(post, user))}" target="_blank" rel="noopener">Threadsで開く</a></span>
      </div>
      ${hasDb ? `<div class="actions" data-code="${esc(post.code)}">
        <button type="button" class="act" data-set="skip" aria-pressed="false">対象外</button>
        <button type="button" class="act" data-set="vendor" aria-pressed="false">業者</button>
      </div>` : ""}
    </article>`).join("")
    : stats.since
      ? `<div class="empty">前回の同じ検索より後に、条件に合う新しい投稿はありませんでした。すべての期間を見直すときは「前回の検索より後の投稿だけ」のチェックを外してください。</div>`
      : `<div class="empty">条件に合う投稿が見つかりませんでした。期間を延ばすか、コメント数の上限を上げるか、キーワードを足してください。</div>`;

  $("exSummary").textContent = `除外した投稿（${excluded.length}件）`;
  // 1行に縮めて表示し、押すと本文の全文と Threads へのリンクを開く
  lastExcluded = excluded;
  $("exList").innerHTML = excluded.map((x, idx) => {
    const post = x.it.post;
    const user = x.it.user;
    const url = threadsUrl(post, user);
    return `
    <details class="ex-row">
      <summary><span class="ex-tag ${x.tag}">${esc(x.label)}</span>
        <span class="t"><b>${user ? "@" + esc(user.username) : "—"}</b>${esc(x.why)} ・ ${esc((post.caption || "").replace(/\s+/g, " ").slice(0, 60))}</span>
        <a class="ex-open" href="${esc(url)}" target="_blank" rel="noopener">Threads</a>
        ${hasDb ? `<span class="actions ex-actions" data-ex="${idx}">
          <button type="button" class="act" data-set="skip" aria-pressed="false">対象外</button>
          <button type="button" class="act" data-set="vendor" aria-pressed="false">業者</button>
        </span>` : ""}</summary>
      <div class="ex-detail">
        <p>${esc(post.caption)}</p>
        <div class="ex-foot">
          <span class="metrics">
            <span>コメント <strong>${post.reply_count ?? 0}</strong></span>
            <span>いいね <strong>${post.like_count ?? 0}</strong></span>
            ${post.post_timestamp ? `<span>${fmtTime(post.post_timestamp)} 投稿</span>` : ""}
          </span>
          <a href="${esc(url)}" target="_blank" rel="noopener">Threadsで開く</a>
        </div>
      </div>
    </details>`;
  }).join("");
  $("excluded").hidden = excluded.length === 0;
}

// 検索1回分の履歴と、表示した投稿を候補として保存する
function saveSearch(f, shown, excluded, skipList, stats) {
  if (!hasDb) return;
  api("/api/record", {
    search: { keywords: f.keywords, days: f.days, maxReplies: f.maxReplies, fetched: stats.fetched, shown: shown.length, excluded: excluded.length, credits: stats.credits },
    items: shown.map(({ post, user }) => ({
      code: post.code, url: post.url, caption: post.caption, posted_at: post.post_timestamp,
      reply_count: post.reply_count, like_count: post.like_count,
      username: user && user.username, full_name: user && user.full_name
    })),
    skipped: skipList
  }).catch(() => {});
}

async function setStatus(code, status) {
  return api("/api/candidates", { code, status }, "PATCH");
}

// 「対象外」「業者」ボタン（検索結果と候補一覧で共通）。押されているボタンをもう一度押すと取り消す
async function onMarkClick(ev) {
  const btn = ev.target.closest(".act");
  if (!btn) return;
  const box = btn.closest(".actions");
  const next = btn.getAttribute("aria-pressed") === "true" ? "new" : btn.dataset.set;
  btn.disabled = true;
  try {
    await setStatus(box.dataset.code, next);
    box.querySelectorAll(".act").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.set === next)));
    btn.closest(".card").classList.toggle("done", next === "skip" || next === "vendor");
  } catch (e) {
    alertInline(box, "保存できませんでした");
  } finally { btn.disabled = false; }
}
$("results").addEventListener("click", onMarkClick);

// 除外した投稿の「対象外」「業者」ボタン。押すと候補一覧に印付きで登録し、もう一度押すと登録を取り消す
let lastExcluded = [];
$("exList").addEventListener("click", async ev => {
  const btn = ev.target.closest(".act");
  if (!btn) return;
  ev.preventDefault(); // 行の開け閉めはしない
  const box = btn.closest(".actions");
  const x = lastExcluded[Number(box.dataset.ex)];
  if (!x) return;
  const post = x.it.post, user = x.it.user;
  const next = btn.getAttribute("aria-pressed") === "true" ? "none" : btn.dataset.set;
  btn.disabled = true;
  try {
    await api("/api/candidates", {
      status: next,
      post: { code: post.code, url: threadsUrl(post, user), caption: post.caption, posted_at: post.post_timestamp, username: user && user.username, full_name: user && user.full_name, reply_count: post.reply_count, like_count: post.like_count }
    });
    box.querySelectorAll(".act").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.set === next)));
  } catch (e) {
    alertInline(box, "保存できませんでした");
  } finally { btn.disabled = false; }
});
$("list").addEventListener("click", onMarkClick);
function alertInline(el, text) {
  const s = document.createElement("span");
  s.className = "saved"; s.style.color = "var(--bad)"; s.textContent = text;
  el.appendChild(s); setTimeout(() => s.remove(), 3000);
}

// 表示の切り替え
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-pressed", String(x === t)));
  $("viewSearch").hidden = t.dataset.view !== "search";
  $("viewList").hidden = t.dataset.view !== "list";
  $("viewKw").hidden = t.dataset.view !== "kw";
  if (t.dataset.view === "list") loadList();
  if (t.dataset.view === "kw") loadKeywords();
}));

let listStatus = "not_vendor"; // 候補一覧の最初の絞り込みは「業者以外」
document.querySelectorAll("#listFilter .chip-btn").forEach(c => c.addEventListener("click", () => {
  document.querySelectorAll("#listFilter .chip-btn").forEach(x => x.setAttribute("aria-pressed", String(x === c)));
  listStatus = c.dataset.status;
  listPage = 1;
  loadList();
}));

async function loadList() {
  const st = $("listStatus");
  if (!hasDb) { st.className = "status warn"; st.textContent = "データベースが設定されていないため、候補一覧は使えません。"; st.hidden = false; $("list").innerHTML = ""; return; }
  st.className = "status info"; st.textContent = "読み込み中…"; st.hidden = false;
  try {
    const q = new URLSearchParams({ page: String(listPage) });
    if (listStatus) q.set("status", listStatus);
    const { items, total, perPage } = await api("/api/candidates?" + q);
    renderPager(total || 0, perPage || 50);
    st.hidden = true;
    $("list").innerHTML = items.length ? items.map(c => `
      <article class="card${["skip", "vendor"].includes(c.status) ? " done" : ""}" data-code="${esc(c.code)}" data-username="${esc(c.username || "")}" data-time="${c.posted_at ? Date.parse(c.posted_at) / 1000 : 0}">
        <div class="head">
          <span class="who">@${esc(c.username || "—")}${c.authors && c.authors.full_name ? `<small>${esc(c.authors.full_name)}</small>` : ""}</span>
          <span class="when">${c.posted_at ? fmtTime(Date.parse(c.posted_at) / 1000) + " 投稿" : ""}</span>
        </div>
        ${c.authors && c.authors.profile_checked_at ? profileHtml(c.authors) : ""}
        <p>${esc(c.caption)}</p>
        <div class="cand-meta">
          <span class="actions" data-code="${esc(c.code)}">
            <button type="button" class="act" data-set="contacted" aria-pressed="${c.status === "contacted"}">声かけ済</button>
            <button type="button" class="act" data-set="skip" aria-pressed="${c.status === "skip"}">対象外</button>
            <button type="button" class="act" data-set="vendor" aria-pressed="${c.status === "vendor"}">業者</button>
          </span>
          <span class="metrics">取得時　コメント <strong>${c.reply_count ?? "—"}</strong>　いいね <strong>${c.like_count ?? "—"}</strong></span>
          <span>見つけた日 ${fmtTime(Date.parse(c.found_at) / 1000)}</span>
          ${c.status === "contacted" && c.contacted_at ? `<span>声かけ ${fmtTime(Date.parse(c.contacted_at) / 1000)}</span>` : ""}
          ${c.username && !(c.authors && c.authors.profile_checked_at) ? `<button type="button" class="check-profile">プロフィール（1クレジット）</button>` : ""}
          <a href="${esc(threadsUrl({ code: c.code, url: c.url }, c.username ? { username: c.username } : null))}" target="_blank" rel="noopener">Threadsで開く</a>
          <span class="saved" hidden>保存しました</span>
        </div>
        <textarea class="cand-note" aria-label="メモ" placeholder="メモ（やり取りの内容など）">${esc(c.note || "")}</textarea>
      </article>`).join("")
      : `<div class="empty">この条件の候補はまだありません。検索すると、表示した投稿がここに入ります。</div>`;
    attachInsights("list", "listFilter2", "listAiStatus", items.map(c => ({ code: c.code, caption: c.caption, username: c.username, full_name: c.authors && c.authors.full_name })));
  } catch (e) {
    st.className = "status bad"; st.textContent = e.message || "読み込めませんでした。"; st.hidden = false;
  }
}

async function saveCandidate(card, patch) {
  const ok = card.querySelector(".saved");
  try {
    await api("/api/candidates", { code: card.dataset.code, ...patch }, "PATCH");
    ok.hidden = false; setTimeout(() => { ok.hidden = true; }, 2000);
  } catch (e) { alertInline(card.querySelector(".cand-meta"), "保存できませんでした"); }
}
$("list").addEventListener("change", ev => {
  const card = ev.target.closest(".card");
  if (!card) return;
  if (ev.target.classList.contains("cand-note")) {
    saveCandidate(card, { note: ev.target.value });
  }
});

// 20件ずつ投稿者情報つき（1件2）で取り、無料の判定だけで表示件数をそろえる。削除の確認はカードのボタンで
async function runSearch(f) {
  showStatus("info", '<span class="progress" id="prog">検索しています…</span>');
  const prog = msg => { const el = $("prog"); if (el) el.textContent = msg; };
  const excluded = [], shown = [], seen = new Set();
  let alreadySaved = 0; // 候補一覧に取得済み（業者以外）の投稿。結果にも除外リストにも出さない
  let credits = 0, fetched = 0, total = null, since = null;
  try {
    if (hasDb && f.onlyNew) {
      const last = await api("/api/last-search", { keywords: f.keywords }).catch(() => ({ at: null }));
      if (last.at) since = Math.floor(Date.parse(last.at) / 1000) - 24 * 3600;
    }
    for (let page = 1; page <= MAX_PAGES && shown.length < f.want; page++) {
      prog(`投稿を検索中… ${page}ページ目`);
      const p = await api("/api/search", { keywords: f.keywords, days: f.days, size: PAGE_SIZE, page, since, details: true });
      const items = p.content || [];
      const meta = p.metadata || {};
      credits += meta.credits_consumed || 0;
      if (total == null) total = meta.total_count ?? null;
      fetched += items.length;

      let overReplies = false;
      const passed = [];
      for (const it of items) {
        if (!it || !it.post || seen.has(it.post.code)) continue;
        seen.add(it.post.code);
        const rc = it.post.reply_count || 0;
        if (rc > f.maxReplies) { excluded.push({ it, tag: "replies", label: "コメント数", why: `コメント${rc}件` }); overReplies = true; continue; }
        const vr = f.noVendor ? (captionVendorReason(it.post, f.vendorWords) || nameVendorReason(it.user)) : null;
        if (vr) { excluded.push({ it, tag: "vendor", label: "業者", why: vr }); continue; }
        passed.push(it);
      }

      // 登録済み・前に外した投稿・業者と登録済みの投稿者を外す
      const names = [...new Set(passed.map(x => x.user && x.user.username).filter(Boolean))];
      const known = passed.length
        ? await api("/api/known", { codes: passed.map(x => x.post.code), usernames: names }).catch(() => ({ codes: {}, skipped: {}, vendors: [] }))
        : { codes: {}, skipped: {}, vendors: [] };
      const vendorSet = new Set(known.vendors || []);
      for (const it of passed) {
        const st = known.codes && known.codes[it.post.code];
        const sk = known.skipped && known.skipped[it.post.code];
        const uname = it.user && it.user.username;
        if (st === "vendor") excluded.push({ it, tag: "vendor", label: "業者", why: "候補一覧で業者に登録済み" });
        else if (st) alreadySaved++;
        else if (sk === "deleted") excluded.push({ it, tag: "deleted", label: "削除済み", why: "前回の確認で削除済み" });
        else if (f.noVendor && (sk === "vendor" || (uname && vendorSet.has(uname)))) excluded.push({ it, tag: "vendor", label: "業者", why: sk === "vendor" ? "前回の確認で業者と判定" : "業者として登録済みの投稿者" });
        else if (shown.length < f.want) shown.push({ post: it.post, user: it.user, verified: false });
      }
      if (overReplies || items.length < PAGE_SIZE) break;
    }
    hideStatus();
    render(shown, excluded, { credits, fetched, total, since, alreadySaved });
    attachInsights("results", "resultsFilter", "resultsAiStatus", shown.map(({ post, user }) => ({ code: post.code, caption: post.caption, username: user && user.username, full_name: user && user.full_name })));
    saveSearch(f, shown, excluded, [], { credits, fetched });
    refreshUsage();
  } catch (e) {
    if (e.status === 401) { showApp(false); return; }
    showStatus("bad", `<div><b>検索できませんでした。</b>${esc(e.message)}</div>`);
    if (credits) render(shown, excluded, { credits, fetched, total, since, alreadySaved });
    refreshUsage();
  }
}


// AIの読み取り：各カードに「段階・職種・地域・悩み・要約」を付け、絞り込みの帯を用意する
const insightCache = {};
async function attachInsights(containerId, filterId, statusId, posts) {
  const box = $(containerId), bar = $(filterId), st = $(statusId);
  bar.hidden = true; st.hidden = true;
  if (!posts.length) return;
  box.querySelectorAll(".card[data-code]").forEach(card => {
    if (card.querySelector(".insight")) return;
    const div = document.createElement("div");
    div.className = "insight loading";
    div.textContent = "AIが読み取り中…";
    (card.querySelector(".profile") || card.querySelector("p")).before(div); // 本文の上に置く
  });
  let res = { insights: {} };
  const need = posts.filter(p => !insightCache[p.code]);
  if (need.length) {
    // サーバーは一度に30件までなので、25件ずつに分けて取る（候補一覧は1ページ50件）
    res = { insights: {} };
    for (let i = 0; i < need.length; i += 25) {
      try {
        const part = await api("/api/analyze", { posts: need.slice(i, i + 25) });
        Object.assign(res.insights, part.insights || {});
        if (part.message) { res.message = part.message; res.enabled = part.enabled; }
      } catch (e) { res.message = "AIの読み取りに失敗しました。"; }
    }
    Object.assign(insightCache, res.insights);
  }
  box.querySelectorAll(".card[data-code]").forEach(card => {
    const ins = insightCache[card.dataset.code];
    const div = card.querySelector(".insight");
    if (!div) return;
    if (!ins) { div.remove(); return; }
    card.dataset.stage = ins.stage; card.dataset.job = ins.job; card.dataset.seeker = String(ins.is_seeker);
    card.dataset.worries = (ins.worries || []).join("|");
    card.dataset.distress = ins.distress || "none";
    card.dataset.score = String(leadScore(ins));
    card.classList.toggle("low-fit", !isSupported(ins) || ins.openness === "closed" || !ins.is_seeker);
    card.classList.toggle("has-distress", card.dataset.distress !== "none");
    div.className = "insight";
    div.innerHTML = `
      ${distressNote(ins.distress)}
      <div class="ins-chips">
        ${ins.distress && ins.distress !== "none" ? `<span class="ins-chip distress">${ins.distress === "urgent" ? "命に関わるサイン" : "心の不調のサイン"}</span>` : ""}
        ${ins.is_seeker ? "" : `<span class="ins-chip not-seeker">本人の投稿ではない可能性（業者・発信など）</span>`}
        ${ins.stage !== "不明" ? `<span class="ins-chip stage-${esc(ins.stage)}">${esc(ins.stage)}</span>` : ""}
        ${ins.job !== "不明" ? `<span class="ins-chip">${esc(ins.job)}</span>` : ""}
        ${ins.area !== "不明" ? `<span class="ins-chip">${esc(ins.area)}</span>` : ""}
        ${ins.openness === "open" ? `<span class="ins-chip open">反応を求めている</span>` : ""}
        ${ins.openness === "closed" ? `<span class="ins-chip closed">声かけを嫌がっている</span>` : ""}
        ${ins.work_style && ins.work_style !== "不明" ? `<span class="ins-chip${SUPPORTED_WORK.includes(ins.work_style) ? "" : " unfit"}">${esc(ins.work_style)}希望${SUPPORTED_WORK.includes(ins.work_style) ? "" : "（支援の対象外）"}</span>` : ""}
        ${ins.age_group && ins.age_group !== "不明" ? `<span class="ins-chip">${esc(ins.age_group)}</span>` : ""}
        ${(ins.worries || []).map(w => `<span class="ins-chip worry">${esc(w)}</span>`).join("")}
      </div>
      ${ins.summary ? `<div class="ins-sum">${esc(ins.summary)}</div>` : ""}`;
  });
  if (res.message) { st.className = res.enabled === false ? "status info" : "status warn"; st.textContent = res.message; st.hidden = false; }
  const got = posts.map(p => insightCache[p.code]).filter(Boolean);
  if (!got.length) return;
  // 絞り込みの選択肢を、読み取れた内容から作る
  const fill = (sel, values, label) => {
    const cur = sel.value;
    sel.innerHTML = `<option value="">${label}：すべて</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    if (values.includes(cur)) sel.value = cur;
  };
  const uniq = arr => [...new Set(arr)].filter(v => v && v !== "不明").sort();
  fill(bar.querySelector(".f-stage"), ["考え中", "活動中", "内定・退職決定"].filter(v => got.some(g => g.stage === v)), "段階");
  fill(bar.querySelector(".f-job"), uniq(got.map(g => g.job)), "職種");
  fill(bar.querySelector(".f-worry"), uniq(got.flatMap(g => g.worries || [])), "悩み");
  bar.hidden = false;
  if (!bar.dataset.bound) {
    bar.dataset.bound = "1";
    bar.addEventListener("change", () => applyInsightFilter(containerId, filterId));
  }
  applyInsightFilter(containerId, filterId);
}

function applyInsightFilter(containerId, filterId) {
  const bar = $(filterId);
  const stage = bar.querySelector(".f-stage").value, job = bar.querySelector(".f-job").value, worry = bar.querySelector(".f-worry").value;
  const seekerOnly = bar.querySelector(".f-seeker").checked;
  const hideDistress = bar.querySelector(".f-distress").checked;
  let shownCount = 0, total = 0;
  $(containerId).querySelectorAll(".card[data-code]").forEach(card => {
    total++;
    const analyzed = card.dataset.stage !== undefined;
    const hide = analyzed && (
      (seekerOnly && card.dataset.seeker === "false") ||
      (hideDistress && card.dataset.distress && card.dataset.distress !== "none") ||
      (stage && card.dataset.stage !== stage) ||
      (job && card.dataset.job !== job) ||
      (worry && !(card.dataset.worries || "").split("|").includes(worry)));
    card.classList.toggle("f-hidden", !!hide);
    if (!hide) shownCount++;
  });
  bar.querySelector(".f-count").textContent = `${shownCount} ／ ${total}件を表示`;
  // 並び順：おすすめ順は点数の高い順（同点は新しい順）、そうでなければ投稿の新しい順
  const box = $(containerId);
  const cards = [...box.querySelectorAll(".card[data-code]")];
  const byTime = (a, b) => Number(b.dataset.time || 0) - Number(a.dataset.time || 0);
  const sortBy = bar.querySelector(".f-sort").value;
  cards.sort(sortBy === "score" ? (a, b) => Number(b.dataset.score || 0) - Number(a.dataset.score || 0) || byTime(a, b) : byTime);
  cards.forEach(c => box.appendChild(c));
}

// 候補一覧のページ送り（50件ずつ）
let listPage = 1;
function renderPager(total, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (listPage > pages) listPage = pages;
  const from = total ? (listPage - 1) * perPage + 1 : 0, to = Math.min(total, listPage * perPage);
  const html = `<button type="button" data-go="-1" ${listPage <= 1 ? "disabled" : ""}>← 前の50件</button>
    <span>${total.toLocaleString()}件中 ${from}〜${to}件（${listPage} ／ ${pages}ページ）</span>
    <button type="button" data-go="1" ${listPage >= pages ? "disabled" : ""}>次の50件 →</button>`;
  ["pagerTop", "pagerBottom"].forEach(id => { $(id).innerHTML = html; $(id).hidden = total <= perPage; });
}
["pagerTop", "pagerBottom"].forEach(id => $(id).addEventListener("click", ev => {
  const b = ev.target.closest("button[data-go]");
  if (!b || b.disabled) return;
  listPage += Number(b.dataset.go);
  loadList();
  $("viewList").scrollIntoView({ behavior: "smooth", block: "start" });
}));

// キーワードの成績表
async function loadKeywords() {
  const st = $("kwStatus");
  if (!hasDb) { st.className = "status warn"; st.textContent = "データベースが設定されていないため、成績表は使えません。"; st.hidden = false; return; }
  st.className = "status info"; st.textContent = "読み込み中…"; st.hidden = false;
  try {
    const { rows } = await api("/api/keywords");
    st.hidden = true;
    const per = r => (Number(r.seekers) > 0 ? Number(r.credits) / Number(r.seekers) : null);
    rows.sort((a, b) => (per(a) ?? Infinity) - (per(b) ?? Infinity) || Number(b.searches) - Number(a.searches));
    const vals = rows.map(per).filter(v => v != null);
    const best = vals.length ? Math.min(...vals) : null, worst = vals.length > 1 ? Math.max(...vals) : null;
    $("kwBody").innerHTML = rows.length ? rows.map(r => {
      const p = per(r);
      const rate = Number(r.analyzed) > 0 ? Math.round(Number(r.seekers) / Number(r.analyzed) * 100) + "%" : "—";
      const waiting = Number(r.shown) - Number(r.analyzed);
      const cls = p != null && p === best ? "best" : p != null && p === worst ? "worst" : "";
      return `<tr data-kw="${esc(r.keywords)}" tabindex="0">
        <td>${esc(r.keywords)}${waiting > 0 ? `<span class="pending">読み取り待ち${waiting}件</span>` : ""}</td>
        <td class="n">${r.searches}</td><td class="n">${Number(r.credits).toLocaleString()}</td>
        <td class="n">${r.shown}</td><td class="n">${r.seekers}</td><td class="n">${r.active}</td>
        <td class="n">${rate}</td><td class="n ${cls}">${p == null ? "—" : Math.round(p).toLocaleString()}</td>
        <td>${r.last_at ? fmtTime(Date.parse(r.last_at) / 1000) : ""}</td></tr>`;
    }).join("") : `<tr><td colspan="9">まだ検索の記録がありません。</td></tr>`;
  } catch (e) {
    st.className = "status bad"; st.textContent = e.message || "読み込めませんでした。"; st.hidden = false;
  }
}
// 行を押すと、そのキーワードで検索画面を開く
function openKeyword(tr) {
  $("q").value = tr.dataset.kw.split(" / ").join(" ");
  document.querySelector('.tab[data-view="search"]').click();
  $("q").focus();
}
$("kwBody").addEventListener("click", ev => { const tr = ev.target.closest("tr[data-kw]"); if (tr) openKeyword(tr); });
$("kwBody").addEventListener("keydown", ev => { const tr = ev.target.closest("tr[data-kw]"); if (tr && ev.key === "Enter") openKeyword(tr); });

// 心の不調のサインがある投稿への接し方の案内（売り込みをしないための注意書き）
function distressNote(level) {
  if (level === "urgent") {
    return `<div class="distress-note"><b>命に関わる表現があります。</b>転職や仕事の話はしないでください。</div>`;
  }
  return "";
}

// 支援の対象：雇用形態は正社員・派遣・業務委託（地域は全国、年代・職種は問わない）
const SUPPORTED_WORK = ["正社員", "派遣", "業務委託"];
const isSupported = ins => !ins.work_style || ins.work_style === "不明" || SUPPORTED_WORK.includes(ins.work_style);

// おすすめ順の点数：支援の対象外・声かけを嫌がる・本人でない・心の不調は下げ、反応を求めている・動き出している人を上げる
function leadScore(ins) {
  let s = 0;
  if (!ins.is_seeker) s -= 100;
  if (!isSupported(ins)) s -= 60;
  if (ins.openness === "closed") s -= 40;
  if (ins.distress && ins.distress !== "none") s -= 30;
  if (ins.openness === "open") s += 20;
  if (ins.stage === "活動中" || ins.stage === "内定・退職決定") s += 15;
  else if (ins.stage === "考え中") s += 5;
  if (SUPPORTED_WORK.includes(ins.work_style)) s += 10;
  return s;
}

// プロフィール（自己紹介・リンク・フォロワー数）。Instagram のリンクは目立たせる
function profileHtml(p) {
  const urls = new Set();
  const collect = v => {
    if (!v) return;
    if (typeof v === "string") { (v.match(/https?:\/\/[^\s"'<>]+/g) || []).forEach(u => urls.add(u)); return; }
    if (Array.isArray(v)) { v.forEach(collect); return; }
    if (typeof v === "object") Object.values(v).forEach(collect);
  };
  collect(p.bio_links);
  collect(p.biography);
  const igHandle = (String(p.biography || "").match(/(?:instagram|インスタ|insta|IG)\s*[:：]?\s*@([A-Za-z0-9._]{2,30})/i) || [])[1];
  if (igHandle) urls.add(`https://www.instagram.com/${igHandle}/`);
  const links = [...urls].map(u => {
    const ig = /instagram\.com/i.test(u);
    return `<a href="${esc(u)}" target="_blank" rel="noopener" class="${ig ? "ig" : ""}">${ig ? "Instagram：" : ""}${esc(u.replace(/^https?:\/\//, "").slice(0, 60))}</a>`;
  }).join("");
  return `<div class="profile">
    <div><b>プロフィール</b>${p.follower_count != null ? `　フォロワー ${Number(p.follower_count).toLocaleString()}` : ""}${urls.size ? "" : "　ほかの連絡先：なし"}</div>
    ${p.biography ? `<div class="bio">${esc(String(p.biography).slice(0, 240))}</div>` : `<div class="bio">（自己紹介なし）</div>`}
    ${links ? `<div class="links">${links}</div>` : ""}
  </div>`;
}

// 「プロフィール」ボタン：保存済みならクレジットを使わず、無ければ1クレジットで取る
async function onProfileClick(ev) {
  const btn = ev.target.closest(".check-profile");
  if (!btn) return;
  const card = btn.closest(".card");
  btn.disabled = true; btn.textContent = "取得中…";
  try {
    const { profile } = await api("/api/profile", { username: card.dataset.username });
    const old = card.querySelector(".profile");
    if (old) old.remove();
    card.querySelector("p").insertAdjacentHTML("beforebegin", profileHtml(profile));
    btn.remove();
    refreshUsage();
  } catch (e) {
    btn.disabled = false; btn.textContent = "プロフィール（1クレジット）";
    alertInline(btn.parentElement, e.status === 429 ? "今日の上限に達しました" : "取得できませんでした");
  }
}
$("results").addEventListener("click", onProfileClick);
$("list").addEventListener("click", onProfileClick);
