// bot-server/mexc-service.js
// Сервис синхронизации MEXC:
// - Открытые позиции  → trades/{uid}/{id}  status:'open'   → вкладка "Открытые"
// - Закрытые позиции → trades/{uid}/{id}  status:'closed' → вкладка "MEXC" в итогах
//
// Использует fetchPositions() для открытых и fetchMyTrades() для истории.

'use strict';

const ccxt  = require('ccxt');
const admin = require('firebase-admin');

const POLL_INTERVAL_MS = 30_000; // 30 сек

// ── Воркеры ──────────────────────────────────────────────────────
const _workers = new Map();

// ── Инициализация ─────────────────────────────────────────────────
function init(db, bot) {
  console.log('[MexcService] Initializing...');
  db.ref('users').on('child_changed', snap => _onUserChanged(snap, db, bot));
  db.ref('users').on('child_added',   snap => _onUserChanged(snap, db, bot));
  console.log('[MexcService] Listening for user key changes');
}

// ── Обработчик изменения пользователя ────────────────────────────
async function _onUserChanged(snap, db, bot) {
  const uid     = snap.key;
  const data    = snap.val();
  if (!data) return;

  const apiKey    = data.mexcApiKey;
  const apiSecret = data.mexcApiSecret;

  if (apiKey && apiSecret) {
    if (_workers.has(uid)) {
      _stopWorker(uid);
    }
    await _startWorker(uid, apiKey, apiSecret, db, bot);
  } else {
    if (_workers.has(uid)) _stopWorker(uid);
  }
}

// ── Запуск воркера ────────────────────────────────────────────────
async function _startWorker(uid, apiKey, apiSecret, db, bot) {
  console.log(`[MexcService] Starting worker for uid=${uid}`);
  let stopped = false;
  let errorCount = 0;

  try {
    const exchange = new ccxt.mexc({
      apiKey,
      secret:          apiSecret,
      enableRateLimit: true,
      options:         { defaultType: 'swap' }
    });

    // Загружаем уже известные externalId закрытых сделок
    const knownClosedIds = await _loadKnownClosedIds(uid, db);

    // Первый полл сразу
    await _poll(exchange, uid, db, bot, knownClosedIds, () => stopped)
      .catch(e => console.error(`[MexcService] Init poll uid=${uid}:`, e.message));

    const timer = setInterval(async () => {
      if (stopped) return;
      if (errorCount >= 5) {
        console.warn(`[MexcService] Too many errors uid=${uid}, pause 5min`);
        await new Promise(r => setTimeout(r, 5 * 60 * 1000));
        errorCount = 0;
      }
      try {
        await _poll(exchange, uid, db, bot, knownClosedIds, () => stopped);
        errorCount = 0;
      } catch (e) {
        errorCount++;
        console.error(`[MexcService] Poll error uid=${uid} #${errorCount}:`, e.message);
      }
    }, POLL_INTERVAL_MS);

    _workers.set(uid, {
      stop: () => {
        stopped = true;
        clearInterval(timer);
        exchange.close?.().catch(() => {});
      }
    });

    console.log(`[MexcService] Worker started uid=${uid}`);
  } catch (e) {
    console.error(`[MexcService] Failed to start worker uid=${uid}:`, e.message);
  }
}

function _stopWorker(uid) {
  const w = _workers.get(uid);
  if (w) { w.stop(); _workers.delete(uid); }
}

// ── Главный цикл ──────────────────────────────────────────────────
async function _poll(exchange, uid, db, bot, knownClosedIds, isStopped) {
  // 1. Синхронизируем открытые позиции (+ переводим pending→open)
  await _syncOpenPositions(exchange, uid, db, bot, isStopped);

  if (isStopped()) return;

  // 2. Переводим open→closed для позиций которые закрылись на бирже
  await _syncClosedTrades(exchange, uid, db, bot, knownClosedIds, isStopped);

  if (isStopped()) return;

  // 3. Обновляем статус лимитных ордеров (pending→open или pending→cancelled)
  await _syncPendingOrders(exchange, uid, db, bot, isStopped);
}


// ── 0. Лимитные ордера: pending → open / cancelled ────────────────
async function _syncPendingOrders(exchange, uid, db, bot, isStopped) {
  // Получаем все pending-записи из Firebase
  const snap = await db.ref(`trades/${uid}`)
    .orderByChild('status').equalTo('pending').once('value');
  const pendingTrades = snap.val() || {};
  if (!Object.keys(pendingTrades).length) return;

  // Получаем актуальные открытые ордера с биржи
  let openOrders = [];
  try {
    openOrders = await exchange.fetchOpenOrders();
  } catch (e) {
    console.warn(`[MexcService] fetchOpenOrders error uid=${uid}:`, e.message);
    return;
  }

  const openOrderIds = new Set(openOrders.map(o => 'pending_' + String(o.id)));

  for (const [tradeId, trade] of Object.entries(pendingTrades)) {
    if (isStopped()) return;

    const stillOpen = openOrderIds.has(trade.externalId);

    if (stillOpen) continue; // ордер всё ещё ожидает — ничего не делаем

    // Ордер исчез из открытых — проверяем был ли он исполнен
    // Ищем среди открытых позиций совпадение по активу и стороне
    let positions = [];
    try {
      positions = await exchange.fetchPositions();
    } catch (e) { continue; }

    const activePos = positions.find(p => {
      const sym  = _normalizeSymbol(p.symbol);
      const side = p.side === 'long' ? 'LONG' : 'SHORT';
      return sym === trade.asset && side === trade.side &&
             parseFloat(p.contracts || 0) > 0;
    });

    if (activePos) {
      // Ордер исполнился → переводим в open (вкладка "Открытые")
      const entry    = parseFloat(activePos.entryPrice || activePos.info?.openAvgPrice || trade.entry);
      const leverage = parseFloat(activePos.leverage || activePos.info?.leverage || trade.leverage || 1);
      const notional = parseFloat(activePos.notional || activePos.info?.positionValue || 0);
      const margin   = parseFloat(activePos.initialMargin || notional / leverage || trade.riskUSD || 0);

      await db.ref(`trades/${uid}/${tradeId}`).update({
        status:      'open',
        result:      'open',
        entry,
        leverage,
        riskUSD:      margin,
        positionBase: margin,
        positionFull: notional,
        positionKey:  _positionKey(activePos),
        note:         `Активирован с биржи MEXC. Вход: ${entry}`
      });
      console.log(`[MexcService] Pending→Open: ${trade.asset} ${trade.side} uid=${uid}`);
      await _autoPostToChannel({ ...trade, status: 'open', entry }, db, bot, uid);
    } else {
      // Ордер отменён → помечаем cancelled (убираем из обеих вкладок)
      await db.ref(`trades/${uid}/${tradeId}`).update({
        status: 'cancelled',
        result: 'cancelled'
      });
      console.log(`[MexcService] Pending→Cancelled: ${trade.asset} ${trade.side} uid=${uid}`);
    }
  }
}

// ── 1. Открытые позиции ───────────────────────────────────────────
async function _syncOpenPositions(exchange, uid, db, bot, isStopped) {
  let positions = [];
  try {
    positions = await exchange.fetchPositions();
  } catch (e) {
    console.warn(`[MexcService] fetchPositions error uid=${uid}:`, e.message);
    return;
  }

  // Активные позиции (с ненулевым размером)
  const active = positions.filter(p =>
    p.contracts && parseFloat(p.contracts) > 0
  );

  // Получаем текущие открытые MEXC-сделки в Firebase
  const snap = await db.ref(`trades/${uid}`)
    .orderByChild('source').equalTo('mexc').once('value');
  const existing = snap.val() || {};

  const currentOpenIds = new Set(
    Object.values(existing)
      .filter(t => t.status === 'open' && t.fromMexc)
      .map(t => t.positionKey)
      .filter(Boolean)
  );

  const activeKeys = new Set();

  for (const pos of active) {
    if (isStopped()) return;

    const posKey  = _positionKey(pos);
    activeKeys.add(posKey);

    // Ищем существующую запись с этим positionKey
    const existingTrade = Object.values(existing).find(
      t => t.positionKey === posKey && t.status === 'open'
    );

    const mapped = _mapPositionToTrade(pos, uid, existingTrade?.id);

    try {
      await db.ref(`trades/${uid}/${mapped.id}`).set(mapped);
      console.log(`[MexcService] Open position upserted: ${mapped.asset} ${mapped.side} uid=${uid}`);
    } catch (e) {
      console.error(`[MexcService] Save open position error uid=${uid}:`, e.message);
    }
  }

  // Позиции которые были открыты но сейчас закрылись на бирже →
  // помечаем их закрытыми (Railway их потом найдёт в истории и обновит PnL)
  for (const [tradeId, trade] of Object.entries(existing)) {
    if (!trade.fromMexc || trade.status !== 'open' || !trade.positionKey) continue;
    if (!activeKeys.has(trade.positionKey)) {
      // Позиция закрылась — обновляем статус
      try {
        await db.ref(`trades/${uid}/${tradeId}`).update({
          status:    'closed',
          result:    'unknown', // обновится из истории
          closeDate: new Date().toISOString().slice(0, 10),
          closeTime: new Date().toTimeString().slice(0, 5)
        });
        console.log(`[MexcService] Position closed: ${trade.asset} uid=${uid}`);
      } catch (e) {
        console.error(`[MexcService] Close position update error:`, e.message);
      }
    }
  }
}

// ── 2. Закрытые сделки из истории ─────────────────────────────────
const FUTURES_SYMBOLS = [
  'BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT',
  'BNB/USDT:USDT', 'XRP/USDT:USDT', 'DOGE/USDT:USDT',
  'ADA/USDT:USDT', 'AVAX/USDT:USDT', 'DOT/USDT:USDT',
  'LINK/USDT:USDT', 'TRX/USDT:USDT', 'ATOM/USDT:USDT',
  'APT/USDT:USDT', 'SUI/USDT:USDT', 'OP/USDT:USDT',
  'ARB/USDT:USDT', 'INJ/USDT:USDT'
];

async function _syncClosedTrades(exchange, uid, db, bot, knownClosedIds, isStopped) {
  for (const symbol of FUTURES_SYMBOLS) {
    if (isStopped()) return;

    let trades = [];
    try {
      trades = await exchange.fetchMyTrades(symbol, undefined, 20);
    } catch (_) { continue; }

    for (const raw of trades) {
      // Только закрывающие сделки (с реализованным PnL)
      const pnl = parseFloat(raw.info?.realizedPnl ?? raw.info?.profit ?? 'NaN');
      if (isNaN(pnl) || raw.info?.realizedPnl === undefined) continue;

      const externalId = String(raw.id || '');
      if (!externalId || knownClosedIds.has(externalId)) continue;
      knownClosedIds.add(externalId);

      const mapped = _mapClosedTradeToIL(raw, uid);
      if (!mapped) continue;

      try {
        // Проверяем — есть ли открытая позиция с этим активом которую нужно обновить
        const openSnap = await db.ref(`trades/${uid}`)
          .orderByChild('asset').equalTo(mapped.asset).once('value');
        const openTrades = openSnap.val() || {};
        const matchOpen  = Object.entries(openTrades).find(
          ([, t]) => t.fromMexc && t.status === 'closed' && t.result === 'unknown'
            && t.side === mapped.side
        );

        if (matchOpen) {
          // Обновляем существующую запись реальными данными
          const [matchId] = matchOpen;
          await db.ref(`trades/${uid}/${matchId}`).update({
            pnl,
            result:    pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'be',
            externalId,
            closeDate: mapped.closeDate,
            closeTime: mapped.closeTime,
            note:      mapped.note
          });
          console.log(`[MexcService] Updated closed trade ${matchId} pnl=${pnl} uid=${uid}`);
        } else {
          // Новая закрытая сделка из истории
          await db.ref(`trades/${uid}/${mapped.id}`).set(mapped);
          console.log(`[MexcService] Saved closed trade ${mapped.asset} pnl=${pnl} uid=${uid}`);
          await _autoPostToChannel(mapped, db, bot, uid);
        }
      } catch (e) {
        console.error(`[MexcService] Save closed trade error uid=${uid}:`, e.message);
      }
    }

    await new Promise(r => setTimeout(r, 200));
  }
}

// ── Маппинг открытой позиции → формат IL-Journal ──────────────────
function _mapPositionToTrade(pos, uid, existingId) {
  const symbol   = _normalizeSymbol(pos.symbol);
  const side     = pos.side === 'long' ? 'LONG' : 'SHORT';
  const entry    = parseFloat(pos.entryPrice || pos.info?.openAvgPrice || 0);
  const leverage = parseFloat(pos.leverage || pos.info?.leverage || 1);
  const notional = parseFloat(pos.notional || pos.info?.positionValue || 0);
  const margin   = parseFloat(pos.initialMargin || pos.info?.im || notional / leverage || 0);
  const ts       = pos.timestamp ? new Date(pos.timestamp) : new Date();

  const id = existingId || `mexc_pos_${symbol}_${side}_${Date.now()}`;

  return {
    id,
    source:       'mexc',
    fromMexc:     true,
    positionKey:  _positionKey(pos),
    date:         ts.toISOString().slice(0, 10),
    time:         ts.toTimeString().slice(0, 5),
    side,
    asset:        symbol,
    entry,
    stop:         0,
    tp1_price:    0,
    tp2_price:    0,
    tp1_percent:  50,
    deposit:      margin,
    leverage,
    riskPercent:  0,
    riskUSD:      margin,
    positionBase: margin,
    positionFull: notional,
    pnl:          0,
    rr:           0,
    plannedRR:    0,
    pnl1:         0,
    pnl2:         0,
    status:       'open',
    result:       'open',
    closeActions: [],
    strategy:     'MEXC Auto',
    note:         `Открытая позиция MEXC. x${leverage}`,
    emotion:      '',
    followedRM:   null,
    quality:      0,
    images:       [],
    archived:     false,
    closeDate:    '',
    closeTime:    ''
  };
}

// ── Маппинг закрытой сделки из истории → формат IL-Journal ────────
function _mapClosedTradeToIL(raw, uid) {
  try {
    const symbol   = _normalizeSymbol(raw.symbol);
    const side     = raw.side === 'buy' ? 'LONG' : 'SHORT';
    const entry    = parseFloat(raw.price || 0);
    const cost     = parseFloat(raw.cost || 0);
    const pnl      = parseFloat(raw.info?.realizedPnl || 0);
    const leverage = parseFloat(raw.info?.leverage || 1);
    const ts       = raw.timestamp ? new Date(raw.timestamp) : new Date();
    if (!entry || !symbol) return null;

    return {
      id:           `mexc_${raw.id}_${Math.random().toString(36).slice(2, 5)}`,
      source:       'mexc',
      fromMexc:     true,
      externalId:   String(raw.id || ''),
      date:         ts.toISOString().slice(0, 10),
      time:         ts.toTimeString().slice(0, 5),
      closeDate:    ts.toISOString().slice(0, 10),
      closeTime:    ts.toTimeString().slice(0, 5),
      side,
      asset:        symbol,
      entry,
      stop:         0,
      tp1_price:    0,
      tp2_price:    0,
      tp1_percent:  50,
      deposit:      cost / leverage,
      leverage,
      riskPercent:  0,
      riskUSD:      cost / leverage,
      positionBase: cost / leverage,
      positionFull: cost,
      pnl,
      rr:           0,
      plannedRR:    0,
      pnl1:         pnl,
      pnl2:         0,
      status:       'closed',
      result:       pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'be',
      closeActions: [],
      strategy:     'MEXC Auto',
      note:         `Авто-импорт MEXC. orderId: ${raw.orderId || raw.id || ''}`,
      emotion:      '',
      followedRM:   null,
      quality:      0,
      images:       [],
      archived:     false
    };
  } catch (e) {
    console.error('[MexcService] Map error:', e.message);
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────

// Нормализует символ в формат BTCUSDT
function _normalizeSymbol(raw) {
  return (raw || '')
    .replace('/USDT:USDT', 'USDT')
    .replace('/USDT', 'USDT')
    .replace('_USDT', 'USDT')
    .replace('/', '')
    .toUpperCase()
    .trim();
}

// Уникальный ключ позиции (символ + сторона)
function _positionKey(pos) {
  const sym  = _normalizeSymbol(pos.symbol);
  const side = pos.side === 'long' ? 'LONG' : 'SHORT';
  return `${sym}_${side}`;
}

// Загружаем уже известные externalId закрытых сделок
async function _loadKnownClosedIds(uid, db) {
  const set = new Set();
  try {
    const snap = await db.ref(`trades/${uid}`)
      .orderByChild('source').equalTo('mexc').once('value');
    const val = snap.val();
    if (val) {
      Object.values(val).forEach(t => {
        if (t.externalId) set.add(t.externalId);
      });
    }
    console.log(`[MexcService] Loaded ${set.size} known MEXC IDs for uid=${uid}`);
  } catch (e) {
    console.warn('[MexcService] loadKnownClosedIds warn:', e.message);
  }
  return set;
}

// Автопостинг в Telegram-канал (только при закрытии)
async function _autoPostToChannel(trade, db, bot, uid) {
  try {
    const chanSnap = await db.ref(`channel/${uid}`).once('value');
    const chan     = chanSnap.val();
    if (!chan?.channelId || !chan?.enabled) return;

    const action = trade.status === 'open' ? 'open' : 'close';
    if (action === 'open'  && !chan.autoPostOpen)  return;
    if (action === 'close' && !chan.autoPostClose) return;

    const fmt      = (v, d = 2) => (isNaN(v) ? '0' : (+v).toFixed(d));
    const sideIcon = trade.side === 'LONG' ? '🟢' : '🔴';
    const pnlSign  = (trade.pnl || 0) >= 0 ? '+' : '';

    const text = action === 'open'
      ? `📈 <b>Открыта позиция [MEXC]</b>\n\n<b>${trade.asset}</b> ${sideIcon} ${trade.side} x${trade.leverage}\n📍 Вход: <b>${trade.entry}</b>\n💰 Маржа: <b>$${fmt(trade.riskUSD)}</b>\n\n🔗 <a href="https://t.me/ILTradesbot">Смотреть в журнале</a>`
      : `🏁 <b>Позиция закрыта [MEXC]</b> ${(trade.pnl || 0) >= 0 ? '✅' : '❌'}\n\n<b>${trade.asset}</b> ${sideIcon} ${trade.side}\n💰 PnL: <b>${pnlSign}$${fmt(trade.pnl)}</b>\n\n🔗 <a href="https://t.me/ILTradesbot">Смотреть в журнале</a>`;

    const sent = await bot.telegram.sendMessage(chan.channelId, text, {
      parse_mode: 'HTML', disable_web_page_preview: true
    });

    await db.ref(`channelPosts/${uid}/${trade.id}`).set({
      openPostId: sent.message_id, lastUpdatePostId: sent.message_id,
      closed: trade.status === 'closed', createdAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('[MexcService] autoPost error:', e.message);
  }
}

module.exports = { init };
