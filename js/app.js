import { normIsbn, fmtIsbn, isbnRegion } from "./isbn.js?v=20261122060207";
import { DEWEY, parseDewey, pad3 } from "./dewey.js?v=20261122060207";
import { lookupIsbn, translateWord } from "./api.js?v=20261122060207";
import { createStore, demoStore } from "./store.js?v=20261122060207";
import { createFlow } from "./flow.js?v=20261122060207";
import { CCL, parseCcl, deweyToCcl, deweyMainToCclMain, cclMainName, cclName, shelfOf, classOf, classSortKey, subjectColors } from "./classify.js?v=20261122060207";

const APP_VERSION = "20261122060207";
// 開啟時比對伺服器上的版本；有新版就重新整理一次（每個版本最多一次，避免迴圈）
fetch("version.json", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(j => {
  if (!j || j.v === APP_VERSION || APP_VERSION === "dev") return;
  try { if (sessionStorage.getItem("reloadedFor") === j.v) return; sessionStorage.setItem("reloadedFor", j.v); } catch { return; }
  location.reload();
}).catch(() => {});

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const icon = n => `<svg><use href="#i-${n}"/></svg>`;
const LANGS = [["zh", "中文"], ["en", "英文"], ["ja", "日文"], ["other", "其他"]];
const STATUS = [["want", "想讀"], ["reading", "閱讀中"], ["done", "讀完"]];
const MAX_PAGES = 999;
let restoringFocus = false;
const deweyName = m => (m == null ? "未分類" : DEWEY.find(d => d.c === m)?.name || "");

// 沒有封面圖時的書封配色：依分類主題取色（低彩度），見 classify.js
const pal = b => [...subjectColors(b), "#fff"];
// 筆記摺疊：超過這個字數就收起來
const NOTE_CLIP = { shelf: 30, notes: 50 };

const S = { ready: false, books: [], words: [], selId: null, group: null, filter: "all", openNotes: new Set(), wFilter: "all", auth: null, view: "shelf", wordMsg: null, sig: "" };
let store = null;

/* ───────── 提示 ───────── */
let toastT = 0;
function toast(msg, err = false) {
  const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", err); t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), err ? 5000 : 2600);
}
const save = async (fn, msg) => { try { await fn(); if (msg) toast(msg); } catch (e) { console.error(e); toast("儲存失敗：" + (e.code || e.message), true); } };
const strip = ({ id, ...r }) => r;
const book = id => S.books.find(b => b.id === id);
const pct = b => (b.pages ? Math.min(100, Math.round(((b.current || 0) / b.pages) * 100)) : 0);
// 只有「確定是雲端模式且確定沒登入」才算未登入；登入狀態還沒回來時視為載入中
const gated = () => store?.mode === "cloud" && S.auth?.mode === "cloud" && !S.auth.user;
const canWrite = () => store && !gated();

/* ───────── 分類：中文書用中文圖書分類法、英文書用杜威（見 classify.js） ───────── */
const inGroup = () => S.books.filter(b => shelfOf(b) === S.group);
const keyOf = b => classOf(b).main ?? -1;
const labelOf = k => k === -1 ? "未分類" : `${pad3(k)} ${S.group === "zh" ? cclMainName(k) : deweyName(k)}`;
const sortKey = b => classSortKey(b);
const visible = () => inGroup().filter(b => S.filter === "all" || keyOf(b) === S.filter);
// 分類文字：「873 英國文學」＋是否推算
const classText = (b, { long = false } = {}) => {
  const c = classOf(b);
  if (c.main == null) return "未分類";
  return `<b>${esc(c.number || pad3(c.main))}</b> ${esc(c.name)}${c.guessed ? (long ? `（${esc(c.from || "推算")}）` : "（推算）") : ""}`;
};

function renderToolbar() {
  // 第一次拿到資料時，預設打開有書的那一櫃（中文書優先）
  if (!S.group) S.group = S.books.some(b => shelfOf(b) === "zh") || !S.books.length ? "zh" : "en";
  const books = inGroup(), counts = new Map();
  books.forEach(b => counts.set(keyOf(b), (counts.get(keyOf(b)) || 0) + 1));
  if (S.filter !== "all" && !counts.has(S.filter)) S.filter = "all";
  const keys = [...counts.keys()].sort((a, b) => (a === -1 ? 1e4 : a) - (b === -1 ? 1e4 : b));
  const all = [["all", "全部", books.length], ...keys.map(k => [k, labelOf(k), counts.get(k)])];
  $("#chips").innerHTML = gated() ? "" : all.map(([k, l, n], i) => `<button class="chip" data-i="${i}" aria-pressed="${S.filter === k}">${esc(l)}<em>${n}</em></button>`).join("");
  $("#chips").onclick = e => {
    const c = e.target.closest("[data-i]"); if (!c) return;
    const i = +c.dataset.i; S.filter = all[i][0]; renderToolbar(); renderShelf(true);
  };
  document.querySelectorAll("#grouping button").forEach(b => {
    b.setAttribute("aria-pressed", b.dataset.g === S.group);
    b.querySelector("em").textContent = S.books.filter(x => shelfOf(x) === b.dataset.g).length;
  });
  $("#grouping").hidden = gated();
  $("#demoBar").innerHTML = store?.mode === "demo" ? `<span class="demo-pill">範例模式<span class="long">・資料只存在這台裝置</span><button class="btn btn-sm" data-act="exitDemo">結束</button></span>` : "";
}
$("#grouping").onclick = e => {
  const b = e.target.closest("[data-g]"); if (!b) return;
  S.group = b.dataset.g; S.filter = "all"; renderToolbar(); renderShelf(true);
};

/* ───────── 書架（cover flow） ───────── */
const flow = createFlow($("#flow"), {
  onIndex: i => { const b = visible()[i]; if (b) { S.selId = b.id; renderCaption(b); } },
  onSettle: i => { const b = visible()[i]; if (b) { S.selId = b.id; renderDetail(); } if (jumpPending) jumpToWork(); },
  // 點書本：翻到那本，停穩後自動捲到「查生詞／閱讀筆記」
  onActivate: (i, centered) => { jumpPending = true; if (centered) jumpToWork(); }
});
let jumpPending = false;
function jumpToWork() {
  jumpPending = false;
  const wide = matchMedia("(min-width: 961px)").matches;
  // 寬螢幕兩欄並排，捲到詳情頂端兩塊都看得到；窄螢幕直接捲到查生詞（英文書）或筆記
  const target = wide ? $("#detail") : ($("#fWord") || $("#fNote"))?.closest(".card");
  target?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function coverNode(b) {
  const el = document.createElement("div");
  el.className = "book";
  const [c1, c2, fg] = pal(b);
  el.innerHTML = `<div class="cover" style="background:linear-gradient(150deg,${c1},${c2});color:${fg}">
    <div class="t">${esc(b.title)}</div><div class="rule"></div><div class="a">${esc(b.author || "")}</div>
    ${b.cover ? `<img src="${esc(b.cover)}" alt="" draggable="false" referrerpolicy="no-referrer">` : ""}
    <div class="p"${b.pages ? "" : " hidden"}><i style="width:${pct(b)}%"></i></div></div>`;
  const img = el.querySelector("img");
  if (img) {
    img.addEventListener("error", () => img.remove());
    img.addEventListener("load", () => { if (img.naturalWidth < 10) img.remove(); });   // Open Library 沒封面時給 1×1
  }
  return el;
}

function renderShelf(reset = false) {
  const msg = $("#stageMsg"), list = visible();
  const showFlow = S.ready && !gated() && list.length > 0;
  $("#flowNav").hidden = !showFlow;
  $("#flow").hidden = !showFlow;
  if (!S.ready && !gated()) {
    msg.hidden = false; $("#flowNav").hidden = true; $("#flow").hidden = true;
    msg.innerHTML = `<div class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></div><p>正在打開你的書櫃</p>`;
    flow.setItems([]); S.sig = ""; renderDetail(); return;
  }
  if (gated()) {
    msg.hidden = false;
    msg.innerHTML = `<h2>登入，打開你的書櫃</h2><p>書、閱讀筆記和單字會存在你自己的帳號裡，換裝置也看得到。</p>
      <div class="row"><button class="btn accent" data-act="signin">以 Google 帳號登入</button><button class="btn" data-act="demo">先用範例書看看</button></div>`;
    flow.setItems([]); S.sig = ""; renderDetail(); return;
  }
  if (!list.length) {
    msg.hidden = false;
    const other = S.group === "zh" ? "英文書" : "中文書";
    msg.innerHTML = !S.books.length
      ? `<h2>書櫃還是空的</h2><p>輸入 ISBN，書名、作者、封面和分類會自動帶入。中文書用中文圖書分類法，英文書用杜威分類法。</p>`
      : !inGroup().length
      ? `<h2>還沒有${S.group === "zh" ? "中文書" : "英文書"}</h2><p>你的書目前都在「${other}」。</p><div class="row"><button class="btn" data-g-switch="${S.group === "zh" ? "en" : "zh"}">看${other}</button></div>`
      : `<h2>這個分類還沒有書</h2><p>換個分類看看，或新增一本。</p>`;
    if (!S.books.length) msg.innerHTML += `<div class="row"><button class="btn accent" data-act="add">${icon("plus")}新增第一本書</button></div>`;
    flow.setItems([]); S.sig = ""; renderDetail(); return;
  }
  msg.hidden = true;
  // 書的順序和封面沒變時只更新進度，避免重建 DOM 造成閃爍
  const sig = list.map(b => b.id + "|" + b.cover + "|" + b.title + "|" + pal(b)[0]).join("¦");
  if (!reset && sig === S.sig) {
    flow.update((nd, i) => { const p = nd.querySelector(".p"), b = list[i]; p.hidden = !b.pages; p.firstElementChild.style.width = pct(b) + "%"; });
    renderCaption(list[flow.index]); renderDetail(); return;
  }
  S.sig = sig;
  const keep = Math.max(0, list.findIndex(b => b.id === S.selId));
  flow.setItems(list.map(coverNode), keep);
}

function renderCaption(b) {
  if (!b) { $("#cap").innerHTML = ""; return; }
  const list = visible(), i = list.indexOf(b);
  $("#cap").innerHTML = `<h2>${esc(b.title)}</h2><p>${b.author ? `<span class="by">${esc(b.author)}・</span>` : ""}${classText(b)}・${i + 1} / ${list.length}</p>`;
}
$("#prev").onclick = () => flow.go(-1);
$("#next").onclick = () => flow.go(1);


/* ───────── 書的詳情 ───────── */
// 進度圓環：卡片表面刻出一圈凹槽，橘色弧直接填在凹槽裡，弧尾是一顆在槽裡滾動的立體球
const RING = { c: 74, r: 65 };                       // 148×148，凹槽寬 18px，中心線半徑 65
const CIRC = 2 * Math.PI * RING.r;
const ringPath = `M${RING.c} ${RING.c - RING.r} A${RING.r} ${RING.r} 0 1 1 ${RING.c} ${RING.c + RING.r} A${RING.r} ${RING.r} 0 1 1 ${RING.c} ${RING.c - RING.r}`;
function ring(b) {
  const p = pct(b);
  return `<div class="ring" role="img" aria-label="閱讀進度 ${p}%" style="--a:${p * 3.6}deg">
    <svg viewBox="0 0 148 148" aria-hidden="true">
      <defs>
        <linearGradient id="ringGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="148" y2="148"><stop offset="0" stop-color="#ffa47a"/><stop offset=".5" stop-color="#f2632b"/><stop offset="1" stop-color="#d9501c"/></linearGradient>
        <radialGradient id="ringBall" cx=".34" cy=".3" r=".8"><stop offset="0" stop-color="#ffc3a3"/><stop offset=".25" stop-color="#ff9466"/><stop offset=".62" stop-color="#f2632b"/><stop offset="1" stop-color="#c9461a"/></radialGradient>
      </defs>
      <path class="arc" d="${ringPath}" stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="${(CIRC * (1 - p / 100)).toFixed(2)}" style="opacity:${p ? 1 : 0}"/>
      <g class="knob"><circle cx="${RING.c}" cy="${RING.c - RING.r}" r="8" fill="url(#ringBall)"/></g>
    </svg>
    <div class="num"><b>${p}<span style="font-size:15px">%</span></b><small>${b.pages ? `共 ${b.pages} 頁` : "未填頁數"}</small></div></div>`;
}
function setRing(p) {
  const r = $(".ring"); if (!r) return;
  r.style.setProperty("--a", `${p * 3.6}deg`);
  r.setAttribute("aria-label", `閱讀進度 ${p}%`);
  const arc = r.querySelector(".arc"); arc.style.opacity = p ? 1 : 0; arc.setAttribute("stroke-dashoffset", (CIRC * (1 - p / 100)).toFixed(2));
  r.querySelector(".num b").innerHTML = `${p}<span style="font-size:15px">%</span>`;
}

/**
 * 筆記內文：超過 limit 個字就收起來，可點「展開全文」。
 * q：搜尋字（筆記頁用）；命中的字落在被收起的部分時自動展開。mark：把文字轉成 HTML（含搜尋高亮）的函式。
 */
function noteBody(n, limit, q = "", mark = esc) {
  const chars = Array.from(n.text || "");
  const long = chars.length > limit;
  const hitAt = q ? Array.from(n.text.toLowerCase().slice(0, Math.max(0, n.text.toLowerCase().indexOf(q)))).length : -1;
  const autoOpen = q && n.text.toLowerCase().includes(q) && hitAt + Array.from(q).length > limit;
  const key = `${S.view}:${n.id}`;   // 書櫃與筆記頁各自記住展開狀態
  const open = !long || S.openNotes.has(key) || autoOpen;
  const shown = open ? n.text : chars.slice(0, limit).join("") + "…";
  const btn = long && !autoOpen
    ? `<button type="button" class="more" data-note-toggle="${key}" aria-expanded="${open}">${open ? "收合" : `展開全文・共 ${chars.length} 字`}</button>` : "";
  return `<p>${mark(shown)}</p>${btn}`;
}

function renderDetail() {
  const el = $("#detail"), b = book(S.selId);
  if (gated() || !b || !visible().includes(b)) { el.innerHTML = ""; return; }
  // 正在輸入時（筆記草稿、查詢中的單字）不要整塊重繪
  const draft = $("#nText")?.value, wDraft = $("#wIn")?.value, sameBook = el.dataset.id === b.id;
  const focusId = el.contains(document.activeElement) ? document.activeElement.id : "";
  el.dataset.id = b.id;
  const ws = S.words.filter(w => w.bookId === b.id);
  const st = b.status || "want";
  el.innerHTML = `
  <div>
    <div class="card">
      <div class="card-head"><h3>閱讀進度</h3><button class="btn-round icon-btn" data-act="edit" aria-label="編輯書籍資料" title="編輯書籍資料">${icon("edit")}</button></div>
      <div class="progress">
        ${ring(b)}
        <div class="prog-side">
          <div class="stepper">
            <button class="btn-round icon-btn" data-step="-1" aria-label="少一頁">${icon("minus")}</button>
            <input class="field pg-num" id="cur" type="text" inputmode="numeric" maxlength="3" autocomplete="off" value="${b.current || 0}" aria-label="讀到第幾頁">
            <button class="btn-round icon-btn" data-step="1" aria-label="多一頁">${icon("plus")}</button>
            <span>頁</span>
          </div>
          <div class="seg seg-sm" role="group" aria-label="閱讀狀態">${STATUS.map(([v, l]) => `<button data-status="${v}" aria-pressed="${st === v}">${l}</button>`).join("")}</div>
        </div>
      </div>
      <dl class="meta">
        <dt>作者</dt><dd>${esc(b.author || "—")}</dd>
        <dt>${classOf(b).sysName}</dt><dd>${classText(b, { long: true })}</dd>
        <dt>ISBN</dt><dd>${fmtIsbn(b.isbn)}${b.isbn ? `・${esc(isbnRegion(b.isbn))}出版` : ""}</dd>
        ${b.publisher ? `<dt>出版</dt><dd>${esc(b.publisher)} ${esc(String(b.published || "").match(/\d{4}/)?.[0] || "")}</dd>` : ""}
      </dl>
    </div>
    ${b.lang === "en" ? `
    <div class="card">
      <div class="card-head"><h3>查生詞</h3></div>
      <form class="lookup" id="fWord"><input class="field" id="wIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="輸入不會的英文單字" aria-label="英文單字"><button class="btn accent">${icon("search")}查詢</button></form>
      <div id="wResult"></div>
      <div class="foot-link"><span>這本書收集了 ${ws.length} 個生詞</span>${ws.length ? `<button class="btn btn-sm" data-act="toWords">到單字本複習</button>` : ""}</div>
    </div>` : ""}
  </div>
  <div class="card">
    <div class="card-head"><h3>閱讀筆記</h3><span class="muted" style="font-size:13px">${(b.notes || []).length} 則</span></div>
    <form class="composer" id="fNote">
      <textarea class="field" id="nText" placeholder="這一段讓你想到什麼？" aria-label="筆記內容"></textarea>
      <div class="composer-row">
        <label class="page-in">第<input class="pg-num" id="nPage" type="text" inputmode="numeric" maxlength="3" autocomplete="off" value="${b.current || ""}" aria-label="頁碼">頁</label>
        <button class="btn accent">加入筆記</button>
      </div>
    </form>
    <ul class="notes">${(b.notes || []).slice().reverse().map(n => `<li class="note"><header>${n.page ? `<span class="pg">p.${esc(n.page)}</span>` : ""}<span>${esc(n.at)}</span></header>${noteBody(n, NOTE_CLIP.shelf)}<button class="btn-round icon-btn del" data-del-note="${n.id}" aria-label="刪除這則筆記">${icon("x")}</button></li>`).join("") || '<li class="empty-line">還沒有筆記。</li>'}</ul>
  </div>`;
  if (sameBook) {
    if (draft) $("#nText").value = draft;
    if (wDraft && $("#wIn")) $("#wIn").value = wDraft;
    if (focusId === "cur" && progVal != null) $("#cur").value = progVal;
    const f = focusId && document.getElementById(focusId);
    if (f) {                                   // 重繪後把游標放回原位（不要觸發「點一下全選」）
      restoringFocus = true; f.focus({ preventScroll: true }); restoringFocus = false;
      if (f.type === "text" || f.tagName === "TEXTAREA") { const n = f.value.length; f.setSelectionRange(n, n); }
    }
  }
  if (S.wordMsg?.bookId === b.id) showWord(S.wordMsg.word);
  $("#fNote").onsubmit = e => {
    e.preventDefault();
    const txt = $("#nText").value.trim(); if (!txt) return $("#nText").focus();
    $("#nText").value = "";
    save(() => store.putBook(b.id, strip({ ...b, notes: [...(b.notes || []), { id: uid(), page: $("#nPage").value, text: txt, at: today() }] })), "已加入筆記");
  };
  $("#fWord")?.addEventListener("submit", e => { e.preventDefault(); lookupWord(b); });
  const cur = $("#cur");
  cur.addEventListener("input", () => queueProgress(b.id, +cur.value, false));
}

// 進度：連按 +/− 時只在停手後寫一次
let progT = 0, progVal = null;
function queueProgress(id, v, writeBack = true) {
  const b = book(id); if (!b) return;
  v = Math.min(MAX_PAGES, Math.max(0, Math.round(v || 0))); if (b.pages) v = Math.min(v, b.pages);
  progVal = v; if (writeBack) $("#cur").value = v;
  const p = b.pages ? Math.round(v / b.pages * 100) : 0;
  setRing(p);
  clearTimeout(progT);
  progT = setTimeout(() => {
    const cur = book(id); if (!cur || cur.current === progVal) return;
    const status = cur.pages && progVal >= cur.pages ? "done" : progVal > 0 && (cur.status || "want") === "want" ? "reading" : cur.status || "want";
    save(() => store.putBook(id, strip({ ...cur, current: progVal, status })));
  }, 600);
}

/* ───────── 生詞 ───────── */
async function lookupWord(b) {
  const inp = $("#wIn"), w = inp.value.trim();
  if (!w) return inp.focus();
  const dup = S.words.find(x => x.word.toLowerCase() === w.toLowerCase());
  if (dup) { S.wordMsg = { bookId: b.id, word: dup }; showWord(dup); toast("這個字已經在單字本裡了"); return; }
  const btn = $("#fWord .btn"); btn.disabled = true;
  try {
    const r = await translateWord(w);
    if (!r) { toast("查不到這個字，請檢查拼字", true); return; }
    const doc = { ...r, bookId: b.id, at: new Date().toISOString(), score: 0 };
    S.wordMsg = { bookId: b.id, word: doc };
    inp.value = ""; showWord(doc);
    await save(() => store.putWord("w_" + uid(), doc), r.zh ? "已加入單字本" : "已加入單字本（暫時查不到中文翻譯）");
  } catch (e) { console.error(e); toast("查詢失敗，請確認網路後再試一次", true); }
  finally { if ($("#fWord .btn")) $("#fWord .btn").disabled = false; }
}
function showWord(w) {
  const r = $("#wResult"); if (!r) return;
  r.innerHTML = `<div class="word-card"><div class="hw"><b>${esc(w.word)}</b><span>${esc(w.phonetic)}</span><span>${esc(w.pos)}</span>
    ${w.audio ? `<button class="btn-round icon-btn" data-audio="${esc(w.audio)}" aria-label="播放發音" style="margin-left:auto">${icon("sound")}</button>` : ""}</div>
    <p class="zh">${esc(w.zh || "—")}</p><p class="def">${esc(w.def)}</p>${w.example ? `<p class="ex">${esc(w.example)}</p>` : ""}</div>`;
}

/* ───────── 單字本 ───────── */
function renderWords() {
  const has = S.books.filter(b => S.words.some(w => w.bookId === b.id));
  if (S.wFilter !== "all" && !has.some(b => b.id === S.wFilter)) S.wFilter = "all";
  $("#wFilter").innerHTML = '<option value="all">全部書籍</option>' + has.map(b => `<option value="${b.id}"${S.wFilter === b.id ? " selected" : ""}>${esc(b.title)}</option>`).join("");
  const list = gated() ? [] : S.words.filter(w => S.wFilter === "all" || w.bookId === S.wFilter);
  const known = list.filter(w => (w.score || 0) >= 3).length;
  $("#wCount").textContent = list.length ? `${list.length} 個單字・${known} 個已熟記` : "";
  $("#reviewBtn").disabled = $("#exportBtn").disabled = !list.length;
  $("#wGrid").innerHTML = gated() ? `<div class="words-empty"><b>登入後就能看到你的單字本</b></div>`
    : list.map(w => `<article class="wtile">
      <div class="hw"><b>${esc(w.word)}</b></div>
      <div class="ph">${esc(w.phonetic)} ${esc(w.pos)}</div>
      <div class="zh">${esc(w.zh || "—")}</div>
      <div class="def">${esc(w.def)}</div>
      <footer><span>${esc(book(w.bookId)?.title || "")}</span><span class="dots" aria-label="熟練度 ${Math.min(3, w.score || 0)} / 3">${[0, 1, 2].map(i => `<i class="${i < (w.score || 0) ? "on" : ""}"></i>`).join("")}</span></footer>
      <button class="btn-round icon-btn del" data-del-word="${w.id}" aria-label="刪除 ${esc(w.word)}">${icon("x")}</button>
    </article>`).join("") || `<div class="words-empty"><b>還沒有單字</b>在英文書的頁面查生詞，就會自動收進這裡。</div>`;
}
$("#wFilter").onchange = e => { S.wFilter = e.target.value; renderWords(); };

// 匯出 CSV（加 BOM，Excel 和 Numbers 打開中文不會亂碼）
$("#exportBtn").onclick = () => {
  const list = S.words.filter(w => S.wFilter === "all" || w.bookId === S.wFilter);
  if (!list.length) return;
  const cell = v => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["單字", "音標", "詞性", "中文", "英文釋義", "例句", "出處", "熟練度", "加入日期"];
  const rows = list.map(w => [w.word, w.phonetic, w.pos, w.zh, w.def, w.example, book(w.bookId)?.title || "", Math.min(3, w.score || 0), (w.at || "").slice(0, 10)]);
  const csv = "\ufeff" + [head, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
  const bk = S.wFilter === "all" ? "" : "-" + (book(S.wFilter)?.title || "").replace(/[\\/:*?"<>|]/g, "").slice(0, 30);
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: `閱讀誌單字本${bk}-${today()}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`已匯出 ${list.length} 個單字`);
};

/* 字卡複習 */
let deck = [], di = 0;
$("#reviewBtn").onclick = () => {
  deck = S.words.filter(w => S.wFilter === "all" || w.bookId === S.wFilter)
    .sort((a, b) => (a.score || 0) - (b.score || 0) || Math.random() - .5).slice(0, 20);
  if (!deck.length) return;
  di = 0; drawCard(); $("#dRev").showModal();
};
function drawCard() {
  const r = $("#rev");
  if (di >= deck.length) {
    r.innerHTML = `<div class="rev-done"><b>這一輪複習完了</b><p class="muted">共 ${deck.length} 個字</p></div><button class="btn accent" data-act="closeRev">完成</button>`; return;
  }
  const w = deck[di];
  r.innerHTML = `<div class="rev-top"><span>${di + 1} / ${deck.length}</span><button class="btn-round icon-btn" data-act="closeRev" aria-label="結束複習">${icon("x")}</button></div>
    <div class="rev-bar"><i style="width:${di / deck.length * 100}%"></i></div>
    <div class="flip" id="flip" tabindex="0" aria-label="點一下翻面"><div class="flip-in">
      <div class="face"><b>${esc(w.word)}</b><small>${esc(w.phonetic)}</small><small style="margin-top:14px">點一下看答案</small></div>
      <div class="face back"><div class="zh">${esc(w.zh || w.def)}</div>${w.example ? `<em>${esc(w.example)}</em>` : ""}<small>${esc(book(w.bookId)?.title || "")}</small></div>
    </div></div>
    <div class="rev-actions"><button class="btn" data-r="0">還不熟</button><button class="btn accent" data-r="1">記得</button></div>`;
}
$("#rev").addEventListener("click", e => {
  if (e.target.closest("#flip")) { $("#flip").classList.toggle("on"); return; }
  if (e.target.closest('[data-act="closeRev"]')) { $("#dRev").close(); return; }
  const r = e.target.closest("[data-r]"); if (!r) return;
  const w = deck[di], score = r.dataset.r === "1" ? Math.min(5, (w.score || 0) + 1) : 0;
  save(() => store.putWord(w.id, { ...strip(w), score }));
  di++; drawCard();
});
$("#rev").addEventListener("keydown", e => { if (e.key === " " && e.target.id === "flip") { e.preventDefault(); $("#flip").classList.toggle("on"); } });

/* ───────── 新增／編輯書籍 ───────── */
const dBook = $("#dBook");
const mainOptions = (sel, list = DEWEY) => `<option value="">未分類</option>` + list.map(d => `<option value="${d.c}"${sel === d.c ? " selected" : ""}>${pad3(d.c)} ${d.name}</option>`).join("");
/** 中文分類若是由杜威推算的，記下推算值；送出時沒改過就標成「推算」 */
let cclDerived = null;
function deriveCcl(dewey, deweyMain) {
  const d = dewey ? deweyToCcl(dewey) : null;
  if (d) return { ...d, from: `由杜威 ${dewey} 推算` };
  const m = deweyMainToCclMain(deweyMain);
  return m == null ? null : { number: "", main: m, from: "由杜威大類推算" };
}
function fillCcl(d) {
  cclDerived = d;
  $("#fCcl").value = d?.number || ""; $("#fCclMain").value = d?.main ?? "";
  showClsHint();
}
function showClsHint() {
  const h = $("#fClsHint"); if (!h) return;
  const zh = $("#fLang").value === "zh";
  const d = cclDerived, same = d && $("#fCcl").value.trim() === d.number && $("#fCclMain").value === String(d.main);
  h.textContent = zh
    ? (same ? `${d.from}，僅供參考，可以直接修改。` : "中文書使用中文圖書分類法（2007 年版）。")
    : "英文及其他外文書使用杜威十進分類法。";
}
let found = null;

function openBook(b = null) {
  if (!canWrite()) return;
  found = null;
  const f = $("#fBook");
  f.innerHTML = `
    <div class="sheet-head"><h2>${b ? "編輯書籍資料" : "新增書籍"}</h2><button type="button" class="btn-round icon-btn" data-act="closeBook" aria-label="關閉">${icon("x")}</button></div>
    ${b ? "" : `<div class="isbn-row"><input class="field" id="fIsbn" inputmode="numeric" autocomplete="off" placeholder="輸入 ISBN，例如 9789861371955" aria-label="ISBN"><button type="button" class="btn accent" id="lookup">${icon("search")}查詢</button></div>
    <p class="hint" id="isbnMsg">查不到的書也可以直接填寫下面的欄位。</p><div id="foundBox"></div>`}
    <label class="lab">書名<input class="field" id="fTitle" required value="${esc(b?.title || "")}"></label>
    <label class="lab">作者<input class="field" id="fAuthor" value="${esc(b?.author || "")}"></label>
    <div class="grid2">
      <label class="lab">語言<select class="field" id="fLang">${LANGS.map(([v, l]) => `<option value="${v}"${(b?.lang || "zh") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="lab">總頁數<input class="field pg-num pages-field" id="fPages" type="text" inputmode="numeric" maxlength="3" autocomplete="off" placeholder="最多 999" value="${b?.pages || ""}"></label>
    </div>
    <div class="grid2" id="rowCcl">
      <label class="lab">中文圖書分類號<input class="field" id="fCcl" inputmode="decimal" placeholder="例如 177.2" value=""></label>
      <label class="lab">中文分類大類<select class="field" id="fCclMain">${mainOptions(null, CCL)}</select></label>
    </div>
    <div class="grid2" id="rowDdc">
      <label class="lab">杜威號碼<input class="field" id="fDewey" inputmode="decimal" placeholder="例如 158.1" value="${esc(b?.dewey || "")}"></label>
      <label class="lab">杜威大類<select class="field" id="fMain">${mainOptions(b?.deweyMain ?? null)}</select></label>
    </div>
    <p class="hint cls-hint" id="fClsHint"></p>
    <div class="sheet-foot">
      ${b ? `<button type="button" class="btn ghost danger" data-act="delBook">移除這本書</button>` : ""}
      <span class="grow"></span>
      <button type="button" class="btn" data-act="closeBook">取消</button>
      <button class="btn accent">${b ? "儲存" : "放上書櫃"}</button>
    </div>`;
  f.dataset.id = b?.id || "";
  // 中文分類：已有就帶入；舊資料只有杜威的，先帶入推算值
  cclDerived = null;
  if (b && (b.ccl || b.cclMain != null)) {
    $("#fCcl").value = b.ccl || ""; $("#fCclMain").value = b.cclMain ?? "";
    if (b.cclGuessed) cclDerived = { number: b.ccl || "", main: b.cclMain, from: b.dewey ? `由杜威 ${b.dewey} 推算` : "由杜威大類推算" };
  } else if (b) fillCcl(deriveCcl(b.dewey, b.deweyMain));
  const syncLang = () => {
    const zh = $("#fLang").value === "zh";
    $("#rowCcl").hidden = !zh; $("#rowDdc").hidden = zh;
    if (zh && !$("#fCcl").value && !$("#fCclMain").value) fillCcl(deriveCcl($("#fDewey").value.trim(), $("#fMain").value === "" ? null : +$("#fMain").value));
    showClsHint();
  };
  $("#fLang").onchange = syncLang;
  $("#fCcl").oninput = () => { const c = parseCcl($("#fCcl").value); if (c) $("#fCclMain").value = c.main; showClsHint(); };
  $("#fCclMain").onchange = showClsHint;
  $("#fDewey").oninput = () => { const d = parseDewey($("#fDewey").value); if (d) $("#fMain").value = d.main; };
  syncLang();
  dBook.showModal();
  if (!b) {
    const isbn = $("#fIsbn");
    isbn.focus();
    isbn.oninput = () => {
      const v = isbn.value.trim(), n = normIsbn(v);
      $("#isbnMsg").textContent = !v ? "查不到的書也可以直接填寫下面的欄位。" : n ? `有效的 ISBN（${isbnRegion(n)}出版），按「查詢」自動帶入資料。` : "ISBN 格式或檢查碼不正確。";
    };
    isbn.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("#lookup").click(); } };
    $("#lookup").onclick = doLookup;
  }
}

async function doLookup() {
  const n = normIsbn($("#fIsbn").value), msg = $("#isbnMsg"), btn = $("#lookup");
  if (!n) { msg.textContent = "請先輸入有效的 ISBN。"; return; }
  msg.textContent = "查詢中…"; btn.disabled = true;
  try {
    const r = await lookupIsbn(n);
    if (!r) { msg.textContent = "Open Library 查不到這本書，請手動填寫。"; return; }
    found = { ...r, isbn: n };
    $("#fTitle").value = r.title; $("#fAuthor").value = r.author;
    if (r.pages) $("#fPages").value = Math.min(r.pages, MAX_PAGES);
    $("#fLang").value = r.lang; $("#fDewey").value = r.dewey; $("#fMain").value = r.deweyMain ?? "";
    fillCcl(deriveCcl(r.dewey, r.deweyMain));
    $("#fLang").onchange();
    $("#foundBox").innerHTML = `<div class="found">${r.cover ? `<img src="${esc(r.cover)}" alt="" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}
      <div><b>${esc(r.title)}</b><span>${esc(r.author || "")}${r.publisher ? "・" + esc(r.publisher) : ""}</span></div></div>`;
    const im = $("#foundBox img"); if (im) im.onerror = () => { im.replaceWith(Object.assign(document.createElement("span"), { className: "ph" })); };
    if (r.lang === "zh") {
      const c = cclDerived;
      msg.textContent = c?.number ? `已帶入資料；中文分類號 ${c.number}（${cclName(c.number, c.main)}）由杜威號碼推算。`
        : c ? `已帶入資料；依主題推算為「${cclMainName(c.main)}」，可以再調整。` : "已帶入資料；查不到分類，請自行選擇中文分類大類。";
    } else msg.textContent = r.dewey ? `杜威號碼 ${r.dewey}：${deweyName(r.deweyMain)}` : r.deweyMain != null ? `沒有正式杜威號碼，依主題推測為「${deweyName(r.deweyMain)}」，可以再調整。` : "查不到杜威分類，請自行選擇大類。";
  } catch (e) { console.error(e); msg.textContent = "連不上書籍資料庫，請確認網路，或先手動填寫。"; }
  finally { btn.disabled = false; }
}

$("#fBook").addEventListener("submit", async e => {
  e.preventDefault();
  const id = $("#fBook").dataset.id, old = id ? book(id) : null;
  const title = $("#fTitle").value.trim();
  if (!title) { $("#fTitle").focus(); return; }
  const zh = $("#fLang").value === "zh";
  const raw = $("#fDewey").value.trim(), dd = parseDewey(raw);
  if (!zh && raw && !dd) { toast("杜威號碼格式不正確，例如 158.1", true); $("#fDewey").focus(); return; }
  const cRaw = $("#fCcl").value.trim(), cc = parseCcl(cRaw);
  if (zh && cRaw && !cc) { toast("中文圖書分類號格式不正確，例如 177.2", true); $("#fCcl").focus(); return; }
  const cSel = $("#fCclMain").value, cMain = cc ? cc.main : cSel === "" ? null : +cSel;
  const cGuessed = !!cclDerived && (cc?.number || "") === cclDerived.number && cMain === cclDerived.main;
  const sel = $("#fMain").value, main = dd ? dd.main : sel === "" ? null : +sel;
  let isbn = old?.isbn || null;
  if (!old) {
    const v = $("#fIsbn").value.trim(); isbn = v ? normIsbn(v) : null;
    if (v && !isbn) { toast("ISBN 不正確，請修正或清空", true); return; }
    if (isbn && S.books.some(b => b.isbn === isbn)) { toast("這本書已經在書櫃上了", true); return; }
  }
  const fromLookup = found && found.isbn === isbn;
  const guessed = !old && !dd && main != null && fromLookup && found.deweyGuessed && found.deweyMain === main;
  const base = old ? strip(old) : { isbn, current: 0, status: "want", notes: [], addedAt: today(),
    cover: fromLookup ? found.cover : "", subtitle: fromLookup ? found.subtitle || "" : "", publisher: fromLookup ? found.publisher || "" : "", published: fromLookup ? found.published || "" : "" };
  const pages = Math.min(MAX_PAGES, +$("#fPages").value || 0) || null;
  const doc = { ...base, title, author: $("#fAuthor").value.trim(), pages, current: pages ? Math.min(base.current || 0, pages) : base.current || 0,
    dewey: dd?.number || "", deweyMain: main, deweyGuessed: old ? (old.deweyGuessed && old.deweyMain === main && !dd) : guessed,
    ccl: cc?.number || "", cclMain: cMain, cclGuessed: cGuessed, lang: $("#fLang").value };
  const newId = id || "b_" + uid();
  if (!old) S.selId = newId;
  dBook.close();
  await save(() => store.putBook(newId, doc), old ? "已儲存" : "已放上書櫃");
});

/* ───────── 使用者 ───────── */
function renderWho() {
  const w = $("#who"), a = S.auth;
  $("#addBtn").disabled = !canWrite();
  if (!a || gated()) { w.innerHTML = ""; return; }
  const u = a.mode === "cloud" ? a.user : null;
  const face = u?.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">`
    : u ? `<span>${esc((u.name || u.email || "?").trim()[0])}</span>` : `<span class="guest">${icon("user")}</span>`;
  w.innerHTML = `<button class="avatar" data-view="manage" aria-label="帳號與書籍管理" title="帳號與書籍管理"${S.view === "manage" ? ' aria-current="page"' : ""}>${face}</button>`;
  // 書籍管理頁頂端的帳號卡
  $("#account").innerHTML = u
    ? `<div class="acct-face">${face}</div><div class="acct-id"><b>${esc(u.name || "")}</b><span>${esc(u.email || "")}</span></div><button class="btn btn-sm" data-act="signout">${icon("out")}登出</button>`
    : `<div class="acct-face">${face}</div><div class="acct-id"><b>${a.mode === "demo" ? "範例模式" : "本機模式"}</b><span>資料只存在這台裝置</span></div>${a.mode === "demo" ? `<button class="btn btn-sm" data-act="exitDemo">${icon("out")}結束範例模式</button>` : ""}`;
}

/* ───────── 縮圖（筆記總覽、書籍管理共用） ───────── */
function thumb(b) {
  const [c1, c2, fg] = pal(b);
  return `<span class="thumb" style="background:linear-gradient(150deg,${c1},${c2});color:${fg}"><span>${esc(b.title.slice(0, 8))}</span>${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>`;
}

/* ───────── 筆記總覽：依書籍分組 ───────── */
function renderNotes() {
  const q = ($("#nSearch").value || "").trim().toLowerCase();
  const hl = t => { const e = esc(t); if (!q) return e; const qe = esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return e.replace(new RegExp(qe, "gi"), m => `<mark>${m}</mark>`); };
  const groups = S.books.map(b => {
    const hitTitle = q && (b.title.toLowerCase().includes(q) || (b.author || "").toLowerCase().includes(q));
    const notes = (b.notes || []).filter(n => !q || hitTitle || n.text.toLowerCase().includes(q));
    const last = (b.notes || []).reduce((m, n) => (n.at > m ? n.at : m), "");
    return { b, notes, last };
  }).filter(g => g.notes.length).sort((x, y) => y.last.localeCompare(x.last));
  const total = S.books.reduce((n, b) => n + (b.notes || []).length, 0);
  $("#nCount").textContent = total ? `${total} 則筆記・${S.books.filter(b => (b.notes || []).length).length} 本書` : "";
  if (gated()) { $("#nList").innerHTML = `<div class="empty-box"><b>登入後就能看到你的筆記</b></div>`; return; }
  $("#nList").innerHTML = groups.map(({ b, notes }) => `
    <article class="nbook">
      <header class="nbook-head">${thumb(b)}
        <div class="tt"><h2>${hl(b.title)}</h2><p>${hl(b.author || "")}${b.author ? "・" : ""}${(b.notes || []).length} 則筆記</p></div>
        <button class="btn btn-sm" data-open="${b.id}">寫筆記</button>
      </header>
      <ul class="notes">${notes.slice().sort((x, y) => (+y.page || 0) - (+x.page || 0) || y.at.localeCompare(x.at)).map(n => `
        <li class="note"><header>${n.page ? `<span class="pg">p.${esc(n.page)}</span>` : ""}<span>${esc(n.at)}</span></header>${noteBody(n, NOTE_CLIP.notes, q, hl)}
        <button class="btn-round icon-btn del" data-del-note="${n.id}" data-note-book="${b.id}" aria-label="刪除這則筆記">${icon("x")}</button></li>`).join("")}</ul>
    </article>`).join("")
    || (q ? `<div class="empty-box"><b>找不到符合「${esc(q)}」的筆記</b></div>` : `<div class="empty-box"><b>還沒有筆記</b>在書櫃點一本書，就可以開始寫。</div>`);
}
$("#nSearch").addEventListener("input", renderNotes);

/* ───────── 書籍管理：勾選後批次移除 ───────── */
const picked = new Set();
function manageBar() {
  const list = S.books;
  $("#mCount").textContent = list.length ? `共 ${list.length} 本${picked.size ? `・已選 ${picked.size} 本` : ""}` : "";
  const all = $("#mAll");
  all.checked = list.length > 0 && picked.size === list.length;
  all.indeterminate = picked.size > 0 && picked.size < list.length;
  all.disabled = !list.length;
  const del = $("#mDelete");
  del.disabled = !picked.size;
  del.textContent = picked.size ? `移除 ${picked.size} 本` : "移除";
}
function renderManage() {
  [...picked].forEach(id => { if (!book(id)) picked.delete(id); });
  const list = S.books.slice().sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || "") || a.title.localeCompare(b.title, "zh-Hant"));
  manageBar();
  if (gated()) { $("#mList").innerHTML = `<li class="empty-box"><b>登入後就能管理你的書</b></li>`; return; }
  $("#mList").innerHTML = list.map(b => `
    <li><label class="mrow">
      <input type="checkbox" data-pick="${b.id}" ${picked.has(b.id) ? "checked" : ""}><i class="box" aria-hidden="true"></i>
      ${thumb(b)}
      <span class="info"><b>${esc(b.title)}</b><span>${esc(b.author || "作者未填")}・${classText(b)}</span></span>
      <span class="stat"><b>${b.pages ? pct(b) + "%" : "—"}</b><span>${(b.notes || []).length} 則筆記</span></span>
    </label></li>`).join("") || `<li class="empty-box"><b>書櫃是空的</b></li>`;
}
$("#mList").addEventListener("change", e => {
  const id = e.target.dataset.pick; if (!id) return;
  e.target.checked ? picked.add(id) : picked.delete(id);
  manageBar();
});
$("#mAll").addEventListener("change", e => {
  if (e.target.checked) S.books.forEach(b => picked.add(b.id)); else picked.clear();
  document.querySelectorAll("#mList [data-pick]").forEach(i => { i.checked = picked.has(i.dataset.pick); });
  manageBar();
});
$("#mDelete").addEventListener("click", async () => {
  const btn = $("#mDelete"), n = picked.size; if (!n) return;
  const names = [...picked].map(id => book(id)?.title).filter(Boolean);
  const ok = await confirmBox(`移除 ${n} 本書？`, `${names.slice(0, 3).map(t => `《${t}》`).join("、")}${n > 3 ? ` 等 ${n} 本` : ""}。這些書的閱讀筆記會一起刪除，無法復原；單字本裡的單字會保留。`, `移除 ${n} 本`);
  if (!ok) return;
  btn.disabled = true;
  const ids = [...picked]; let done = 0;
  for (const id of ids) { try { await store.delBook(id); picked.delete(id); done++; } catch (e) { console.error(e); } }
  toast(done === ids.length ? `已移除 ${done} 本書` : `移除了 ${done} 本，${ids.length - done} 本失敗`, done !== ids.length);
  renderManage();
});

// 確認視窗：回傳 true／false
function confirmBox(title, body, ok = "移除") {
  const d = $("#dConfirm");
  $("#cTitle").textContent = title; $("#cBody").textContent = body; $("#cOk").textContent = ok;
  d.returnValue = "";
  d.showModal(); $("#cOk").focus();
  return new Promise(res => d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true }));
}

/* ───────── 全域點擊 ───────── */
document.addEventListener("click", async e => {
  const tg = e.target.closest("[data-note-toggle]");
  if (tg) {
    const id = tg.dataset.noteToggle;
    S.openNotes.has(id) ? S.openNotes.delete(id) : S.openNotes.add(id);
    if (S.view === "notes") renderNotes(); else renderDetail();
    document.querySelector(`[data-note-toggle="${id}"]`)?.focus({ preventScroll: true });
    return;
  }
  const gs = e.target.closest("[data-g-switch]");
  if (gs) { S.group = gs.dataset.gSwitch; S.filter = "all"; renderToolbar(); renderShelf(true); return; }
  const t = e.target.closest("[data-act],[data-del-note],[data-del-word],[data-step],[data-status],[data-audio],[data-view],[data-open]");
  if (!t) return;
  if (t.dataset.view) return setView(t.dataset.view);
  if (t.dataset.open) return openInShelf(t.dataset.open);
  if (t.dataset.audio) { try { await new Audio(t.dataset.audio).play(); } catch { toast("無法播放發音", true); } return; }
  const act = t.dataset.act;
  if (act === "signin") return store.signIn?.().catch(err => toast("登入失敗：" + (err.code || err.message), true));
  if (act === "signout") return store.signOut?.();
  if (act === "demo") { location.hash = "demo"; location.reload(); return; }
  if (act === "exitDemo") { store.reset?.(); history.replaceState(null, "", location.pathname); location.reload(); return; }
  if (act === "add") return openBook();
  if (act === "closeBook") return dBook.close();
  if (act === "toWords") return setView("words");
  if (t.dataset.delWord) return save(() => store.delWord(t.dataset.delWord), "已刪除");
  const b = book(t.dataset.noteBook || S.selId); if (!b) return;
  if (act === "edit") return openBook(b);
  if (act === "delBook") {
    const ok = await confirmBox(`移除《${b.title}》？`, `這本書的 ${(b.notes || []).length} 則閱讀筆記會一起刪除，無法復原；單字本裡的單字會保留。`);
    if (!ok) return;
    dBook.close(); return save(() => store.delBook(b.id), `已移除《${b.title}》`);
  }
  if (t.dataset.step) return queueProgress(b.id, (progVal ?? b.current ?? 0) + +t.dataset.step);
  if (t.dataset.status) return save(() => store.putBook(b.id, strip({ ...b, status: t.dataset.status })));
  if (t.dataset.delNote) return save(() => store.putBook(b.id, strip({ ...b, notes: (b.notes || []).filter(n => n.id !== t.dataset.delNote) })));
});
$("#addBtn").onclick = () => openBook();

// 頁數欄位：點一下（或 Tab 進來）就全選，直接輸入就會取代原本的數字；只接受 0–999
let selectOnUp = null;
document.addEventListener("focusin", e => { if (!restoringFocus && e.target.classList?.contains("pg-num")) { e.target.select(); selectOnUp = e.target; } });
document.addEventListener("mouseup", e => {           // Safari 會在 mouseup 時取消選取，所以再選一次
  if (selectOnUp && e.target === selectOnUp) { e.preventDefault(); selectOnUp.select(); }
  selectOnUp = null;
});
document.addEventListener("input", e => {
  const t = e.target; if (!t.classList?.contains("pg-num")) return;
  const v = t.value.replace(/\D/g, "").slice(0, 3);
  if (v !== t.value) t.value = v;
}, true);

function setView(v) {
  S.view = v;
  for (const [k, id] of [["shelf", "vShelf"], ["notes", "vNotes"], ["words", "vWords"], ["manage", "vManage"]]) $("#" + id).hidden = v !== k;
  document.querySelectorAll(".top .seg [data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  if (v === "manage") { picked.clear(); renderManage(); }
  renderWho();
  if (v === "notes") renderNotes();
  scrollTo({ top: 0 });
}

// 從筆記總覽回到書櫃的那本書，並捲到筆記區
function openInShelf(id) {
  if (!visible().some(b => b.id === id)) { S.filter = "all"; renderToolbar(); }
  S.selId = id; setView("shelf"); renderShelf(true);
  requestAnimationFrame(() => { jumpPending = true; jumpToWork(); setTimeout(() => $("#nText")?.focus({ preventScroll: true }), 450); });
}

/* ───────── 啟動 ───────── */
function render(reset) { renderWho(); renderToolbar(); renderShelf(reset); renderWords(); if (S.view === "notes") renderNotes(); if (S.view === "manage") renderManage(); }
const onData = (books, words) => {
  S.ready = true;
  if (!progT || document.activeElement?.id !== "cur") progVal = null;
  S.books = books.slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title, "zh-Hant"));
  S.words = words.slice().sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  if (!book(S.selId)) S.selId = visible()[0]?.id || null;
  render();
};
const onAuth = a => {
  S.auth = a;
  if (a.mode === "cloud" && a.user) S.ready = false;   // 換帳號時等新資料
  if (a.mode === "cloud" && !a.user) S.ready = true;
  if (a.message) toast(a.message, true);
  render(true);
};
render(true);
store = location.hash === "#demo" ? demoStore(onData, onAuth) : await createStore(onData, onAuth);
render(true);
