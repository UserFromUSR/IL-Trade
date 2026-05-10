// src/main.js — ДИАГНОСТИКА v2 (ошибки на экране)

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

function showError(msg) {
  const el = document.getElementById('loader-text');
  if (el) {
    el.style.color = '#ff4444';
    el.style.fontSize = '12px';
    el.style.padding = '10px';
    el.style.whiteSpace = 'pre-wrap';
    el.textContent = '❌ ' + msg;
  }
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

// Принудительный показ через 6с — НЕ очищается никогда
setTimeout(() => { if (!_appShown) showApp(); }, 6000);

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
    showError('Firebase error:\n' + err.message);
    setTimeout(() => showApp(), 3000);
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

(async () => {
  if (loaderEl) loaderEl.style.display = 'flex';
  if (appEl)    appEl.style.display    = 'none';

  try {
    setStatus('Шаг 1: Firebase init...');
    let auth, db;
    try {
      ({ auth, db } = initFirebase());
    } catch(e) {
      showError('initFirebase:\n' + e.message); return;
    }

    setStatus('Шаг 2: Auth...');
    try {
      await signIn(auth);
    } catch(e) {
      showError('signIn:\n' + e.message); return;
    }

    setStatus('Шаг 3: Init handlers...');
    try {
      initMexcWs();
      await Promise.resolve(initHandlers(state, db));
    } catch(e) {
      showError('initHandlers:\n' + e.message);
    }

    setStatus('Шаг 4: Загрузка данных...');
    attachFirebaseListeners(db);

    // Если данные не пришли за 4с — показываем ошибку и открываем через 2с
    setTimeout(() => {
      if (!_appShown) {
        showError('Нет ответа от БД за 4с.\nОткрываю через 2с...');
        setTimeout(() => showApp(), 2000);
      }
    }, 4000);

  } catch (e) {
    showError('Boot error:\n' + e.message);
    setTimeout(() => showApp(), 3000);
  }

  runPostBootEffects();
})();
