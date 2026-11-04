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
  const likesRaw = $("maxLikes").value.trim();
  const maxLikes = likesRaw === "" ? null : clampInt(likesRaw, 0, 1e7, null);
  const want = clampInt($("want").value, 1, 10, 10); $("want").value = want;
  return {
    keywords: parseKeywords($("q").value), days, maxReplies, maxLikes, want,
    noVendor: $("noVendor").checked, onlyNew: $("onlyNew").checked,
    vendorWords: parseKeywords($("vendorWords").value)
  };
}
function updateEstimate() {
  $("estimate").textContent = (PAGE_SIZE * MAX_PAGES * 2).toLocaleString();
}
["days", "maxReplies", "maxLikes", "want"].forEach(id => $(id).addEventListener("change", updateEstimate));
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
    ["削除済みを除外", count("deleted")], ["件数超えを除外", count("replies")], ["使ったクレジット", stats.credits],
    ...(stats.since ? [["取得した範囲", `${fmtTime(stats.since)} 以降`]] : [])
  ].map(([k, v]) => `<span class="s">${k}<b>${v}</b></span>`).join("");
  $("summary").hidden = false;

  $("results").innerHTML = shown.length ? shown.map(({ post, user, verified }) => `
    <article class="card" data-code="${esc(post.code)}">
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
        <span>${verified ? `<span class="pill">表示確認済</span> ` : `<button type="button" class="check-live">削除を確認（3クレジット）</button>`}<a href="${esc(threadsUrl(post, user))}" target="_blank" rel="noopener">Threadsで開く</a></span>
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
    btn.closest(".card").classList.toggle("done", next !== "new");
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
      post: { code: post.code, url: threadsUrl(post, user), caption: post.caption, posted_at: post.post_timestamp, username: user && user.username, full_name: user && user.full_name }
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
  if (t.dataset.view === "list") loadList();
}));

let listStatus = "";
document.querySelectorAll("#listFilter .chip-btn").forEach(c => c.addEventListener("click", () => {
  document.querySelectorAll("#listFilter .chip-btn").forEach(x => x.setAttribute("aria-pressed", String(x === c)));
  listStatus = c.dataset.status;
  loadList();
}));

async function loadList() {
  const st = $("listStatus");
  if (!hasDb) { st.className = "status warn"; st.textContent = "データベースが設定されていないため、候補一覧は使えません。"; st.hidden = false; $("list").innerHTML = ""; return; }
  st.className = "status info"; st.textContent = "読み込み中…"; st.hidden = false;
  try {
    const { items } = await api("/api/candidates" + (listStatus ? `?status=${listStatus}` : ""));
    st.hidden = true;
    $("list").innerHTML = items.length ? items.map(c => `
      <article class="card${["skip", "vendor"].includes(c.status) ? " done" : ""}" data-code="${esc(c.code)}">
        <div class="head">
          <span class="who">@${esc(c.username || "—")}${c.authors && c.authors.full_name ? `<small>${esc(c.authors.full_name)}</small>` : ""}</span>
          <span class="when">${c.posted_at ? fmtTime(Date.parse(c.posted_at) / 1000) + " 投稿" : ""}</span>
        </div>
        <p>${esc(c.caption)}</p>
        <div class="cand-meta">
          <span class="actions" data-code="${esc(c.code)}">
            <button type="button" class="act" data-set="skip" aria-pressed="${c.status === "skip"}">対象外</button>
            <button type="button" class="act" data-set="vendor" aria-pressed="${c.status === "vendor"}">業者</button>
          </span>
          <span>見つけた日 ${fmtTime(Date.parse(c.found_at) / 1000)}</span>
          <a href="${esc(threadsUrl({ code: c.code, url: c.url }, c.username ? { username: c.username } : null))}" target="_blank" rel="noopener">Threadsで開く</a>
          <span class="saved" hidden>保存しました</span>
        </div>
        <textarea class="cand-note" aria-label="メモ" placeholder="メモ（やり取りの内容など）">${esc(c.note || "")}</textarea>
      </article>`).join("")
      : `<div class="empty">この条件の候補はまだありません。検索すると、表示した投稿がここに入ります。</div>`;
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
        if (f.maxLikes != null && (it.post.like_count || 0) > f.maxLikes) { excluded.push({ it, tag: "replies", label: "いいね数", why: `いいね${it.post.like_count}件` }); continue; }
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
        if (st) excluded.push({ it, tag: "dup", label: "登録済み", why: `候補一覧に登録済み（${STATUS_LABEL[st] || st}）` });
        else if (sk === "deleted") excluded.push({ it, tag: "deleted", label: "削除済み", why: "前回の確認で削除済み" });
        else if (f.noVendor && (sk === "vendor" || (uname && vendorSet.has(uname)))) excluded.push({ it, tag: "vendor", label: "業者", why: sk === "vendor" ? "前回の確認で業者と判定" : "業者として登録済みの投稿者" });
        else if (shown.length < f.want) shown.push({ post: it.post, user: it.user, verified: false });
      }
      if (overReplies || items.length < PAGE_SIZE) break;
    }
    hideStatus();
    render(shown, excluded, { credits, fetched, total, since });
    saveSearch(f, shown, excluded, [], { credits, fetched });
    refreshUsage();
  } catch (e) {
    if (e.status === 401) { showApp(false); return; }
    showStatus("bad", `<div><b>検索できませんでした。</b>${esc(e.message)}</div>`);
    if (credits) render(shown, excluded, { credits, fetched, total, since });
    refreshUsage();
  }
}

// カードの「削除を確認」：その投稿だけ存在確認（3クレジット）
$("results").addEventListener("click", async ev => {
  const btn = ev.target.closest(".check-live");
  if (!btn) return;
  const card = btn.closest(".card");
  btn.disabled = true; btn.textContent = "確認中…";
  try {
    const p = await api("/api/live", { codes: [card.dataset.code] });
    const r = (p.content || [])[0];
    const pill = document.createElement("span");
    if (r && r.success) {
      pill.className = "pill"; pill.textContent = "表示確認済";
      const strongs = card.querySelectorAll(".metrics strong");
      if (strongs[0] && r.post) strongs[0].textContent = r.post.reply_count ?? strongs[0].textContent;
      if (strongs[1] && r.post) strongs[1].textContent = r.post.like_count ?? strongs[1].textContent;
    } else {
      pill.className = "pill gone"; pill.textContent = "削除済み";
      card.classList.add("done");
    }
    btn.replaceWith(pill);
    pill.insertAdjacentText("afterend", " ");
    refreshUsage();
  } catch (e) {
    btn.disabled = false; btn.textContent = "削除を確認（3クレジット）";
    alertInline(btn.parentElement, e.status === 429 ? "今日の上限に達しました" : "確認できませんでした");
  }
});
