import { normIsbn, fmtIsbn, isbnRegion } from "./isbn.js";
import { DEWEY, parseDewey, deweyLabel, pad3 } from "./dewey.js";
import { lookupIsbn, translateWord } from "./api.js";
import { createStore } from "./store.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const LANGS = [["zh", "中文"], ["en", "英文"], ["ja", "日文"], ["other", "其他"]];
const STATUS = { want: "想讀", reading: "閱讀中", done: "已讀完" };

// 書封配色（沒有封面圖時，依書名產生）
const PAL = [["#7a2e2e", "#b04a3a"], ["#1f4e79", "#3d7cb8"], ["#2f5d3a", "#4f8a5b"], ["#5b3a6b", "#8a5aa0"], ["#7a5a1f", "#b8892f"], ["#234b4b", "#3f7f7a"], ["#3b3b58", "#62628f"], ["#6b2f4f", "#a24d78"]];
const pal = t => { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PAL[h % PAL.length]; };

const S = { books: [], words: [], sel: 0, group: "dewey", filter: "all", wFilter: "all", auth: null };
let store = null;

const status = t => ($("#status").textContent = t);
const book = id => S.books.find(b => b.id === id);
const strip = ({ id, ...r }) => r;
const pct = b => (b.pages ? Math.min(100, Math.round(((b.current || 0) / b.pages) * 100)) : 0);
const save = async (fn, msg) => { try { await fn(); } catch (e) { console.error(e); status(msg || "儲存失敗：" + (e.code || e.message)); } };
const putBook = b => save(() => store.putBook(b.id, strip(b)));
const canWrite = () => store && (store.mode === "local" || S.auth?.user);

/* ───────── 分類 ───────── */
const keyOf = b => (S.group === "dewey" ? (b.deweyMain ?? -1) : (b.shelf || "未分類"));
const labelOf = k => (S.group === "dewey" ? (k === -1 ? "未分類" : deweyLabel(k)) : k);
const sortKey = b => (b.deweyMain == null ? "999" : (b.dewey || pad3(b.deweyMain)).padEnd(12, "0"));
const visible = () => S.books.filter(b => S.filter === "all" || keyOf(b) === S.filter);

function renderChips() {
  const counts = new Map();
  S.books.forEach(b => counts.set(keyOf(b), (counts.get(keyOf(b)) || 0) + 1));
  if (S.filter !== "all" && !counts.has(S.filter)) S.filter = "all";
  const keys = [...counts.keys()].sort((a, b) => (S.group === "dewey" ? (a === -1 ? 1e4 : a) - (b === -1 ? 1e4 : b) : String(a).localeCompare(String(b), "zh-Hant")));
  $("#chips").innerHTML = [["all", "全部", S.books.length], ...keys.map(k => [k, labelOf(k), counts.get(k)])]
    .map(([k, l, n], i) => `<button class="chip" data-i="${i}" aria-pressed="${S.filter === k}">${esc(l)} · ${n}</button>`).join("");
  $("#chips").onclick = e => {
    const c = e.target.closest("[data-i]"); if (!c) return;
    const i = +c.dataset.i; S.filter = i === 0 ? "all" : keys[i - 1]; S.sel = 0; render();
  };
  $("#gDewey").setAttribute("aria-pressed", S.group === "dewey");
  $("#gMine").setAttribute("aria-pressed", S.group === "mine");
}

/* ───────── Cover flow ───────── */
function renderFlow() {
  const list = visible(), f = $("#flow");
  if (store?.mode === "cloud" && !S.auth?.user) {
    f.innerHTML = `<div class="empty"><p>登入後就能看到你自己的書櫃。<br>每個人的書、筆記和單字都分開儲存。</p><div><button class="pri" data-act="signin">以 Google 帳號登入</button></div></div>`;
    $("#cap").innerHTML = ""; return;
  }
  if (!list.length) {
    f.innerHTML = `<div class="empty"><p>${S.books.length ? "這個分類還沒有書。" : "書櫃還是空的。"}</p>${S.books.length ? "" : '<div><button class="pri" data-act="add">新增第一本書</button></div>'}</div>`;
    $("#cap").innerHTML = ""; return;
  }
  S.sel = Math.max(0, Math.min(S.sel, list.length - 1));
  const cs = getComputedStyle(document.documentElement);
  const gap = parseFloat(cs.getPropertyValue("--gap")), step = parseFloat(cs.getPropertyValue("--step"));
  f.innerHTML = list.map((b, i) => {
    const d = i - S.sel, a = Math.abs(d), sg = Math.sign(d), [c1, c2] = pal(b.title);
    const tf = d === 0 ? "translateX(0) translateZ(120px)" : `translateX(${sg * (gap + (a - 1) * step)}px) translateZ(${-a * 30}px) rotateY(${-sg * 58}deg)`;
    return `<div class="item" data-i="${i}" style="transform:${tf};z-index:${100 - a};opacity:${a > 6 ? 0 : 1}">
      <div class="cover" style="background:linear-gradient(135deg,${c1},${c2})">
        ${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
        <div class="t">${esc(b.title)}</div><div class="orn"></div><div class="a">${esc(b.author || "")}</div>
        <div class="p"><i style="width:${pct(b)}%"></i></div>
      </div></div>`;
  }).join("");
  const b = list[S.sel];
  $("#cap").innerHTML = `<b>${esc(b.title)}</b><span>${esc(b.dewey || (b.deweyMain != null ? pad3(b.deweyMain) : "未分類"))}${b.deweyGuessed ? "（推測）" : ""} · ${esc(deweyLabel(b.deweyMain).replace(/^\d+ /, ""))}</span>`;
}
// 封面圖載入失敗時移除，露出生成封面
$("#flow").addEventListener("error", e => { if (e.target.tagName === "IMG") e.target.remove(); }, true);
$("#flow").addEventListener("load", e => {
  // Open Library 沒有封面時會回傳 1×1 的圖
  if (e.target.tagName === "IMG" && e.target.naturalWidth < 10) e.target.remove();
}, true);

/* ───────── 書籍詳情 ───────── */
const mainOptions = sel => `<option value="">未分類</option>` + DEWEY.map(d => `<option value="${d.c}"${sel === d.c ? " selected" : ""}>${pad3(d.c)} ${d.name}</option>`).join("");

function renderDetail() {
  const b = visible()[S.sel], el = $("#detail");
  if (!b || (store?.mode === "cloud" && !S.auth?.user)) { el.innerHTML = ""; return; }
  const ws = S.words.filter(w => w.bookId === b.id);
  el.innerHTML = `<div class="grid">
   <div class="card">
    <h2>${esc(b.title)}</h2>${b.subtitle ? `<p class="hint" style="margin:0 0 6px">${esc(b.subtitle)}</p>` : ""}
    <div class="meta"><span>${esc(b.author || "作者未填")}</span><span>ISBN ${fmtIsbn(b.isbn)}</span>${b.isbn ? `<span>${esc(isbnRegion(b.isbn))}出版</span>` : ""}${b.publisher ? `<span>${esc(b.publisher)} ${esc((b.published || "").slice(0, 4))}</span>` : ""}</div>
    <h3>閱讀進度</h3>
    <div class="prog"><i style="width:${pct(b)}%"></i></div>
    <p class="hint">${b.pages ? `第 ${b.current || 0} / ${b.pages} 頁（${pct(b)}%）` : "尚未填總頁數"} · ${STATUS[b.status || "want"]}</p>
    <div class="row">
      <div><label for="dCur">讀到第幾頁</label><input id="dCur" type="number" min="0" inputmode="numeric" value="${b.current || 0}"></div>
      <div><label for="dPages">總頁數</label><input id="dPages" type="number" min="1" inputmode="numeric" value="${b.pages || ""}"></div>
      <button data-act="prog">更新</button>
    </div>
    <h3 style="margin-top:20px">分類</h3>
    <div class="row">
      <div style="flex:0 1 120px"><label for="dDewey">杜威號碼</label><input id="dDewey" inputmode="decimal" value="${esc(b.dewey || "")}"></div>
      <div><label for="dMain">杜威大類${b.deweyGuessed ? "（目前為推測）" : ""}</label><select id="dMain">${mainOptions(b.deweyMain)}</select></div>
    </div>
    <div class="row" style="margin-top:10px">
      <div><label for="dShelf">我的分類</label><input id="dShelf" list="shelfList" value="${esc(b.shelf || "")}"></div>
      <div style="flex:0 1 120px"><label for="dLang">語言</label><select id="dLang">${LANGS.map(([v, l]) => `<option value="${v}"${b.lang === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      <button data-act="meta">儲存</button>
    </div>
    <div style="margin-top:18px"><button class="x" data-act="delBook">從書櫃移除這本書</button></div>
   </div>
   <div class="card">
    <h3>閱讀筆記</h3>
    <div class="row">
      <div style="flex:0 1 100px"><label for="nPage">頁碼</label><input id="nPage" type="number" min="0" inputmode="numeric" value="${b.current || ""}"></div>
      <div style="flex:3 1 220px"><label for="nText">筆記內容</label><textarea id="nText" placeholder="這一段讓你想到什麼？"></textarea></div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="pri" data-act="note">加入筆記</button></div>
    <ul class="notes">${(b.notes || []).slice().reverse().map(n => `<li><small><span>p.${esc(n.page || "—")} · ${esc(n.at)}</span><button class="x" data-del-note="${n.id}">刪除</button></small><p>${esc(n.text)}</p></li>`).join("") || '<li class="hint" style="border:0">還沒有筆記。</li>'}</ul>
    ${b.lang === "en" ? `
    <h3 style="margin-top:24px">查生詞</h3>
    <div class="row"><div><label for="wIn">不會的英文單字或片語</label><input id="wIn" autocomplete="off" autocapitalize="off" placeholder="e.g. serendipity"></div><button class="pri" data-act="word">翻譯並加入單字本</button></div>
    <p class="hint" id="wMsg">英文釋義：Free Dictionary API；中文翻譯：MyMemory。</p>
    <div id="wResult"></div>
    <p class="hint">這本書已收集 ${ws.length} 個生詞${ws.length ? "，可以到「單字本」複習" : ""}。</p>`
    : '<p class="hint" style="margin-top:20px">把語言設成「英文」，這裡就會出現查生詞的欄位。</p>'}
   </div></div>`;
  $("#wIn")?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); lookupWord(b); } });
}

/* ───────── 單字本 ───────── */
function renderWords() {
  const has = S.books.filter(b => S.words.some(w => w.bookId === b.id));
  if (S.wFilter !== "all" && !has.some(b => b.id === S.wFilter)) S.wFilter = "all";
  $("#wFilter").innerHTML = '<option value="all">全部書籍</option>' + has.map(b => `<option value="${b.id}"${S.wFilter === b.id ? " selected" : ""}>${esc(b.title)}</option>`).join("");
  const list = S.words.filter(w => S.wFilter === "all" || w.bookId === S.wFilter);
  $("#wCount").textContent = list.length ? `共 ${list.length} 個單字，其中 ${list.filter(w => (w.score || 0) >= 3).length} 個已熟記。` : "還沒有單字。到英文書的頁面查生詞，就會自動收進來。";
  const dots = s => "●".repeat(Math.min(3, s || 0)) + "○".repeat(3 - Math.min(3, s || 0));
  $("#wBody").innerHTML = list.map(w => `<tr>
    <td data-l="單字"><b>${esc(w.word)}</b><br><span class="hint">${esc(w.phonetic)} ${esc(w.pos)}</span></td>
    <td data-l="中文">${esc(w.zh || "—")}</td>
    <td data-l="釋義">${esc(w.def)}${w.example ? `<br><span class="hint">${esc(w.example)}</span>` : ""}</td>
    <td data-l="出處">${esc(book(w.bookId)?.title || "—")}</td>
    <td data-l="熟練度"><span class="tag">${dots(w.score)}</span></td>
    <td data-l=""><button class="x" data-del-word="${w.id}">刪除</button></td></tr>`).join("");
}

function renderWho() {
  const w = $("#who"), a = S.auth;
  if (!a || a.mode === "local") { w.innerHTML = ""; return; }
  w.innerHTML = a.user
    ? `${a.user.photo ? `<img src="${esc(a.user.photo)}" alt="" referrerpolicy="no-referrer">` : ""}<span>${esc(a.user.name || a.user.email || "")}</span><button data-act="signout">登出</button>`
    : `<button data-act="signin">登入</button>`;
}

function render() {
  renderWho(); renderChips(); renderFlow(); renderDetail(); renderWords();
  $("#shelfList").innerHTML = [...new Set(S.books.map(b => b.shelf).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join("");
  $("#addBtn").disabled = !canWrite();
}

/* ───────── 書架操作 ───────── */
const go = d => { const n = visible().length; if (!n) return; S.sel = Math.max(0, Math.min(n - 1, S.sel + d)); renderFlow(); renderDetail(); };
$("#prev").onclick = () => go(-1);
$("#next").onclick = () => go(1);
$("#flow").addEventListener("keydown", e => {
  if (e.key === "ArrowLeft") { go(-1); e.preventDefault(); }
  if (e.key === "ArrowRight") { go(1); e.preventDefault(); }
});
let wheelT = 0;
$("#flow").addEventListener("wheel", e => {
  const v = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (Math.abs(v) < 8 || !visible().length) return;
  e.preventDefault();
  const now = Date.now(); if (now - wheelT < 160) return; wheelT = now; go(v > 0 ? 1 : -1);
}, { passive: false });
let sx = null;
$("#flow").addEventListener("pointerdown", e => { sx = e.clientX; });
$("#flow").addEventListener("pointerup", e => {
  if (sx === null) return; const dx = e.clientX - sx; sx = null;
  if (Math.abs(dx) > 40) return go(dx < 0 ? Math.ceil(-dx / 120) : -Math.ceil(dx / 120));
  const it = e.target.closest(".item"); if (it) { S.sel = +it.dataset.i; renderFlow(); renderDetail(); }
});
$("#gDewey").onclick = () => { S.group = "dewey"; S.filter = "all"; S.sel = 0; render(); };
$("#gMine").onclick = () => { S.group = "mine"; S.filter = "all"; S.sel = 0; render(); };
$("#tShelf").onclick = () => view("shelf");
$("#tWords").onclick = () => view("words");
function view(v) {
  $("#vShelf").classList.toggle("hide", v !== "shelf"); $("#vWords").classList.toggle("hide", v !== "words");
  $("#tShelf").setAttribute("aria-current", v === "shelf"); $("#tWords").setAttribute("aria-current", v === "words");
}
addEventListener("resize", () => renderFlow());

document.body.addEventListener("click", async e => {
  const t = e.target.closest("[data-act],[data-del-note],[data-del-word]");
  if (!t || !store) return;
  const act = t.dataset.act;
  if (act === "signin") return store.signIn?.().catch(err => status("登入失敗：" + (err.code || err.message)));
  if (act === "signout") return store.signOut?.();
  if (act === "add") return openAdd();
  if (t.dataset.delWord) return save(() => store.delWord(t.dataset.delWord));
  const b = visible()[S.sel]; if (!b) return;
  if (act === "prog") {
    const pg = +$("#dPages").value || b.pages || 0, cur = Math.max(0, +$("#dCur").value || 0);
    const c = pg ? Math.min(cur, pg) : cur;
    putBook({ ...b, current: c, pages: pg || null, status: pg && c >= pg ? "done" : c > 0 ? "reading" : "want" });
  }
  if (act === "meta") {
    const raw = $("#dDewey").value.trim(), dd = parseDewey(raw), sel = $("#dMain").value;
    if (raw && !dd) return status("杜威號碼格式不正確，例如 158.1 或 823.914。");
    const main = dd ? dd.main : sel === "" ? null : +sel;
    putBook({ ...b, dewey: dd?.number || "", deweyMain: main, deweyGuessed: false, shelf: $("#dShelf").value.trim(), lang: $("#dLang").value });
    status("已儲存。");
  }
  if (act === "note") {
    const txt = $("#nText").value.trim(); if (!txt) return $("#nText").focus();
    putBook({ ...b, notes: [...(b.notes || []), { id: uid(), page: $("#nPage").value, text: txt, at: today() }] });
  }
  if (t.dataset.delNote) putBook({ ...b, notes: (b.notes || []).filter(n => n.id !== t.dataset.delNote) });
  if (act === "delBook") {
    if (!t.dataset.sure) { t.dataset.sure = 1; t.textContent = "再按一次確認移除（筆記會一起刪除，單字會保留）"; t.style.color = "var(--warn)"; return; }
    S.sel = Math.max(0, S.sel - 1); save(() => store.delBook(b.id));
  }
  if (act === "word") lookupWord(b);
});

/* ───────── 生詞翻譯 ───────── */
async function lookupWord(b) {
  const inp = $("#wIn"), msg = $("#wMsg"), w = inp.value.trim();
  if (!w) return inp.focus();
  const dup = S.words.find(x => x.word.toLowerCase() === w.toLowerCase());
  if (dup) { msg.textContent = "這個字已經在單字本裡了。"; return showWord(dup); }
  msg.textContent = "查詢中…";
  try {
    const r = await translateWord(w);
    if (!r) { msg.textContent = "查不到這個字，請檢查拼字。"; return; }
    const doc = { ...r, bookId: b.id, at: new Date().toISOString(), score: 0 };
    await store.putWord("w_" + uid(), doc);
    inp.value = ""; msg.textContent = r.zh ? "已加入單字本。" : "已加入單字本（中文翻譯暫時查不到）。";
    showWord(doc);
  } catch (e) { console.error(e); msg.textContent = "查詢失敗，請確認網路後再試一次。"; }
}
const showWord = w => {
  const r = $("#wResult"); if (!r) return;
  r.innerHTML = `<div class="wd"><b>${esc(w.word)}</b><em>${esc(w.phonetic)} ${esc(w.pos)}</em><div>${esc(w.zh || "—")}</div><div class="hint">${esc(w.def)}</div>${w.example ? `<div class="hint">“${esc(w.example)}”</div>` : ""}</div>`;
};

/* ───────── 新增書籍 ───────── */
const dAdd = $("#dAdd");
$("#fMain").innerHTML = mainOptions(null);
function openAdd() { if (!canWrite()) return; $("#fAdd").reset(); $("#fCover").value = ""; $("#fCover").dataset.subtitle = ""; $("#isbnMsg").textContent = "資料來源：Google Books、Open Library。查不到也可以手動填寫。"; dAdd.showModal(); }
$("#addBtn").onclick = openAdd;
$("#cancelAdd").onclick = () => dAdd.close();
$("#fIsbn").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#lookup").click(); } });
$("#fIsbn").oninput = () => {
  const v = $("#fIsbn").value.trim(); if (!v) return;
  const n = normIsbn(v);
  $("#isbnMsg").textContent = n ? `有效 ISBN：${fmtIsbn(n)}（${isbnRegion(n)}出版）。按「查詢書籍資料」自動帶入。` : "ISBN 格式或檢查碼不正確（也可以留空）。";
};
$("#lookup").onclick = async () => {
  const n = normIsbn($("#fIsbn").value), msg = $("#isbnMsg");
  if (!n) { msg.textContent = "請先輸入有效的 ISBN。"; return; }
  msg.textContent = "查詢中…"; $("#lookup").disabled = true;
  try {
    const r = await lookupIsbn(n);
    if (!r) { msg.textContent = "Google Books 和 Open Library 都查不到這本書，請手動填寫。"; return; }
    $("#fTitle").value = r.title; $("#fAuthor").value = r.author;
    if (r.pages) $("#fPages").value = r.pages;
    $("#fLang").value = r.lang; $("#fCover").value = r.cover; $("#fCover").dataset.subtitle = r.subtitle || "";
    $("#fDewey").value = r.dewey; $("#fMain").value = r.deweyMain ?? "";
    msg.textContent = r.dewey ? `已帶入資料，杜威號碼 ${r.dewey}（來自 Open Library）。`
      : r.deweyMain != null ? "已帶入資料。查不到正式的杜威號碼，大類是依書籍類別推測的，請確認。"
      : "已帶入資料。查不到杜威分類，請自行選擇大類。";
  } catch (e) { console.error(e); msg.textContent = "連不上書籍資料庫，請確認網路，或先手動填寫。"; }
  finally { $("#lookup").disabled = false; }
};
$("#fMain").onchange = () => { $("#fMain").dataset.touched = 1; };
$("#fAdd").onsubmit = async e => {
  e.preventDefault();
  const title = $("#fTitle").value.trim(); if (!title) return;
  const raw = $("#fIsbn").value.trim(), n = raw ? normIsbn(raw) : null, msg = $("#isbnMsg");
  if (raw && !n) { msg.textContent = "ISBN 不正確，請修正或清空。"; return; }
  if (n && S.books.some(b => b.isbn === n)) { msg.textContent = "這本書已經在書櫃上了。"; return; }
  const draw = $("#fDewey").value.trim(), dd = parseDewey(draw);
  if (draw && !dd) { msg.textContent = "杜威號碼格式不正確，例如 158.1。"; return; }
  const sel = $("#fMain").value, main = dd ? dd.main : sel === "" ? null : +sel;
  const guessed = !dd && main != null && !$("#fMain").dataset.touched && /推測/.test(msg.textContent);
  const doc = {
    title, author: $("#fAuthor").value.trim(), isbn: n, pages: +$("#fPages").value || null,
    lang: $("#fLang").value, shelf: $("#fShelf").value.trim(), cover: $("#fCover").value, subtitle: $("#fCover").dataset.subtitle || "",
    dewey: dd?.number || "", deweyMain: main, deweyGuessed: guessed,
    current: 0, status: "want", notes: [], addedAt: today()
  };
  delete $("#fMain").dataset.touched;
  await save(() => store.putBook("b_" + uid(), doc));
  dAdd.close();
};

/* ───────── 字卡複習 ───────── */
$("#wFilter").onchange = e => { S.wFilter = e.target.value; renderWords(); };
let deck = [], di = 0, flip = false;
$("#reviewBtn").onclick = () => {
  deck = S.words.filter(w => S.wFilter === "all" || w.bookId === S.wFilter)
    .sort((a, b) => (a.score || 0) - (b.score || 0) || Math.random() - 0.5).slice(0, 20);
  if (!deck.length) return;
  di = 0; flip = false; drawCard(); $("#dRev").showModal();
};
function drawCard() {
  const f = $("#fRev");
  if (di >= deck.length) { f.innerHTML = `<div class="flash"><div class="big">複習完成</div><p class="hint">這一輪共 ${deck.length} 個字。</p><button class="pri">關閉</button></div>`; return; }
  const w = deck[di];
  f.innerHTML = `<div class="flash"><p class="hint">${di + 1} / ${deck.length}</p><div class="big">${esc(w.word)}</div><p class="hint">${esc(w.phonetic)}</p>
    ${flip ? `<p style="font-size:20px">${esc(w.zh || w.def)}</p><p class="hint">${esc(w.example)}</p>
      <div class="row" style="justify-content:center"><button type="button" data-r="0">還不熟</button><button type="button" class="pri" data-r="1">記得</button></div>`
      : `<button type="button" class="pri" data-r="flip">看答案</button>`}
    <p><button class="x" value="close">結束複習</button></p></div>`;
}
$("#fRev").addEventListener("click", e => {
  const r = e.target.closest("[data-r]"); if (!r) return;
  if (r.dataset.r === "flip") { flip = true; return drawCard(); }
  const w = deck[di], score = r.dataset.r === "1" ? Math.min(5, (w.score || 0) + 1) : 0;
  save(() => store.putWord(w.id, { ...strip(w), score }));
  di++; flip = false; drawCard();
});

/* ───────── 啟動 ───────── */
render();
store = await createStore(
  (books, words) => {
    S.books = books.slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title, "zh-Hant"));
    S.words = words.slice().sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    render();
  },
  a => {
    S.auth = a;
    status(a.message || (a.mode === "local" ? "本機模式：資料只存在這個瀏覽器。設定 Firebase 後即可登入並跨裝置同步。"
      : a.user ? "已登入：你的資料存在自己的私人空間。" : "請登入以使用你的書櫃。"));
    render();
  }
);
render();
