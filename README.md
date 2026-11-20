# 閱讀誌

閱讀誌是一個純前端的線上書櫃網站：用 ISBN 匯入書籍、記錄閱讀進度與筆記、查英文生詞並收進單字本，書架以 cover flow 呈現，並依**杜威十進位分類法（DDC）**分類。

## 功能

- **匯入書籍**：輸入 ISBN（10 或 13 碼），從 Open Library 取得書名（該版本語言，例如中文譯名）、作者、頁數、封面與杜威號碼；設定 Google Books 金鑰後會優先使用 Google Books 的書目資料。查不到也能手動輸入。
- **分類**：依杜威十大類（000–900）分類；沒有正式號碼時，會依 Google Books 的類別推測大類，並標示「推測」。也可以用自訂的「我的分類」。
- **書架**：3D cover flow，可以用左右鍵、滾輪、滑動或點擊翻書，書封下方有閱讀進度條。
- **閱讀進度與筆記**：記錄頁數、閱讀狀態，筆記可附頁碼。
- **英文生詞**：英文書可以查單字（Free Dictionary API 提供音標、詞性、釋義、例句；MyMemory 提供中文翻譯），並自動收進單字本。
- **單字本**：依書篩選，用字卡複習，越不熟的字越先出現；可匯出 CSV（Excel、Numbers、Anki 都能匯入）。
- **每位使用者的資料各自儲存**：用 Google 帳號登入，資料存在 Firestore 的 `users/{uid}/` 底下，安全規則只允許本人讀寫。

## 範例模式

在網址後面加上 `#demo`（例如 `https://sam-j-hsiao.github.io/online-bookshelf/#demo`），或在登入畫面按「先用範例書看看」，就會載入 8 本範例書。範例資料只存在這台裝置，和雲端帳號完全分開，按「結束」會清掉。

## 設計

新擬物化（Neumorphism）：同色系淺灰底，元件用浮起／凹陷陰影表現層次；橘色是唯一的重點色。支援深色模式（跟隨系統）。

- 思源宋體（Noto Serif TC）：書名、筆記內文、單字、品牌字
- 思源黑體（Noto Sans TC）：按鈕、標籤、數字等介面文字

Cover flow 由 `js/flow.js` 驅動：位置是連續值，觸控板水平滑動會一比一跟手，慣性結束後以彈簧（約 3% 回彈、0.3 秒停穩）吸附到最近的一本；也支援拖曳甩動、鍵盤左右鍵與底部滑桿。

## 發布流程

每次修改後、推上 GitHub 前執行：

```bash
python3 tools/release.py
```

它會替所有 CSS／JS 網址加上版本號（`?v=時間`），並更新 `version.json`。網站開啟時會比對版本，若伺服器上有新版就自動重新整理一次，使用者不必手動清快取。

## 檔案結構

```
index.html          頁面骨架
css/style.css       樣式
js/app.js           介面與互動
js/flow.js          cover flow 動畫引擎
js/api.js           Google Books / Open Library / 字典與翻譯 API
js/dewey.js         杜威分類表、號碼解析、類別推測
js/isbn.js          ISBN 驗證與轉換
js/store.js         資料儲存（Firebase 或本機）
js/config.js        設定（Firebase、API 金鑰）
firestore.rules     Firestore 安全規則
tools/release.py    發布前加版本號
version.json        目前版本（給網站比對用）
```

不需要建置工具，直接用靜態網站託管即可（例如 GitHub Pages）。

## 本機執行

ES module 不能直接用 `file://` 開啟，請啟動一個簡單的伺服器：

```bash
python3 -m http.server 8000
# 然後打開 http://localhost:8000
```

沒有設定 Firebase 時，網站以「本機模式」運作，資料只存在目前的瀏覽器。

## 設定 Firebase（登入與雲端儲存）

1. 到 [Firebase Console](https://console.firebase.google.com/) 建立專案。
2. 左側選單「**安全性**」→ **Authentication** → 開始使用 → 登入方式 → 啟用 **Google**（新版主控台把 Authentication 放在「安全性」底下）。
3. **Authentication** → 設定 → 授權網域：加入你的網站網域（例如 `sam-j-hsiao.github.io`）。
4. **Firestore Database** → 建立資料庫 → 到「規則」分頁，貼上 `firestore.rules` 的內容並發布。
5. 專案設定 → 一般 → 你的應用程式 → 新增網頁應用程式，複製 `firebaseConfig`，貼到 `js/config.js`。

> Firebase 的網頁設定值本來就是公開的，可以放進公開儲存庫；保護資料的是第 4 步的安全規則。

## 之後接 Google API

- **Google Books API 金鑰（建議盡快設定）**：實測不帶金鑰時 Google Books 會直接拒絕（匿名額度為 0），所以目前程式沒有金鑰就只用 Open Library。在 Google Cloud Console 建立 API 金鑰，限制只能用於 Books API 和你的網域，填入 `js/config.js` 的 `googleBooksApiKey`，可提高查詢額度。
- **Google Cloud Translation**：把 `js/config.js` 的 `translation.provider` 改成 `"google"` 並填入金鑰。注意：這組金鑰會出現在前端，正式上線前建議改成透過後端（例如 Firebase Cloud Functions）代為呼叫，避免被盜用而產生費用。

## 資料結構（Firestore）

```
users/{uid}/books/{bookId}
  title, author, isbn, pages, current, status, lang, cover,
  dewey, deweyMain, deweyGuessed, shelf, publisher, published,
  notes: [{ id, page, text, at }], addedAt
users/{uid}/words/{wordId}
  word, phonetic, pos, def, example, zh, bookId, score, at
```
