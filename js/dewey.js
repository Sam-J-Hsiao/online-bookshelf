// 杜威十進位分類法（DDC）：十大類與從 Google Books 類別推測的對照

export const DEWEY = [
  { c: 0,   name: "總類、電腦與資訊" },
  { c: 100, name: "哲學與心理學" },
  { c: 200, name: "宗教" },
  { c: 300, name: "社會科學" },
  { c: 400, name: "語言" },
  { c: 500, name: "自然科學與數學" },
  { c: 600, name: "應用科學與技術" },
  { c: 700, name: "藝術與休閒" },
  { c: 800, name: "文學" },
  { c: 900, name: "歷史與地理" }
];

export const pad3 = n => String(n).padStart(3, "0");

/** "158.1"、"158/.1"、"823.914 22" → { number: "158.1", main: 100 } */
export function parseDewey(raw) {
  if (raw == null || raw === "") return null;
  const m = String(raw).replace(/\//g, "").match(/\d{1,3}(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  if (!(n >= 0 && n < 1000)) return null;
  return { number: m[0].includes(".") ? m[0] : pad3(m[0]), main: Math.floor(n / 100) * 100 };
}

export const deweyLabel = main =>
  main == null ? "未分類" : `${pad3(main)} ${DEWEY.find(d => d.c === main)?.name || ""}`;

// 只在沒有正式 DDC 號碼時使用，畫面上會標示「推測」
const GUESS = [
  [/computer|internet|information/i, 0],
  [/philosoph|psycholog|self-help|mind/i, 100],
  [/religio|bible|buddh|spiritual/i, 200],
  [/business|econom|politic|social|law|educat|management|finance/i, 300],
  [/language|linguist|grammar|dictionar/i, 400],
  [/science|mathemat|physics|chemistry|biolog|nature/i, 500],
  [/medic|health|technolog|engineer|cooking|agricult/i, 600],
  [/art|music|sport|game|photograph|design|architect|performing/i, 700],
  [/fiction|poetry|drama|literary|literature|novel/i, 800],
  [/histor|biograph|travel|geograph/i, 900]
];

export function guessDewey(categories = []) {
  const s = categories.join(" ");
  const hit = GUESS.find(([re]) => re.test(s));
  return hit ? hit[1] : null;
}
