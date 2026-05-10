// src/config/firebase.js
// Firebase инициализация — используем compat SDK (глобальный firebase объект)
// ВАЖНО: firebase подключён через <script> в index.html, это глобальная переменная

export const firebaseConfig = {
  apiKey:            "AIzaSyBAZJPfxqE2JQ3ya_oDY50mUSIZwcx6VUo",
  authDomain:        "il-trade.firebaseapp.com",
  databaseURL:       "https://il-trade-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "il-trade",
  storageBucket:     "il-trade.firebasestorage.app",
  messagingSenderId: "582308491669",
  appId:             "1:582308491669:web:a6d52ec80b7ff4a621869c"
};

export const PROJECT_ID = '831b3c98-dbce-4577-ba52-268c2dd27076';

// Безопасный доступ к глобальному firebase объекту
// (подключён через CDN <script> в index.html)
/* global firebase */
const _firebase = () => {
  if (typeof window !== 'undefined' && window.firebase) return window.firebase;
  if (typeof firebase !== 'undefined') return firebase; // eslint-disable-line no-undef
  throw new Error('Firebase SDK not loaded. Check <script> tags in index.html');
};

let _app, _auth, _db;

export function initFirebase() {
  if (_app) return { auth: _auth, db: _db };
  const fb = _firebase();
  _app  = fb.initializeApp(firebaseConfig);
  _auth = fb.auth();
  _db   = fb.database();
  return { auth: _auth, db: _db };
}

export function getAuth() { return _auth; }
export function getDb()   { return _db; }
