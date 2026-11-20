// 外部 API：書籍資料（Google Books + Open Library）與英文單字翻譯
import { googleBooksApiKey, translation } from "./config.js";
import { parseDewey, guessDewey } from "./dewey.js";

const getJson = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const https = u => (u ? u.replace(/^http:/, "https:").replace("&edge=curl", "") : "");
const normLang = l => (!l ? "other" : l.startsWith("zh") ? "zh" : l.startsWith("en") ? "en" : l.startsWith("ja") ? "ja" : "other");

async function googleBooks(isbn) {
  const key = googleBooksApiKey ? `&key=${encodeURIComponent(googleBooksApiKey)}` : "";
  const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${key}`);
  const v = j.items?.[0]?.volumeInfo;
  if (!v) return null;
  return {
    title: v.subtitle ? `${v.title}：${v.subtitle}` : v.title,
    author: (v.authors || []).join("、"),
    pages: v.pageCount || null,
    lang: normLang(v.language),
    cover: https(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail),
    categories: v.categories || [],
    publisher: v.publisher || "",
    published: v.publishedDate || ""
  };
}

async function openLibrary(isbn) {
  const j = await getJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const d = j[`ISBN:${isbn}`];
  let dewey = d?.classifications?.dewey_decimal_class?.[0];
  if (!dewey) {
    // 部分書目只在 edition 資料裡有 DDC
    try { dewey = (await getJson(`https://openlibrary.org/isbn/${isbn}.json`)).dewey_decimal_class?.[0]; } catch { /* 沒有就算了 */ }
  }
  if (!d && !dewey) return null;
  return {
    title: d?.title || "",
    author: (d?.authors || []).map(a => a.name).join("、"),
    pages: d?.number_of_pages || null,
    cover: d?.cover?.large || d?.cover?.medium || "",
    dewey
  };
}

/** 依 ISBN 查書。回傳合併後的資料；兩邊都查不到時回傳 null。 */
export async function lookupIsbn(isbn) {
  const [g, o] = await Promise.allSettled([googleBooks(isbn), openLibrary(isbn)]);
  const G = g.status === "fulfilled" ? g.value : null;
  const O = o.status === "fulfilled" ? o.value : null;
  if (!G && !O) {
    if (g.status === "rejected" && o.status === "rejected") throw new Error("network");
    return null;
  }
  const dd = parseDewey(O?.dewey);
  const guess = dd ? null : guessDewey(G?.categories);
  return {
    title: G?.title || O?.title || "",
    author: G?.author || O?.author || "",
    pages: G?.pages || O?.pages || null,
    lang: G?.lang || "other",
    cover: G?.cover || O?.cover || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
    publisher: G?.publisher || "",
    published: G?.published || "",
    dewey: dd?.number || "",
    deweyMain: dd ? dd.main : guess,
    deweyGuessed: !dd && guess != null
  };
}

/** 英文單字：字典（音標、詞性、英文釋義、例句）＋中文翻譯 */
export async function translateWord(word) {
  const w = word.trim();
  const [dict, zh] = await Promise.allSettled([
    getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`),
    translateToZh(w)
  ]);
  const e = dict.status === "fulfilled" && Array.isArray(dict.value) ? dict.value[0] : null;
  const zhText = zh.status === "fulfilled" ? zh.value : "";
  if (!e && !zhText) return null;
  const meanings = e?.meanings || [];
  const defs = meanings.flatMap(m => m.definitions.map(d => ({ ...d, pos: m.partOfSpeech })));
  const withEx = defs.find(d => d.example);
  return {
    word: e?.word || w,
    phonetic: e?.phonetic || e?.phonetics?.find(p => p.text)?.text || "",
    audio: e?.phonetics?.find(p => p.audio)?.audio || "",
    pos: [...new Set(meanings.map(m => m.partOfSpeech))].join(", "),
    def: defs[0]?.definition || "",
    example: withEx?.example || "",
    zh: zhText
  };
}

async function translateToZh(text) {
  if (translation.provider === "google" && translation.googleApiKey) {
    const j = await getJson(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(translation.googleApiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source: "en", target: "zh-TW", format: "text" })
    });
    return j.data?.translations?.[0]?.translatedText || "";
  }
  const de = translation.contactEmail ? `&de=${encodeURIComponent(translation.contactEmail)}` : "";
  const j = await getJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-TW${de}`);
  const t = (j.responseData?.translatedText || "").trim();
  // MyMemory 查不到時常原樣回傳英文或錯誤訊息
  if (!t || t.toLowerCase() === text.toLowerCase() || /MYMEMORY WARNING|INVALID/i.test(t)) return "";
  return t;
}
