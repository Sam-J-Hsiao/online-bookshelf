#!/usr/bin/env python3
"""發布前執行：替所有 CSS／JS 網址加上版本號，避免瀏覽器沿用舊快取。

用法：python3 tools/release.py
- 版本號 = 目前時間（UTC，精確到分鐘），例如 202611201405
- index.html 的 css/js 連結、每個 js 檔裡的相對 import，都改成 ...?v=版本號
- 寫入 version.json，網站開啟時會比對；發現有新版就自動重新整理一次
"""
import json, re, pathlib, datetime, subprocess, sys

root = pathlib.Path(__file__).resolve().parent.parent

# 發布前先用 acorn 以 ES module 規則嚴格檢查語法（node --check 會漏掉部分錯誤）
CHECK = r"""
const a = require(process.env.ACORN || "acorn"), fs = require("fs"); let bad = 0;
for (const f of process.argv.slice(1)) {
  try { a.parse(fs.readFileSync(f, "utf8"), { ecmaVersion: "latest", sourceType: "module" }); }
  catch (e) { console.error("語法錯誤", f, e.message); bad = 1; }
}
process.exit(bad);
"""
files = [str(p) for p in sorted((root / "js").glob("*.js"))]
if subprocess.run(["node", "-e", CHECK, *files]).returncode:
    sys.exit("發布中止：請先修正上面的語法錯誤")
v = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M")

def stamp(text):
    # "./foo.js" 或 "./foo.js?v=舊版" → "./foo.js?v=新版"；css/style.css 同理
    text = re.sub(r'((?:\./|js/|css/)[\w\-/]+\.(?:js|css))(\?v=\w+)?(["\'])', rf'\1?v={v}\3', text)
    return re.sub(r'const APP_VERSION = "[^"]*";', f'const APP_VERSION = "{v}";', text)

for p in [root / "index.html", *sorted((root / "js").glob("*.js"))]:
    p.write_text(stamp(p.read_text(encoding="utf-8")), encoding="utf-8")
(root / "version.json").write_text(json.dumps({"v": v}) + "\n", encoding="utf-8")
print("version", v)
