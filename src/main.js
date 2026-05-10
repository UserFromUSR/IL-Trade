// src/main.js
// Точка входа — инициализация Firebase, WebSocket, Firebase listeners, UI

// ── АВАРИЙНЫЙ ФОЛБЭК (первое что выполняется) ─────────────────────
// Показывает приложение через 4с в любом случае, даже если всё сломано
const _emergencyTimer = setTimeout(() => {
  const l = document.getElementById('loader');
  const a = document.getElementById('app');
  if (l) l.style.display = 'none';
  if (a) a.style.display = 'flex';
}, 4000);

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

// ── Telegram WebApp ────────────────────────────────────────────────
// tg.expand() и tg.ready() вызываются автоматически при импорте telegram.js
const tgUser = getTgUser();

// ── Глобальное состояние ──────────────────────────────────────────
const state = {
  uid:                null,
  trades:             {},
  notifications:      [],
  settings:           {},
  tradesRef:          null,
  notifsRef:          null,
  settingsRef:        null,
  editId:             null,
  selectedEmotion:    null,
  selectedRM:         null,
  selectedStars:      0,
  selectedArgs:       [],
  pendingImages:      [],
  mexcWs:             null,
  currentPeriod:      'day',
  currentStreamFilter:'live',
  channelSettings: {
    channelId:       '',
    channelName:     '',
    enabled:         false,
    autoPostOpen:    true,
    autoPostPartial: true,
    autoPostClose:   true
  },
  // Live
  livePendingRequests: [],
  liveWhitelist:       [],
  // Close modal
  closingTradeId:   null,
  selectedCloseOpt: null,
  closeActions:     []
};

// ── Auth ──────────────────────────────────────────────────────────
async function signIn(auth) {
  const cred = auth.currentUser
    ? auth.currentUser
    : await Promise.race([
        auth.signInAnonymously().then(r => r.user),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Таймаут 10с')), 10000))
      ]);

  state.uid = cred.uid;

  if (tgUser?.id) {
    getDb().ref(`users/${state.uid}/tg`).set({
      id:         tgUser.id         || null,
      username:   tgUser.username   || null,
      first_name: tgUser.first_name || null,
      last_name:  tgUser.last_name  || null
    }).catch(() => {});
  }
}

// ── Boot ──────────────────────────────────────────────────────────
(async () => {
  // Показываем лоадер сразу, скрываем app до готовности
  const loaderEl = document.getElementById('loader');
  const appEl    = document.getElementById('app');
  if (loaderEl) loaderEl.style.display = 'flex';
  if (appEl)    appEl.style.display    = 'none';

  const setStatus = text => {
    const el = document.getElementById('loader-text');
    if (el) el.textContent = text;
  };

  // ── Показать приложение (один раз) ──────────────────────────────
  let appShown = false;
  const showApp = () => {
    if (appShown) return;
    appShown = true;

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
    clearTimeout(_emergencyTimer);

    setTimeout(() => checkReminders(), 1500);
    loadMexcKeys().catch(() => {});
    setTimeout(() => autoSyncOnOpen(), 3000);
    if (state.uid) loadUserSettings(getDb(), state.uid);
  };

  // Аварийный фолбэк — показываем через 3с в любом случае
  const fallbackTimer = setTimeout(() => showApp(), 3000);

  try {
    // 1. Firebase
    setStatus('Авторизация...');
    const { auth, db } = initFirebase();
    await signIn(auth);

    // 2. DB refs
    setStatus('Загрузка данных...');
    state.tradesRef   = db.ref(`trades/${state.uid}`);
    state.notifsRef   = db.ref(`notifications/${state.uid}`);
    state.settingsRef = db.ref(`settings/${state.uid}`);

    // 3. MEXC WebSocket (не блокирует загрузку)
    state.mexcWs = new MexcWebSocket({
      onPriceUpdate: () => {
        renderOpenTrades(state.trades, state.mexcWs);
      }
    });
    state.mexcWs.connect();

    // 4. Обработчики событий
    initHandlers(state, db);

    // 5. Firebase realtime listeners
    state.tradesRef.on('value', snap => {
      clearTimeout(_emergencyTimer); //
      state.trades = snap.val() || {};
      renderJournal(state.trades);
      renderStats(state.trades);
      renderOpenTrades(state.trades, state.mexcWs);
      if (document.getElementById('tab-itogi')?.classList.contains('active')) {
        renderSummary(state.trades, getPeriodStart(state.currentPeriod));
        renderDayHistory(state.trades, getPeriodStart(state.currentPeriod));
      }
      if (document.getElementById('tab-mexc')?.classList.contains('active')) {
        renderMexcSummary(state.trades);
      }
      showApp();
    });

    state.notifsRef.on('value', snap => {
      state.notifications = snap.val() ? Object.values(snap.val()) : [];
      renderNotifs(state.notifications);
    });

    state.settingsRef.on('value', snap => {
      state.settings = snap.val() || {};
    });

  } catch (e) {
    // При любой ошибке — всё равно показываем приложение через 1с
    console.error('Boot error:', e);
    clearTimeout(fallbackTimer);
    setTimeout(() => showApp(), 1000);
  }
})();
