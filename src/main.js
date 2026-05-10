// src/main.js — ДИАГНОСТИЧЕСКАЯ ВЕРСИЯ
// alert() на каждом шаге чтобы найти где зависает

import { initFirebase, getDb } from './config/firebase.js';
import { MexcWebSocket }       from './api/mexc-ws.js';
import {
  renderStats, renderJournal, renderOpenTrades,
  renderSummary, renderDayHistory, renderMexcSummary,
  renderNotifs
} from './ui/renderer.js';
import {
  initHandlers, getPeriodStart,
  checkReminders, loadMexcKeys, autoSyncOnOpen,
  loadUserSettings
} from './ui/handlers.js';
import { getTgUser } from './api/telegram.js';

const tgUser = getTgUser();

const state = {
  uid: null, trades: {}, notifications: [], settings: {},
  tradesRef: null, notifsRef: null, settingsRef: null,
  editId: null, selectedEmotion: null, selectedRM: null,
  selectedStars: 0, selectedArgs: [], pendingImages: [],
  mexcWs: null, currentPeriod: 'day', currentStreamFilter: 'live',
  channelSettings: { channelId:'', channelName:'', enabled:false,
    autoPostOpen:true, autoPostPartial:true, autoPostClose:true },
  livePendingRequests: [], liveWhitelist: [],
  closingTradeId: null, selectedCloseOpt: null, closeActions: []
};

const loaderEl = document.getElementById('loader');
const appEl    = document.getElementById('app');

function setStatus(text) {
  const el = document.getElementById('loader-text');
  if (el) el.textContent = text;
}

let _appShown = false;
function showApp() {
  if (_appShown) return;
  _appShown = true;
  const now = new Date();
  const de = document.getElementById('date');
  const te = document.getElementById('time');
  if (de) de.value = now.toISOString().slice(0, 10);
  if (te) te.value = now.toTimeString().slice(0, 5);
  const ef = document.getElementById('export-from');
  const et = document.getElementById('export-to');
  if (ef) ef.value = now.toISOString().slice(0, 10);
  if (et) et.value = now.toISOString().slice(0, 10);
  if (loaderEl) loaderEl.style.display = 'none';
  if (appEl)    appEl.style.display    = 'flex';
}

// ── АВАРИЙНЫЙ показ через 3с в любом случае ──────────────────────
// (не очищается — всегда сработает)
setTimeout(() => {
  if (!_appShown) {
    alert('⚠️ 3с прошло, принудительно открываю. Статус: ' +
      (document.getElementById('loader-text')?.textContent || '?'));
    showApp();
  }
}, 3000);

async function signIn(auth) {
  const user = auth.currentUser || await Promise.race([
    auth.signInAnonymously().then(r => r.user),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Auth timeout 8s')), 8000)
    )
  ]);
  state.uid = user.uid;
  return user;
}

function attachFirebaseListeners(db) {
  state.tradesRef   = db.ref(`trades/${state.uid}`);
  state.notifsRef   = db.ref(`notifications/${state.uid}`);
  state.settingsRef = db.ref(`settings/${state.uid}`);

  state.tradesRef.on('value', snap => {
    state.trades = snap.val() || {};
    renderJournal(state.trades);
    renderStats(state.trades);
    renderOpenTrades(state.trades, state.mexcWs);
    showApp();
  }, err => {
    alert('Firebase trades error: ' + err.message);
    showApp();
  });

  state.notifsRef.on('value', snap => {
    state.notifications = snap.val() ? Object.values(snap.val()) : [];
    renderNotifs(state.notifications);
  });

  state.settingsRef.on('value', snap => {
    state.settings = snap.val() || {};
  });
}

function initMexcWs() {
  state.mexcWs = new MexcWebSocket({
    onPriceUpdate: () => renderOpenTrades(state.trades, state.mexcWs)
  });
  state.mexcWs.connect();
}

function runPostBootEffects() {
  setTimeout(() => checkReminders(), 1500);
  loadMexcKeys().catch(() => {});
  setTimeout(() => autoSyncOnOpen(), 3000);
  if (state.uid) loadUserSettings(getDb(), state.uid);
}

// ── Boot ─────────────────────────────────────────────────────────
(async () => {
  if (loaderEl) loaderEl.style.display = 'flex';
  if (appEl)    appEl.style.display    = 'none';

  try {
    // ШАГ 1
    setStatus('Шаг 1: Firebase...');
    let auth, db;
    try {
      const result = initFirebase();
      auth = result.auth;
      db   = result.db;
      setStatus('Шаг 1: OK ✓');
    } catch(e) {
      alert('❌ initFirebase упал: ' + e.message);
      showApp(); return;
    }

    // ШАГ 2
    setStatus('Шаг 2: Auth...');
    try {
      await signIn(auth);
      setStatus('Шаг 2: OK ✓ uid=' + state.uid?.slice(0,8));
    } catch(e) {
      alert('❌ signIn упал: ' + e.message);
      showApp(); return;
    }

    // ШАГ 3
    setStatus('Шаг 3: Handlers...');
    try {
      initMexcWs();
      await Promise.resolve(initHandlers(state, db));
      setStatus('Шаг 3: OK ✓');
    } catch(e) {
      alert('❌ initHandlers упал: ' + e.message);
      // не return — продолжаем
    }

    // ШАГ 4
    setStatus('Шаг 4: Загрузка данных...');
    attachFirebaseListeners(db);

  } catch (e) {
    alert('❌ Boot error: ' + e.message);
    showApp();
  }

  runPostBootEffects();
})();
