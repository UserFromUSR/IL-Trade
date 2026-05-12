// bot-server/mexc-service.js
// Изолированный сервис: слушает Firebase users/{uid}/mexcApiKey|mexcApiSecret,
// запускает polling закрытых позиций через ccxt (MEXC futures),
// автоматически создаёт сделки в trades/{uid}/{tradeId} с тегом source:'mexc'
// и постит в Telegram-канал.

'use strict';

const ccxt  = require('ccxt');
const admin = require('firebase-admin');

// ── Константы ───────────────────────────────────────────────────
const POLL_INTERVAL_MS = 30000; // 30 секунд между запросами (не спамим)

// Топ фьючерсных пар на MEXC — перебираем их при polling
const FUTURES_SYMBOLS = [
  'BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT',
  'BNB/USDT:USDT', 'XRP/USDT:USDT', 'DOGE/USDT:USDT',
  'ADA/USDT:USDT', 'AVAX/USDT:USDT', 'DOT/USDT:USDT',
  'LINK/USDT:USDT', 'MATIC/USDT:USDT', 'LTC/USDT:USDT',
  'TRX/USDT:USDT', 'ATOM/USDT:USDT', 'UNI/USDT:USDT',
  'APT/USDT:USDT', 'SUI/USDT:USDT', 'OP/USDT:USDT',
  'ARB/USDT:USDT', 'INJ/USDT:USDT'
];

// ── Воркеры: Map<uid, { stop: fn }> ────────────────────────────
const _workers = new Map();

// ── Инициализация ───────────────────────────────────────────────
/**
 * @param {admin.database.Database} db
 * @param {import('telegraf').Telegraf} bot
 */
function init(db, bot) {
  console.log('[MexcService] Initializing...');
  db.ref('users').on('child_changed', snap => _onUserChanged(snap, db, bot));
  db.ref('users').on('child_added',   snap => _onUserChanged(snap, db, bot));
  console.log('[MexcService] Listening for user key changes');
}

// ── Обработчик изменения пользователя ───────────────────────────
async function _onUserChanged(snap, db, bot) {
  const uid  = snap.key;
  const data = snap.val();
  if (!data) return;

  const apiKey    = data.mexcApiKey;
  const apiSecret = data.mexcApiSecret;

  if (apiKey && apiSecret) {
    if (_workers.has(uid)) {
      console.log(`[MexcService] Restarting worker for uid=${uid}`);
      _stopWorker(uid);
    }
    await _startWorker(uid, apiKey, apiSecret, db, bot);
  } else {
    if (_workers.has(uid)) {
      console.log(`[MexcService] Stopping worker for uid=${uid} (keys removed)`);
      _stopWorker(uid);
    }
  }
}

// ── Запуск воркера ───────────────────────────────────────────────
async function _startWorker(uid, apiKey, apiSecret, db, bot) {
  console.log(`[MexcService] Starting worker for uid=${uid}`);

  let stopped    = false;
  let errorCount = 0;

  try {
    const exchange = new ccxt.mexc({
      apiKey,
      secret:          apiSecret,
      enableRateLimit: true,
      options: {
        defaultType: 'swap'   // MEXC futures/perpetuals
      }
    });

    const knownIds = await _loadKnownTradeIds(uid, db);

    // Первый запрос — сразу при старте
    await _pollClosedPositions(exchange, uid, db, bot, knownIds, () => stopped)
      .catch(e => console.error(`[MexcService] Init poll error uid=${uid}:`, e.message));

    const timer = setInterval(async () => {
      if (stopped) return;

      // Экспоненциальный backoff при повторных ошибках
      if (errorCount >= 5) {
        console.warn(`[MexcService] Too many errors for uid=${uid}, pausing 5 min`);
        await new Promise(r => setTimeout(r, 5 * 60 * 1000));
        errorCount = 0;
      }

      try {
        await _pollClosedPositions(exchange, uid, db, bot, knownIds, () => stopped);
        errorCount = 0;
      } catch (e) {
        errorCount++;
        console.error(`[MexcService] Poll error uid=${uid} (#${errorCount}):`, e.message);
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

// ── Остановка воркера ────────────────────────────────────────────
function _stopWorker(uid) {
  const worker = _workers.get(uid);
  if (worker) {
    worker.stop();
    _workers.delete(uid);
    console.log(`[MexcService] Worker stopped uid=${uid}`);
  }
}

// ── Polling закрытых позиций ─────────────────────────────────────
async function _pollClosedPositions(exchange, uid, db, bot, knownIds, isStopped) {
  // Метод 1: fetchMyTrades с конкретными символами
  // MEXC требует symbol при вызове fetchMyTrades
  for (const symbol of FUTURES_SYMBOLS) {
    if (isStopped()) return;

    let trades = [];
    try {
      trades = await exchange.fetchMyTrades(symbol, undefined, 20);
    } catch (e) {
      // Тихо пропускаем — символ может не торговаться
      continue;
    }

    for (const raw of trades) {
      const externalId = String(raw.id || '');
      if (!externalId || knownIds.has(externalId)) continue;
      knownIds.add(externalId);

      const trade = _mapRawTradeToIL(raw, uid);
      if (!trade) continue;

      try {
        await db.ref(`trades/${uid}/${trade.id}`).set(trade);
        console.log(`[MexcService] Saved MEXC trade ${trade.id} (${symbol}) for uid=${uid}`);
        await _autoPostToChannel(trade, db, bot, uid);
      } catch (saveErr) {
        console.error(`[MexcService] Save error uid=${uid}:`, saveErr.message);
      }
    }

    // Небольшая пауза между символами чтобы не превысить rate limit
    await new Promise(r => setTimeout(r, 200));
  }
}

// ── Маппинг сырого трейда MEXC → формат IL-Journal ──────────────
function _mapRawTradeToIL(raw, uid) {
  try {
    // Нормализуем символ: BTC/USDT:USDT → BTCUSDT
    const symbol   = (raw.symbol || '')
      .replace('/USDT:USDT', 'USDT')
      .replace('/', '');
    const side     = raw.side === 'buy' ? 'LONG' : 'SHORT';
    const price    = parseFloat(raw.price || 0);
    const amount   = parseFloat(raw.amount || 0);
    const cost     = parseFloat(raw.cost || price * amount);
    const pnl      = parseFloat(
      raw.info?.realizedPnl || raw.info?.profit || raw.info?.pnl || 0
    );
    const ts       = raw.timestamp ? new Date(raw.timestamp) : new Date();

    if (!price || !symbol) return null;

    const isClosed = !!(
      raw.info?.realizedPnl !== undefined ||
      raw.info?.isMaker !== undefined
    );

    const tradeId = `mexc_${raw.id || Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    return {
      id:           tradeId,
      source:       'mexc',
      fromMexc:     true,
      externalId:   String(raw.id || ''),
      date:         ts.toISOString().slice(0, 10),
      time:         ts.toTimeString().slice(0, 5),
      side,
      asset:        symbol,
      entry:        price,
      stop:         0,
      tp1_price:    0,
      tp2_price:    0,
      tp1_percent:  50,
      deposit:      0,
      leverage:     parseFloat(raw.info?.leverage || 1),
      riskPercent:  0,
      riskUSD:      cost,
      positionBase: cost,
      positionFull: cost,
      pnl,
      rr:           0,
      plannedRR:    0,
      pnl1:         pnl,
      pnl2:         0,
      status:       isClosed ? 'closed' : 'open',
      result:       isClosed ? (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'be') : 'open',
      closeActions: [],
      strategy:     'MEXC Auto',
      note:         `Авто-импорт MEXC. orderId: ${raw.orderId || raw.order || raw.id || ''}`,
      emotion:      '',
      followedRM:   null,
      quality:      0,
      images:       [],
      archived:     false,
      closeDate:    isClosed ? ts.toISOString().slice(0, 10) : '',
      closeTime:    isClosed ? ts.toTimeString().slice(0, 5)  : '',
    };
  } catch (e) {
    console.error('[MexcService] Map error:', e.message);
    return null;
  }
}

// ── Загрузка уже известных externalId (против дублей) ────────────
async function _loadKnownTradeIds(uid, db) {
  const set = new Set();
  try {
    const snap = await db.ref(`trades/${uid}`)
      .orderByChild('source').equalTo('mexc')
      .once('value');
    const val = snap.val();
    if (val) {
      Object.values(val).forEach(t => {
        if (t.externalId) set.add(t.externalId);
      });
    }
    console.log(`[MexcService] Loaded ${set.size} known MEXC trade IDs for uid=${uid}`);
  } catch (e) {
    console.warn('[MexcService] loadKnownTradeIds warn:', e.message);
  }
  return set;
}

// ── Автопостинг в Telegram-канал ─────────────────────────────────
async function _autoPostToChannel(trade, db, bot, uid) {
  try {
    const chanSnap = await db.ref(`channel/${uid}`).once('value');
    const chanData = chanSnap.val();
    if (!chanData?.channelId || !chanData?.enabled || !chanData?.autoPostOpen) return;

    const action = trade.status === 'open' ? 'open' : 'close';
    const text   = _buildChannelPost(trade, action);

    const sent = await bot.telegram.sendMessage(chanData.channelId, text, {
      parse_mode:               'HTML',
      disable_web_page_preview: true
    });

    await db.ref(`channelPosts/${uid}/${trade.id}`).set({
      openPostId:       sent.message_id,
      lastUpdatePostId: sent.message_id,
      closed:           trade.status === 'closed',
      createdAt:        new Date().toISOString()
    });

    await db.ref(`trades/${uid}/${trade.id}/tg_message_id`).set(sent.message_id);
    console.log(`[MexcService] Posted to channel for uid=${uid}, msgId=${sent.message_id}`);
  } catch (e) {
    console.error('[MexcService] autoPostToChannel error:', e.message);
  }
}

// ── Текст поста ──────────────────────────────────────────────────
function _buildChannelPost(trade, action) {
  const fmt      = (v, d = 2) => (isNaN(v) ? '0' : (+v).toFixed(d));
  const sideIcon = trade.side === 'LONG' ? '🟢' : '🔴';

  if (action === 'open') {
    return (
      `📈 <b>Открыта сделка [MEXC]</b>\n\n` +
      `<b>${trade.asset}</b> ${sideIcon} ${trade.side} x${trade.leverage || 1}\n\n` +
      `📅 ${trade.date} ${trade.time}\n` +
      `📍 Вход: <b>${trade.entry}</b>\n` +
      `💰 Объём: <b>$${fmt(trade.riskUSD || 0)}</b>\n\n` +
      `🔗 <a href="https://t.me/ILTradesbot">Смотреть в журнале</a>`
    );
  }
  const pnlSign = (trade.pnl || 0) >= 0 ? '+' : '';
  return (
    `🏁 <b>Сделка закрыта [MEXC]</b> ${(trade.pnl || 0) >= 0 ? '✅' : '❌'}\n\n` +
    `<b>${trade.asset}</b> ${sideIcon} ${trade.side}\n\n` +
    `📅 ${trade.closeDate || trade.date} ${trade.closeTime || trade.time}\n` +
    `📍 Вход: <b>${trade.entry}</b>\n` +
    `💰 Итог PnL: <b>${pnlSign}$${fmt(trade.pnl || 0)}</b>\n\n` +
    `🔗 <a href="https://t.me/ILTradesbot">Смотреть в журнале</a>`
  );
}

// ── Ручное обновление поста (из index.js при partial/close) ──────
async function postTradeUpdate(uid, trade, action, db, bot) {
  try {
    const [chanSnap, postSnap] = await Promise.all([
      db.ref(`channel/${uid}`).once('value'),
      db.ref(`channelPosts/${uid}/${trade.id}`).once('value')
    ]);
    const chanData = chanSnap.val();
    const postData = postSnap.val();
    if (!chanData?.channelId || !chanData?.enabled) return;

    const postEnabled =
      (action === 'partial' && chanData.autoPostPartial) ||
      (action === 'close'   && chanData.autoPostClose);
    if (!postEnabled) return;

    const replyTo = postData?.lastUpdatePostId || postData?.openPostId || null;
    const text    = _buildChannelPost(trade, action);
    const opts    = {
      parse_mode:               'HTML',
      disable_web_page_preview: true,
      ...(replyTo ? { reply_to_message_id: replyTo } : {})
    };

    const sent = await bot.telegram.sendMessage(chanData.channelId, text, opts);
    await db.ref(`channelPosts/${uid}/${trade.id}`).update({
      lastUpdatePostId: sent.message_id,
      closed:           action === 'close'
    });
  } catch (e) {
    console.error('[MexcService] postTradeUpdate error:', e.message);
  }
}

module.exports = { init, postTradeUpdate };
