// 外部 API：書籍資料（Google Books + Open Library）與英文單字翻譯
import { googleBooksApiKey, translation } from "./config.js?v=202611211229";
import { parseDewey, guessDewey } from "./dewey.js?v=202611211229";

const getJson = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};
const https = u => (u ? u.replace(/^http:/, "https:").replace("&edge=curl", "") : "");
const normLang = l => (!l ? "other" : l.startsWith("zh") ? "zh" : l.startsWith("en") ? "en" : l.startsWith("ja") ? "ja" : "other");

async function googleBooks(isbn) {
  // 實測：不帶金鑰時 Google Books 會直接回 429（匿名額度為 0），所以沒有金鑰就不呼叫
  if (!googleBooksApiKey) return null;
  const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${encodeURIComponent(googleBooksApiKey)}`);
  const v = j.items?.[0]?.volumeInfo;
  if (!v) return null;
  return {
    title: v.title,
    subtitle: v.subtitle || "",
    author: (v.authors || []).join("、"),
    pages: v.pageCount || null,
    lang: normLang(v.language),
    cover: https(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail),
    categories: v.categories || [],
    publisher: v.publisher || "",
    published: v.publishedDate || ""
  };
}

const OL_LANG = { eng: "en", chi: "zh", zho: "zh", jpn: "ja" };

/** 從各版本的 DDC 清單挑一個：先取多數決的大類，再取該大類中第一個號碼（"[Fic]"、"j823" 這類會被略過或清理） */
export function pickDewey(list = []) {
  const parsed = list.map(s => parseDewey(String(s).replace(/^[a-z]+/i, ""))).filter(Boolean);
  if (!parsed.length) return null;
  const count = {};
  parsed.forEach(p => (count[p.main] = (count[p.main] || 0) + 1));
  const main = +Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
  return parsed.find(p => p.main === main);
}

async function openLibrary(isbn) {
  // search.json：作品層級，彙整所有版本的 DDC、作者、封面（實測台灣出版品也常有 DDC）
  // isbn/{isbn}.json：這個版本本身，書名是該版本的語言（例如中文譯名）
  const [s, e] = await Promise.allSettled([
    getJson(`https://openlibrary.org/search.json?isbn=${isbn}&fields=title,author_name,ddc,number_of_pages_median,cover_i,subject&limit=1`),
    getJson(`https://openlibrary.org/isbn/${isbn}.json`)
  ]);
  const w = s.status === "fulfilled" ? s.value.docs?.[0] : null;
  const ed = e.status === "fulfilled" ? e.value : null;
  if (!w && !ed) return null;
  const coverId = ed?.covers?.find(c => c > 0) || w?.cover_i;
  const lang = ed?.languages?.[0]?.key?.split("/").pop();
  return {
    title: ed?.title || w?.title || "",
    subtitle: ed?.subtitle || "",
    author: (w?.author_name || []).join("、"),
    pages: ed?.number_of_pages || w?.number_of_pages_median || null,
    lang: OL_LANG[lang] || (lang ? "other" : ""),
    cover: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : "",
    publisher: ed?.publishers?.[0] || "",
    published: ed?.publish_date || "",
    dewey: pickDewey(w?.ddc),
    subjects: w?.subject || []
  };
}

/** 依 ISBN 查書。回傳合併後的資料；兩邊都查不到時回傳 null。 */
export async function lookupIsbn(isbn) {
  const [g, o] = await Promise.allSettled([googleBooks(isbn), openLibrary(isbn)]);
  const G = g.status === "fulfilled" ? g.value : null;
  const O = o.status === "fulfilled" ? o.value : null;
  if (!G && !O) {
    if (o.status === "rejected") throw new Error("network");
    return null;
  }
  const dd = O?.dewey || null;
  const guess = dd ? null : guessDewey([...(G?.categories || []), ...(O?.subjects || [])]);
  return {
    title: G?.title || O?.title || "",
    subtitle: G?.subtitle || O?.subtitle || "",
    author: G?.author || O?.author || "",
    pages: G?.pages || O?.pages || null,
    lang: G?.lang || O?.lang || "other",
    cover: G?.cover || O?.cover || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
    publisher: G?.publisher || O?.publisher || "",
    published: G?.published || O?.published || "",
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
