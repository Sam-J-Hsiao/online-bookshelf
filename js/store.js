// 儲存層：有 Firebase 設定時用 Google 登入 + Firestore（每位使用者一個私人空間），
// 否則退回 localStorage 本機模式。兩者提供相同介面。
import { firebaseConfig } from "./config.js";

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

function localStore(onData, onAuth) {
  const K = "online-bookshelf-v1";
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
