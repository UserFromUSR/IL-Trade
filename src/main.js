// src/main.js
// Точка входа — инициализация Firebase, WebSocket, Firebase listeners, UI

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
  const setStatus = text => {
    const el = document.getElementById('loader-text');
    if (el) el.textContent = text;
  };

  try {
    // 1. Firebase
    setStatus('Авторизация...');
    const { auth, db } = initFirebase();
    await signIn(auth);

    // 2. DB refs
    setStatus('Подключение к базе...');
    state.tradesRef   = db.ref(`trades/${state.uid}`);
    state.notifsRef   = db.ref(`notifications/${state.uid}`);
    state.settingsRef = db.ref(`settings/${state.uid}`);

    // 3. MEXC WebSocket
    setStatus('Подключение к MEXC...');
    state.mexcWs = new MexcWebSocket({
      onPriceUpdate: () => {
        // Перерисовываем открытые сделки при обновлении цены
        renderOpenTrades(state.trades, state.mexcWs);
      }
    });
    state.mexcWs.connect();

    // 4. Инициализируем обработчики событий
    initHandlers(state, db);

    // 5. Показ приложения (один раз)
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

      document.getElementById('loader').style.display = 'none';
      document.getElementById('app').style.display    = 'flex';

      setTimeout(() => checkReminders(), 1500);
      loadMexcKeys().catch(() => {});
      setTimeout(() => autoSyncOnOpen(), 3000);
      loadUserSettings(db, state.uid);
    };

    // 6. Firebase realtime listeners
    state.tradesRef.on('value', snap => {
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

    // 7. Фолбэк если Firebase не отвечает
    setTimeout(() => {
      if (!appShown) {
        setStatus('Нет данных — показываем приложение...');
        showApp();
      }
    }, 8000);

  } catch (e) {
    console.error('Boot error:', e);
    const loader = document.getElementById('loader');
    if (loader) {
      loader.innerHTML = `
        <div style="text-align:center;padding:20px;">
          <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
          <div style="color:#f85149;font-size:15px;margin-bottom:8px;">${e.message}</div>
          <button id="reload-btn" style="margin-top:12px;padding:10px 24px;background:#238636;color:white;border:none;border-radius:8px;font-size:15px;cursor:pointer;">
            🔄 Повторить
          </button>
        </div>`;
      document.getElementById('reload-btn')?.addEventListener('click', () => location.reload());
    }
  }
})();
