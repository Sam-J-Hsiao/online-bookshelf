// 儲存層：有 Firebase 設定時用 Google 登入 + Firestore（每位使用者一個私人空間），
// 否則退回 localStorage 本機模式。兩者提供相同介面。
import { firebaseConfig } from "./config.js?v=202611201344";

const FB = "https://www.gstatic.com/firebasejs/10.12.2";

/**
 * @param {(books:object[], words:object[]) => void} onData
 * @param {(state:{mode:string,user?:object,message?:string}) => void} onAuth
 */
export async function createStore(onData, onAuth) {
  if (!firebaseConfig) return localStore(onData, onAuth);
  try {
    return await firebaseStore(onData, onAuth);
  } catch (e) {
    console.error(e);
    onAuth({ mode: "local", message: "Firebase 載入失敗，暫時改用本機模式。" });
    return localStore(onData, () => {});
  }
}

/** 範例模式：不登入也能試用，資料只存在這台裝置，和雲端帳號完全分開 */
export function demoStore(onData, onAuth) {
  const K = "online-bookshelf-demo";
  let has = false;
  try { has = !!localStorage.getItem(K); } catch { /* ignore */ }
  if (!has) {
    const m = { books: {}, words: {} };
    DEMO_BOOKS.forEach((b, i) => { m.books["demo" + i] = { notes: [], addedAt: "2026-11-01", ...b }; });
    m.books.demo0.notes = [{ id: "n1", page: "54", at: "2026-11-12", text: "習慣是自我提升的複利。每天進步一點點，一年後的差距不是線性的。" }];
    m.words.wdemo = { word: "compound", phonetic: "/ˈkɒm.paʊnd/", pos: "noun, verb, adjective", zh: "複利；複合物", def: "Made up of multiple parts or ingredients.", example: "Habits are the compound interest of self-improvement.", bookId: "demo0", score: 1, at: "2026-11-12T10:00:00Z" };
    try { localStorage.setItem(K, JSON.stringify(m)); } catch { /* ignore */ }
  }
  const s = localStore(onData, () => {}, K);
  onAuth({ mode: "demo" });
  return { ...s, mode: "demo", reset() { try { localStorage.removeItem(K); } catch { /* ignore */ } } };
}

const OL = id => `https://covers.openlibrary.org/b/id/${id}-L.jpg`;
const DEMO_BOOKS = [
  { title: "Atomic Habits", author: "James Clear", isbn: "9780735211292", pages: 320, current: 120, status: "reading", lang: "en", dewey: "155.24", deweyMain: 100, shelf: "自我成長", cover: OL(12886417) },
  { title: "被討厭的勇氣", author: "岸見一郎、古賀史健", isbn: "9789861371955", pages: 304, current: 304, status: "done", lang: "zh", dewey: "158", deweyMain: 100, shelf: "自我成長", cover: OL(11565556) },
  { title: "1984", author: "George Orwell", isbn: "9780451524935", pages: 318, current: 46, status: "reading", lang: "en", dewey: "823.912", deweyMain: 800, shelf: "經典小說", cover: OL(15257377) },
  { title: "哈利波特：神秘的魔法石", author: "J. K. Rowling", isbn: "9789573317241", pages: 302, current: 0, status: "want", lang: "zh", dewey: "823.92", deweyMain: 800, shelf: "經典小說", cover: OL(15155833) },
  { title: "Pride and Prejudice", author: "Jane Austen", isbn: "9780141439518", pages: 351, current: 0, status: "want", lang: "en", dewey: "823.7", deweyMain: 800, shelf: "經典小說", cover: OL(14348537) },
  { title: "Clean Code", author: "Robert C. Martin", isbn: "", pages: 464, current: 210, status: "reading", lang: "en", dewey: "005.1", deweyMain: 0, shelf: "課堂指定", cover: "" },
  { title: "人類大歷史", author: "哈拉瑞", isbn: "", pages: 464, current: 0, status: "want", lang: "zh", dewey: "909", deweyMain: 900, shelf: "", cover: "" },
  { title: "設計的心理學", author: "唐納．諾曼", isbn: "", pages: 400, current: 88, status: "reading", lang: "zh", dewey: "745.2", deweyMain: 700, shelf: "課堂指定", cover: "" }
];

function localStore(onData, onAuth, K = "online-bookshelf-v1") {
  let m = { books: {}, words: {} };
  try { m = { ...m, ...JSON.parse(localStorage.getItem(K) || "{}") }; } catch { /* 無法讀取就從空的開始 */ }
  const save = () => { try { localStorage.setItem(K, JSON.stringify(m)); } catch { /* 隱私模式等情況 */ } };
  const emit = () => onData(
    Object.entries(m.books).map(([id, d]) => ({ id, ...d })),
    Object.entries(m.words).map(([id, d]) => ({ id, ...d }))
  );
  onAuth({ mode: "local" });
  setTimeout(emit, 0);
  const put = kind => async (id, d) => { m[kind][id] = d; save(); emit(); };
  const del = kind => async id => { delete m[kind][id]; save(); emit(); };
  return {
    mode: "local",
    putBook: put("books"), delBook: del("books"),
    putWord: put("words"), delWord: del("words"),
    signIn: null, signOut: null
  };
}

async function firebaseStore(onData, onAuth) {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`)
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  const db = fs.getFirestore(app);
  let uid = null, unsubs = [];
  let books = [], words = [];

  auth.onAuthStateChanged(a, user => {
    unsubs.forEach(u => u()); unsubs = [];
    books = []; words = [];
    uid = user?.uid || null;
    onAuth({ mode: "cloud", user: user ? { name: user.displayName, email: user.email, photo: user.photoURL } : null });
    onData([], []);
    if (!uid) return;
    const col = name => fs.collection(db, "users", uid, name);
    const sub = (name, set) => fs.onSnapshot(col(name),
      snap => { set(snap.docs.map(d => ({ id: d.id, ...d.data() }))); onData(books, words); },
      err => onAuth({ mode: "cloud", user: { name: user.displayName }, message: "讀取失敗：" + err.code }));
    unsubs.push(sub("books", v => (books = v)), sub("words", v => (words = v)));
  });

  const need = () => { if (!uid) throw new Error("請先登入"); };
  const put = name => async (id, d) => { need(); await fs.setDoc(fs.doc(db, "users", uid, name, id), d); };
  const del = name => async id => { need(); await fs.deleteDoc(fs.doc(db, "users", uid, name, id)); };
  return {
    mode: "cloud",
    putBook: put("books"), delBook: del("books"),
    putWord: put("words"), delWord: del("words"),
    signIn: () => auth.signInWithPopup(a, new auth.GoogleAuthProvider()),
    signOut: () => auth.signOut(a)
  };
}
