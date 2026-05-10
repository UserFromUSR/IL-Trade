// src/config/firebase.js
// Firebase инициализация — используем compat SDK (глобальный firebase объект)

export const firebaseConfig = {
  apiKey:            "AIzaSyBAZJPfxqE2JQ3ya_oDY50mUSIZwcx6VUo",
  authDomain:        "il-trade.firebaseapp.com",
  databaseURL:       "https://il-trade-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "il-trade",
  storageBucket:     "il-trade.firebasestorage.app",
  messagingSenderId: "582308491669",
  appId:             "1:582308491669:web:a6d52ec80b7ff4a621869c"
};

// ID проекта для API вызовов
export const PROJECT_ID = '831b3c98-dbce-4577-ba52-268c2dd27076';

// Используем глобальный firebase из compat SDK
// firebase инициализируется один раз
let _app, _auth, _db;

export function initFirebase() {
  if (_app) return { auth: _auth, db: _db };
  _app  = firebase.initializeApp(firebaseConfig);
  _auth = firebase.auth();
  _db   = firebase.database();
  return { auth: _auth, db: _db };
}

export function getAuth() { return _auth; }
export function getDb()   { return _db; }
