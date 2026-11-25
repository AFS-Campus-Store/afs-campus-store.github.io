// Campus Store — accounts and order status (shared by index.html and admin.html).
// Uses Firebase when firebase-config.js has a config; FIREBASE_CONFIG = "demo" uses a local test copy.
(function () {
  const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const toUser = u => u && { uid: u.uid, email: u.email || '', name: u.displayName || '', anon: !!u.isAnonymous, verified: !!u.emailVerified };

  async function firebaseAPI(cfg) {
    const [{ initializeApp }, A, S] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
    const app = initializeApp(cfg), auth = A.getAuth(app), db = S.getFirestore(app);
    A.getRedirectResult(auth).catch(() => {});
    const me = () => auth.currentUser;
    const uref = () => S.doc(db, 'users', me().uid);
    const mapOrder = d => { const x = d.data(); return { ...x, id: d.id, at: x.createdAt ? x.createdAt.toDate() : new Date(), upd: x.updatedAt ? x.updatedAt.toDate() : null }; };
    return {
      kind: 'firebase',
      onChange: cb => A.onAuthStateChanged(auth, u => cb(toUser(u))),
      guest: () => A.signInAnonymously(auth),
      google: async () => {
        const p = new A.GoogleAuthProvider();
        try {
          if (me() && me().isAnonymous) {
            try { await A.linkWithPopup(me(), p); await me().reload(); return; }
            catch (e) {
              if (e.code === 'auth/credential-already-in-use') { const c = A.GoogleAuthProvider.credentialFromError(e); if (c) return A.signInWithCredential(auth, c); }
              throw e;
            }
          }
          await A.signInWithPopup(auth, p);
        } catch (e) {
          if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) return A.signInWithRedirect(auth, p);
          throw e;
        }
      },
      emailIn: (e, p) => A.signInWithEmailAndPassword(auth, e, p),
      emailUp: async (e, p, n) => {
        let u;
        if (me() && me().isAnonymous) u = (await A.linkWithCredential(me(), A.EmailAuthProvider.credential(e, p))).user; // keeps the guest's orders
        else u = (await A.createUserWithEmailAndPassword(auth, e, p)).user;
        if (n) await A.updateProfile(u, { displayName: n });
        await u.reload();
      },
      verify: () => A.sendEmailVerification(me()),
      reload: async () => { await me().reload(); return toUser(me()); },
      reset: e => A.sendPasswordResetEmail(auth, e),
      out: () => A.signOut(auth),
      getProfile: async () => { const s = await S.getDoc(uref()); return s.exists() ? s.data() : {}; },
      saveProfile: p => S.setDoc(uref(), p, { merge: true }),
      addOrder: async o => {
        const code = o.code || newCode();
        const ref = await S.addDoc(S.collection(db, 'orders'), { ...o, code, uid: me().uid, status: 'new', staffNote: '', createdAt: S.serverTimestamp() });
        return { id: ref.id, code };
      },
      newCode,
      watchMine: cb => S.onSnapshot(S.query(S.collection(db, 'orders'), S.where('uid', '==', me().uid)),
        snap => cb(snap.docs.map(mapOrder).sort((a, b) => b.at - a.at).slice(0, 40)), () => cb(null)),
      watchAll: (cb, err) => S.onSnapshot(S.query(S.collection(db, 'orders'), S.orderBy('createdAt', 'desc'), S.limit(600)),
        snap => cb(snap.docs.map(mapOrder)), e => err && err(e)),
      setStatus: (id, status, note) => S.updateDoc(S.doc(db, 'orders', id), { status, staffNote: note || '', cancelledBy: status === 'cancelled' ? 'store' : '', updatedAt: S.serverTimestamp() }),
      cancel: id => S.updateDoc(S.doc(db, 'orders', id), { status: 'cancelled', cancelledBy: 'customer', updatedAt: S.serverTimestamp() }),
      del: async () => {
        const mine = await S.getDocs(S.query(S.collection(db, 'orders'), S.where('uid', '==', me().uid)));
        await Promise.all(mine.docs.map(d => S.deleteDoc(d.ref)));
        await S.deleteDoc(uref()).catch(() => {});
        await A.deleteUser(me());
      }
    };
  }

  // Local stand-in used for previews and tests: same behaviour, stored in this browser only.
  function demoAPI() {
    const KEY = 'cs_demo2';
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } };
    let db = load() || { users: {}, orders: [] };
    // who is signed in is kept per tab, like separate devices
    let curId = (() => { try { return sessionStorage.getItem('cs_demo_cur') || localStorage.getItem('cs_demo_last') || null; } catch (e) { return null; } })();
    Object.defineProperty(db, 'cur', { get: () => curId, set: v => { curId = v; try { sessionStorage.setItem('cs_demo_cur', v || ''); localStorage.setItem('cs_demo_last', v || ''); } catch (e) {} }, enumerable: false, configurable: true });
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} fire(); };
    const err = c => { const e = new Error(c); e.code = c; return e; };
    let authCb = () => {}; const watchers = new Set();
    const cur = () => db.cur && db.users[db.cur];
    const emitAuth = () => { const u = cur(); authCb(u ? { uid: db.cur, email: u.email || '', name: u.name || '', anon: !!u.anon, verified: true } : null); };
    const mapO = o => ({ ...o, at: new Date(o.at), upd: o.upd ? new Date(o.upd) : null });
    function fire() { watchers.forEach(w => w()); }
    addEventListener('storage', e => { if (e.key === KEY) { const n = load(); if (n) { db.users = n.users; db.orders = n.orders; } fire(); } });
    const watch = f => { watchers.add(f); setTimeout(f, 0); return () => watchers.delete(f); };
    return {
      kind: 'demo',
      onChange: f => { authCb = f; setTimeout(emitAuth, 0); },
      guest: async () => { const id = 'anon-' + Math.random().toString(36).slice(2, 8); db.users[id] = { anon: true, profile: {} }; db.cur = id; save(); emitAuth(); },
      google: async () => { const em = 'demo@gmail.com'; if (!db.users[em]) db.users[em] = { email: em, name: 'Δοκιμαστικός Χρήστης', pass: '', profile: {} }; db.cur = em; save(); emitAuth(); },
      emailIn: async (e, p) => { const u = db.users[e]; if (!u || u.pass !== p) throw err('auth/invalid-credential'); db.cur = e; save(); emitAuth(); },
      emailUp: async (e, p, n) => {
        if (!/^\S+@\S+\.\S+$/.test(e)) throw err('auth/invalid-email');
        if (db.users[e]) throw err('auth/email-already-in-use');
        if (p.length < 6) throw err('auth/weak-password');
        const old = db.cur && db.users[db.cur] && db.users[db.cur].anon ? db.cur : null;
        db.users[e] = { email: e, name: n, pass: p, profile: {} };
        if (old) { db.orders.forEach(o => { if (o.uid === old) o.uid = e; }); delete db.users[old]; }
        db.cur = e; save(); emitAuth();
      },
      verify: async () => {}, reload: async () => toUser(null),
      reset: async () => {},
      out: async () => { db.cur = null; save(); emitAuth(); },
      getProfile: async () => (cur() && cur().profile) || {},
      saveProfile: async p => { Object.assign(cur().profile, p); save(); },
      addOrder: async o => { const code = o.code || newCode(), id = 'o' + Date.now(); db.orders.unshift({ ...o, id, code, uid: db.cur, status: 'new', staffNote: '', at: new Date().toISOString() }); save(); return { id, code }; },
      newCode,
      watchMine: cb => watch(() => cb(db.orders.filter(o => o.uid === db.cur).map(mapO))),
      watchAll: cb => watch(() => cb(db.orders.map(mapO))),
      setStatus: async (id, status, note) => { const o = db.orders.find(x => x.id === id); if (o) { o.status = status; o.staffNote = note || ''; o.cancelledBy = status === 'cancelled' ? 'store' : ''; o.upd = new Date().toISOString(); save(); } },
      cancel: async id => { const o = db.orders.find(x => x.id === id && x.uid === db.cur); if (o && !['done', 'cancelled'].includes(o.status)) { o.status = 'cancelled'; o.cancelledBy = 'customer'; o.upd = new Date().toISOString(); save(); } },
      del: async () => { db.orders = db.orders.filter(o => o.uid !== db.cur); delete db.users[db.cur]; db.cur = null; save(); emitAuth(); }
    };
  }

  const ERR = {
    'auth/invalid-credential': 'Λάθος email ή κωδικός.', 'auth/wrong-password': 'Λάθος email ή κωδικός.', 'auth/user-not-found': 'Λάθος email ή κωδικός.',
    'auth/email-already-in-use': 'Υπάρχει ήδη λογαριασμός με αυτό το email. Πατήστε «Έχω ήδη λογαριασμό».',
    'auth/credential-already-in-use': 'Υπάρχει ήδη λογαριασμός με αυτό το email. Πατήστε «Έχω ήδη λογαριασμό».',
    'auth/weak-password': 'Ο κωδικός θέλει τουλάχιστον 6 χαρακτήρες.', 'auth/invalid-email': 'Το email δεν είναι σωστό.',
    'auth/missing-password': 'Γράψτε τον κωδικό σας.', 'auth/popup-closed-by-user': '', 'auth/cancelled-popup-request': '',
    'auth/network-request-failed': 'Δεν υπάρχει σύνδεση στο ίντερνετ.', 'auth/too-many-requests': 'Πολλές προσπάθειες. Δοκιμάστε ξανά σε λίγο.',
    'auth/unauthorized-domain': 'Αυτή η διεύθυνση δεν έχει εγκριθεί στο Firebase (Authorized domains).',
    'auth/requires-recent-login': 'Για ασφάλεια, αποσυνδεθείτε, συνδεθείτε ξανά και δοκιμάστε πάλι.',
    'auth/admin-restricted-operation': 'Η σύνδεση επισκέπτη δεν είναι ενεργή στο Firebase (Anonymous).',
    'permission-denied': 'Δεν έχετε δικαίωμα πρόσβασης.'
  };
  const msg = e => (e && e.code in ERR) ? ERR[e.code] : 'Κάτι πήγε στραβά. Δοκιμάστε ξανά.';

  const STATUS = {
    new: { t: 'Καταχωρήθηκε', d: 'Η παραγγελία σας ετοιμάζεται.', c: 'new' },
    ready: { t: 'Έτοιμη για παραλαβή', d: 'Σας περιμένει στο Campus Store. Ώρες παραλαβής: 9:00–11:30 και 13:00–16:00. Μετά τις 16:00 τα προϊόντα επιστρέφουν στο ράφι, εκτός αν μας έχετε ενημερώσει για άλλη ώρα.', c: 'ready' },
    issue: { t: 'Λείπει κάτι', d: 'Δείτε το σημείωμα του καταστήματος.', c: 'issue' },
    done: { t: 'Παραλήφθηκε', d: '', c: 'done' },
    cancelled: { t: 'Ακυρώθηκε', d: 'Η παραγγελία ακυρώθηκε.', c: 'cancelled' }
  };

  async function start() {
    const cfg = window.FIREBASE_CONFIG;
    if (cfg === 'demo' || location.hash === '#demo') return demoAPI();
    if (cfg && cfg.apiKey) return firebaseAPI(cfg);
    return null;
  }

  window.CSBackend = { start, msg, STATUS };
})();
