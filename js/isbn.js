// ISBN 驗證、ISBN-10 → ISBN-13 轉換、出版地區（註冊群組）判斷

export function normIsbn(raw) {
  let s = String(raw || "").toUpperCase().replace(/[^0-9X]/g, "");
  if (s.length === 10) {
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += (+s[i]) * (10 - i);
    sum += s[9] === "X" ? 10 : +s[9];
    if (sum % 11) return null;
    s = "978" + s.slice(0, 9);
    return s + check13(s);
  }
  if (s.length !== 13 || !/^\d+$/.test(s)) return null;
  return check13(s) === +s[12] ? s : null;
}

function check13(s) {
  let t = 0;
  for (let i = 0; i < 12; i++) t += (+s[i]) * (i % 2 ? 3 : 1);
  return (10 - (t % 10)) % 10;
}

export const fmtIsbn = s => (s ? s.slice(0, 3) + "-" + s.slice(3) : "—");

const GROUPS = [
  ["9780", "英語區"], ["9781", "英語區"], ["9782", "法語區"], ["9783", "德語區"], ["9784", "日本"],
  ["9785", "俄語區"], ["9787", "中國大陸"], ["97881", "印度"], ["97884", "西班牙"], ["97888", "義大利"],
  ["97889", "韓國"], ["97890", "荷蘭語區"], ["978957", "台灣"], ["978986", "台灣"], ["978626", "台灣"],
  ["978962", "香港"], ["978988", "香港"], ["978981", "新加坡"], ["978983", "馬來西亞"],
  ["9798", "美國"], ["97910", "法國"], ["97911", "韓國"], ["97912", "義大利"]
].sort((a, b) => b[0].length - a[0].length);

export function isbnRegion(s) {
  if (!s) return "";
  const g = GROUPS.find(([p]) => s.startsWith(p));
  return g ? g[1] : "其他地區";
}
