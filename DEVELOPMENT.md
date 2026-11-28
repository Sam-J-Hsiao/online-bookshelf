# 閱讀誌：開發說明

這份文件寫給想了解程式架構、在本機執行，或自己部署一份閱讀誌的人。一般使用說明請看 [README.md](README.md)。

閱讀誌是純前端網站：原生 JavaScript（ES modules）、不需要建置工具，直接放在任何靜態網站託管（例如 GitHub Pages）即可運作。

## 檔案結構

```
index.html            頁面骨架
css/style.css         樣式
js/app.js             介面與互動
js/flow.js            cover flow 動畫引擎
js/api.js             Google Books / Open Library / 字典與翻譯 API
js/dewey.js           杜威分類表、號碼解析、類別推測
js/classify.js        中文圖書分類表、杜威→中文換算、分類顯示與取色
js/isbn.js            ISBN 驗證與轉換
js/store.js           資料儲存（Firebase、本機或範例模式）
js/config.js          設定（Firebase、API 金鑰）
firestore.rules       Firestore 安全規則
icons/                網站圖示
manifest.webmanifest  加入主畫面用的設定
tools/release.py      發布前加版本號
version.json          目前版本（給網站比對用）
```

## 本機執行

ES module 不能直接用 `file://` 開啟，請啟動一個簡單的伺服器：

```bash
python3 -m http.server 8000
# 然後打開 http://localhost:8000
```

沒有設定 Firebase 時，網站以「本機模式」運作，資料只存在目前的瀏覽器。網址加上 `#demo` 會進入範例模式，資料與帳號完全分開。

## 發布流程

每次修改後、推上 GitHub 前執行：

```bash
npm i -g acorn   # 第一次需要，用來嚴格檢查語法
python3 tools/release.py
```

它會替所有 CSS／JS 網址加上版本號（`?v=時間`），並更新 `version.json`。網站開啟時會比對版本，伺服器上有新版就自動重新整理一次，使用者不必手動清快取。

## 設定 Firebase（登入與雲端儲存）

1. 到 [Firebase Console](https://console.firebase.google.com/) 建立專案。
2. 左側選單「安全性」→ **Authentication** → 開始使用 → 登入方式 → 啟用 **Google**。
3. **Authentication** → 設定 → 授權網域：加入你的網站網域。
4. **Firestore Database** → 建立資料庫 → 到「規則」分頁，貼上 `firestore.rules` 的內容並發布。
5. 專案設定 → 一般 → 你的應用程式 → 新增網頁應用程式，複製 `firebaseConfig`，貼到 `js/config.js`。

> Firebase 的網頁設定值本來就是公開的，可以放進公開儲存庫；保護資料的是第 4 步的安全規則，只允許使用者讀寫自己 `users/{uid}/` 底下的資料。

## Google Books API 金鑰

不帶金鑰時 Google Books 會拒絕查詢（匿名額度為 0），這時程式只會使用 Open Library。

1. 在 Google Cloud Console 啟用 **Books API**。
2. 建立 API 金鑰，應用程式限制選「網站」並填入你的網域，API 限制只勾 Books API。
3. 把金鑰填入 `js/config.js` 的 `googleBooksApiKey`。

兩邊都有資料時，以 Google Books 為主、Open Library 補缺。若 Google Books 的頁數明顯偏少（低於 Open Library 的 60%），改用 Open Library 的頁數。

## 翻譯服務

預設使用 MyMemory。若要改用 Google Cloud Translation，把 `js/config.js` 的 `translation.provider` 改成 `"google"` 並填入金鑰。這組金鑰會出現在前端，正式使用前建議改成透過後端（例如 Firebase Cloud Functions）代為呼叫，避免被盜用而產生費用。

## 分類邏輯

- 書籍語言為中文時使用**中文圖書分類法（2007 年版）**，其他語言使用**杜威十進位分類法**。
- 書目資料通常只有杜威號碼，中文書會依 `js/classify.js` 的換算表推出中文分類大類，並標示「推算」。兩套分類無法一對一對應，例如杜威 400 語言與 800 文學都對到中文 800；杜威 900 史地依中國／世界分成中文 600／700。
- 沒有封面的書，依所屬大類取一個低彩度顏色。

## 設計

- 新擬物化（Neumorphism）：同色系淺灰底，元件以浮起／凹陷陰影表現層次，橘色是唯一的重點色；深色模式跟隨系統。
- 字體只使用思源宋體（書名、筆記、單字）與思源黑體（介面文字）。
- 手機上新增／編輯書籍的表單為全螢幕，並依 `visualViewport` 貼齊鍵盤上方。
- Cover flow 由 `js/flow.js` 驅動：位置是連續值，觸控板水平滑動一比一跟手，慣性結束後以彈簧（約 3% 回彈、0.3 秒停穩）吸附到最近的一本；也支援拖曳甩動、鍵盤左右鍵與底部滑桿。

## 資料結構（Firestore）

```
users/{uid}/books/{bookId}
  title, author, isbn, pages, current, status, lang, cover,
  publisher, published,
  dewey, deweyMain, deweyGuessed,      // 杜威分類
  ccl, cclMain, cclGuessed,            // 中文圖書分類
  notes: [{ id, page, text, at }], addedAt
users/{uid}/words/{wordId}
  word, phonetic, pos, def, example, zh, bookId, score, at
```
