// src/main.js
// Точка входа — инициализация Firebase, WebSocket, Firebase listeners, UI
// Рефакторинг: Promise.allSettled boot, без _emergencyTimer

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

// ── Telegram WebApp ──────────────────────────────────────────────
// tg.expand() и tg.ready() вызываются автоматически при импорте telegram.js
const tgUser = getTgUser();

// ── Глобальное состояние ────────────────────────────────────────
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
  livePendingRequests: [],
  liveWhitelist:       [],
  closingTradeId:   null,
  selectedCloseOpt: null,
  closeActions:     []
};

// ── UI helpers ──────────────────────────────────────────────────
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

// ── Auth ────────────────────────────────────────────────────────
async function signIn(auth) {
  const AUTH_TIMEOUT_MS = 10_000;

  const user = auth.currentUser || await Promise.race([
    auth.signInAnonymously().then(r => r.user),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Auth timeout (10s)')), AUTH_TIMEOUT_MS)
    )
  ]);

  state.uid = user.uid;

  if (tgUser?.id) {
    try {
      await getDb().ref(`users/${state.uid}/tg`).set({
        id:         tgUser.id         ?? null,
        username:   tgUser.username   ?? null,
        first_name: tgUser.first_name ?? null,
        last_name:  tgUser.last_name  ?? null
      });
    } catch (e) {
      console.warn('[main] Could not save Telegram user info:', e.message);
    }
  }

  return user;
}

// ── Firebase listeners ──────────────────────────────────────────
function attachFirebaseListeners(db) {
  state.tradesRef   = db.ref(`trades/${state.uid}`);
  state.notifsRef   = db.ref(`notifications/${state.uid}`);
  state.settingsRef = db.ref(`settings/${state.uid}`);

  // Trades — показываем приложение после первого снапшота
  state.tradesRef.on('value', snap => {
    state.trades = snap.val() || {};

    // ✅ ИСПРАВЛЕНО: фильтруем MEXC-сделки из журнала и статистики
    const manualTrades = Object.fromEntries(
      Object.entries(state.trades).filter(([, t]) => !t.fromMexc && t.source !== 'mexc')
    );

    renderJournal(manualTrades);
    renderStats(manualTrades);
    renderOpenTrades(state.trades, state.mexcWs);

    // ✅ ИСПРАВЛЕНО: подписываемся на активы открытых сделок сразу при загрузке
    // (раньше подписка была только при клике на вкладку "Открытые")
    const openAssets = Object.values(state.trades)
      .filter(t => !t.fromMexc && (!t.status || t.status === 'open') && t.asset)
      .map(t => t.asset);
    if (openAssets.length > 0 && state.mexcWs) {
      state.mexcWs.subscribe(openAssets);
    }

    if (document.getElementById('tab-itogi')?.classList.contains('active')) {
      renderSummary(manualTrades, getPeriodStart(state.currentPeriod));
      renderDayHistory(manualTrades, getPeriodStart(state.currentPeriod));
    }
    if (document.getElementById('tab-mexc')?.classList.contains('active')) {
      renderMexcSummary(state.trades);
    }

    showApp(); // безопасно вызывать многократно — idempotent
  }, err => {
    console.error('[Firebase] trades listener error:', err);
    showApp(); // всё равно показываем UI
  });

  state.notifsRef.on('value', snap => {
    state.notifications = snap.val() ? Object.values(snap.val()) : [];
    renderNotifs(state.notifications);
  }, err => console.warn('[Firebase] notifs error:', err));

  state.settingsRef.on('value', snap => {
    state.settings = snap.val() || {};
  }, err => console.warn('[Firebase] settings error:', err));
}

// ── MEXC WebSocket ──────────────────────────────────────────────
function initMexcWs() {
  state.mexcWs = new MexcWebSocket({
    onPriceUpdate: () => {
      renderOpenTrades(state.trades, state.mexcWs);
    }
  });
  state.mexcWs.connect();
}

// ── Post-boot side effects ──────────────────────────────────────
function runPostBootEffects() {
  setTimeout(() => checkReminders(), 1500);
  loadMexcKeys().catch(e => console.warn('[loadMexcKeys]', e));
  setTimeout(() => autoSyncOnOpen(), 3000);
  if (state.uid) loadUserSettings(getDb(), state.uid);
}

// ── Boot sequence ───────────────────────────────────────────────
(async () => {
  if (loaderEl) loaderEl.style.display = 'flex';
  if (appEl)    appEl.style.display    = 'none';

  // Гарантированный фолбэк — если за 5с ничего не произошло, просто показать UI
  const safetyValve = setTimeout(() => {
    console.warn('[main] Safety valve triggered — showing app unconditionally');
    showApp();
  }, 5_000);

  try {
    // ① Firebase + Auth
    setStatus('Авторизация...');
    const { auth, db } = initFirebase();
    await signIn(auth);

    // ② Параллельно: MEXC WS + обработчики (не блокируют boot)
    setStatus('Подключение...');
    const [wsResult, handlersResult] = await Promise.allSettled([
      Promise.resolve(initMexcWs()),
      Promise.resolve(initHandlers(state, db))
    ]);

    if (wsResult.status === 'rejected') {
      console.warn('[MEXC] init failed:', wsResult.reason);
    }
    if (handlersResult.status === 'rejected') {
      console.error('[Handlers] init failed:', handlersResult.reason);
    }

    // ③ Firebase listeners (показывают UI при первом снапшоте)
    setStatus('Загрузка данных...');
    attachFirebaseListeners(db);

    // ④ Если снапшот не пришёл за 3с — всё равно показываем UI
    setTimeout(() => showApp(), 3_000);

  } catch (e) {
    console.error('[main] Boot error:', e);
    showApp();
  } finally {
    clearTimeout(safetyValve);
  }

  runPostBootEffects();
})();
