// ─────────────────────────────────────────────
// 網站設定。這些值都是「前端公開金鑰」，放在公開儲存庫是正常的；
// 真正保護資料的是 Firestore 安全規則（見 firestore.rules）。
// ─────────────────────────────────────────────

// 1) Firebase：到 Firebase Console → 專案設定 → 你的應用程式 → 複製 firebaseConfig 貼在這裡。
//    保持 null 時，網站會以「本機模式」運作：資料只存在目前這個瀏覽器。
export const firebaseConfig = null;
/* 範例：
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  appId: "1:1234567890:web:abcdef"
};
*/

// 2) Google Books API 金鑰（選填）。不填也能用，只是每日查詢額度較低。
export const googleBooksApiKey = "";

// 3) 翻譯服務。目前用免費的 MyMemory；之後接 Google Cloud Translation 時把 provider 改成 "google" 並填入金鑰。
export const translation = {
  provider: "mymemory",      // "mymemory" | "google"
  googleApiKey: "",          // provider 為 "google" 時使用
  contactEmail: ""           // 選填：MyMemory 填 email 可提高每日免費額度
};
