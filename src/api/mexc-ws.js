// bot-server/mexc-service.js
// Изолированный сервис: слушает Firebase users/{uid}/mexcApiKey|mexcApiSecret,
// запускает ccxt.pro watchMyTrades() воркер на каждого пользователя,
// автоматически создаёт сделки в trades/{uid}/{tradeId} с тегом source:'mexc'
// и триггерит автопостинг в Telegram-канал через bot.telegram.

'use strict';

const ccxt      = require('ccxt');
const admin     = require('firebase-admin');

// ── Константы ───────────────────────────────────────────────────
const MEXC_EXCHANGE_ID = 'mexc';
const POLL_INTERVAL_MS = 5000; // fallback polling для бирж без WS

// ── Состояние воркеров: Map<uid, { exchange, stop: fn }> ────────
const _workers = new Map();

// ── Инициализация ───────────────────────────────────────────────
/**
 * @param {admin.database.Database} db  — Firebase Realtime DB (admin SDK)
 * @param {import('telegraf').Telegraf} bot — инстанс Telegraf (для постинга)
 */
function init(db, bot) {
  console.log('[MexcService] Initializing...');

  // Слушаем ветку users — при добавлении/изменении ключей
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
    // Если воркер уже есть — перезапускаем с новыми ключами
    if (_workers.has(uid)) {
      console.log(`[MexcService] Restarting worker for uid=${uid}`);
      _stopWorker(uid);
    }
    await _startWorker(uid, apiKey, apiSecret, db, bot);
  } else {
    // Ключи удалены — останавливаем воркер
    if (_workers.has(uid)) {
      console.log(`[MexcService] Stopping worker for uid=${uid} (keys removed)`);
      _stopWorker(uid);
    }
  }
}

// ── Запуск воркера для пользователя ────────────────────────────
async function _startWorker(uid, apiKey, apiSecret, db, bot) {
  console.log(`[MexcService] Starting worker for uid=${uid}`);

  let stopped = false;

  try {
    // Используем ccxt (не pro) для REST-based polling,
    // т.к. ccxt.pro требует отдельной лицензии.
    // Для WS замени на: const exchange = new ccxt.pro.mexc({...})
    const exchange = new ccxt[MEXC_EXCHANGE_ID]({
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
      options: { defaultType: 'swap' } // фьючерсы/перпы
    });

    // Получаем уже известные трейды, чтобы не дублировать
    const knownIds = await _loadKnownTradeIds(uid, db);

    // Периодический polling закрытых позиций
    const timer = setInterval(async () => {
      if (stopped) return;
      try {
        await _pollClosedTrades(exchange, uid, db, bot, knownIds);
      } catch (e) {
        console.error(`[MexcService] Poll error uid=${uid}:`, e.message);
      }
    }, POLL_INTERVAL_MS);

    // Первый немедленный запрос
    await _pollClosedTrades(exchange, uid, db, bot, knownIds).catch(e =>
      console.error(`[MexcService] Initial poll error uid=${uid}:`, e.message)
    );

    _workers.set(uid, {
      exchange,
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
async function _pollClosedTrades(exchange, uid, db, bot, knownIds) {
  // fetchMyTrades возвращает исполненные ордера/сделки
  // Для фьючерсов используем fetchClosedOrders или fetchMyTrades
  let trades = [];
  try {
    // MEXC futures: fetchClosedOrders не требует symbol
    const orders = await exchange.fetchClosedOrders(undefined, undefined, 50);
    // Фильтруем только filled ордера — они несут реальный PnL
    trades = orders.filter(o => o.status === 'filled' || o.filled > 0);
  } catch (e) {
    console.warn(`[MexcService] fetchClosedOrders warn uid=${uid}:`, e.message);
    return;
  }

  for (const raw of trades) {
    const externalId = String(raw.id || raw.order || '');
    if (!externalId || knownIds.has(externalId)) continue;

    knownIds.add(externalId);

    const trade = _mapRawTradeToIL(raw, uid);
    if (!trade) continue;

    try {
      await db.ref(`trades/${uid}/${trade.id}`).set(trade);
      console.log(`[MexcService] Saved MEXC trade ${trade.id} for uid=${uid}`);

      // Автопостинг в канал при открытии/закрытии
      await _autoPostToChannel(trade, db, bot, uid);
    } catch (saveErr) {
      console.error(`[MexcService] Save error uid=${uid}:`, saveErr.message);
    }
  }
}

// ── Маппинг сырого трейда MEXC → формат IL-Journal ──────────────
function _mapRawTradeToIL(raw, uid) {
  try {
    const symbol   = (raw.symbol || '').replace('/', '').replace(':USDT', '');
    const side     = raw.side === 'buy' ? 'LONG' : 'SHORT';
    const price    = parseFloat(raw.price || 0);
    const amount   = parseFloat(raw.amount || 0);
    const cost     = parseFloat(raw.cost || price * amount);
    const pnl      = parseFloat(raw.info?.realizedPnl || raw.info?.profit || 0);
    const ts       = raw.timestamp ? new Date(raw.timestamp) : new Date();

    if (!price || !symbol) return null;

    const isClosed = raw.info?.isMaker !== undefined
      || raw.info?.realizedPnl !== undefined
      || raw.info?.status === 'filled';

    const tradeId  = `mexc_${raw.id || Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    return {
      id:           tradeId,
      source:       'mexc',          // ← ключевой тег
      fromMexc:     true,            // ← для обратной совместимости с renderMexcSummary
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
      pnl:          pnl,
      rr:           0,
      plannedRR:    0,
      pnl1:         pnl,
      pnl2:         0,
      status:       isClosed ? 'closed' : 'open',
      result:       isClosed ? (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'be') : 'open',
      closeActions: [],
      strategy:     'MEXC Auto',
      note:         `Авто-импорт MEXC. orderId: ${raw.orderId || raw.order || ''}`,
      emotion:      '',
      followedRM:   null,
      quality:      0,
      images:       [],
      archived:     false,
      closeDate:    isClosed ? ts.toISOString().slice(0, 10) : '',
      closeTime:    isClosed ? ts.toTimeString().slice(0, 5)  : '',
    };
  } catch (e) {
    console.error('[MexcService] Map error:', e.message, raw);
    return null;
  }
}

// ── Загрузка уже известных ID из Firebase (против дублей) ────────
async function _loadKnownTradeIds(uid, db) {
  const set  = new Set();
  try {
    const snap = await db.ref(`trades/${uid}`)
      .orderByChild('source').equalTo('mexc')
      .once('value');
    const val  = snap.val();
    if (val) {
      Object.values(val).forEach(t => {
        if (t.externalId) set.add(t.externalId);
      });
    }
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
    if (!chanData?.channelId || !chanData?.enabled) return;
    if (!chanData.autoPostOpen) return;

    const action  = trade.status === 'open' ? 'open' : 'close';
    const text    = _buildChannelPost(trade, action);

    const sent = await bot.telegram.sendMessage(chanData.channelId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });

    // Сохраняем message_id поста (для reply при обновлениях)
    await db.ref(`channelPosts/${uid}/${trade.id}`).set({
      openPostId:        sent.message_id,
      lastUpdatePostId:  sent.message_id,
      closed:            trade.status === 'closed',
      createdAt:         new Date().toISOString()
    });

    // Обновляем сделку в Firebase — добавляем tg_message_id
    await db.ref(`trades/${uid}/${trade.id}/tg_message_id`).set(sent.message_id);

    console.log(`[MexcService] Posted to channel ${chanData.channelId}, msgId=${sent.message_id}`);
  } catch (e) {
    console.error('[MexcService] autoPostToChannel error:', e.message);
  }
}

// ── Текст поста для канала (упрощённый, без live price на бэкенде) ─
function _buildChannelPost(trade, action) {
  const sideIcon = trade.side === 'LONG' ? '🟢' : '🔴';
  const pnlSign  = (trade.pnl || 0) >= 0 ? '+' : '';
  const pnlColor = (trade.pnl || 0) >= 0 ? '' : '';

  if (action === 'open') {
    return (
      `📈 <b>Открыта сделка (MEXC)</b>\n\n` +
      `<b>${trade.asset}</b> ${sideIcon} ${trade.side} x${trade.leverage || 1}\n\n` +
      `📅 ${trade.date} ${trade.time}\n` +
      `📍 Вход: <b>${trade.entry}</b>\n` +
      `💰 Объём: <b>$${(trade.riskUSD || 0).toFixed(2)}</b>\n\n` +
      `🔗 <a href="https://t.me/ILTradesbot">Смотреть в журнале</a>`
    );
  }

  return (
    `🏁 <b>Сделка закрыта (MEXC)</b> ${(trade.pnl || 0) >= 0 ? '✅' : '❌'}\n\n` +
    `<b>${trade.asset}</b> ${sideIcon} ${trade.side}\n\n` +
    `📅 ${trade.closeDate || trade.date} ${trade.closeTime || trade.time}\n` +
    `📍 Вход: <b>${trade.entry}</b>\n` +
    `💰 Итог PnL: <b>${pnlSign}$${(trade.pnl || 0).toFixed(2)}</b>\n\n` +
    `🔗 <a href="https://t.me/ILTradesbot">Смотреть в журнале</a>`
  );
}

// ── Ручное обновление поста (вызывается из index.js при закрытии) ─
/**
 * При закрытии/обновлении сделки — отправляет reply на первый пост.
 * @param {string} uid
 * @param {object} trade  — обновлённая сделка
 * @param {'partial'|'close'} action
 * @param {admin.database.Database} db
 * @param {import('telegraf').Telegraf} bot
 */
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

    const opts = {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyTo ? { reply_to_message_id: replyTo } : {})
    };

    const sent = await bot.telegram.sendMessage(chanData.channelId, text, opts);

    // Обновляем lastUpdatePostId
    await db.ref(`channelPosts/${uid}/${trade.id}`).update({
      lastUpdatePostId: sent.message_id,
      closed: action === 'close'
    });

    if (trade.tg_message_id == null && action === 'open') {
      await db.ref(`trades/${uid}/${trade.id}/tg_message_id`).set(sent.message_id);
    }
  } catch (e) {
    console.error('[MexcService] postTradeUpdate error:', e.message);
  }
}

module.exports = { init, postTradeUpdate };
