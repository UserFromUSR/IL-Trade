// bot-server/index.js
// Telegram Bot — Telegraf + Inline-кнопка для запуска Mini App
// + Channel Post API endpoint  + MexcService integration

'use strict';

const { Telegraf, Markup } = require('telegraf');
const express              = require('express');
const admin                = require('firebase-admin');
const mexcService          = require('./mexc-service');

// ── Config ──────────────────────────────────────────────────────
const BOT_TOKEN    = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://il-trade.web.app';
const PORT         = process.env.PORT         || 3000;

const FIREBASE_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : null;
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://il-trade-default-rtdb.firebaseio.com';

if (!BOT_TOKEN) {
  console.error('[Bot] FATAL: BOT_TOKEN env variable is not set');
  process.exit(1);
}

// ── Firebase Admin SDK ──────────────────────────────────────────
let db = null;
function initFirebase() {
  if (admin.apps.length > 0) return;
  try {
    if (FIREBASE_SERVICE_ACCOUNT) {
      admin.initializeApp({
        credential:  admin.credential.cert(FIREBASE_SERVICE_ACCOUNT),
        databaseURL: FIREBASE_DB_URL
      });
    } else {
      admin.initializeApp({ databaseURL: FIREBASE_DB_URL });
    }
    db = admin.database();
    console.log('[Firebase] Admin SDK initialized');
  } catch (e) {
    console.error('[Firebase] Init error:', e.message);
  }
}

// ── Bot instance ────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

bot.catch((err, ctx) => {
  console.error(`[Bot] Error for ${ctx.updateType}:`, err.message ?? err);
});

// ── /start ──────────────────────────────────────────────────────
bot.start(async ctx => {
  try {
    const firstName = ctx.from?.first_name || 'трейдер';
    await ctx.replyWithHTML(
      `👋 Привет, <b>${firstName}</b>!\n\n` +
      `📓 <b>IL-Trading Journal PRO+</b> — твой персональный торговый журнал.\n\n` +
      `Нажми кнопку ниже, чтобы открыть приложение 👇`,
      Markup.inlineKeyboard([
        Markup.button.webApp('📊 Открыть журнал', MINI_APP_URL)
      ])
    );
  } catch (e) {
    console.error('[/start]', e.message);
  }
});

// ── /help ───────────────────────────────────────────────────────
bot.help(async ctx => {
  try {
    await ctx.replyWithHTML(
      `<b>IL-Trading Journal — Команды</b>\n\n` +
      `/start — Открыть торговый журнал\n` +
      `/help  — Список команд\n` +
      `/stats — Краткая статистика\n`
    );
  } catch (e) {
    console.error('[/help]', e.message);
  }
});

// ── /stats ──────────────────────────────────────────────────────
bot.command('stats', async ctx => {
  try {
    await ctx.replyWithHTML(
      `📈 <b>Статистика</b>\n\n` +
      `Откройте приложение для просмотра подробной статистики:`,
      Markup.inlineKeyboard([
        Markup.button.webApp('📊 Открыть журнал', MINI_APP_URL)
      ])
    );
  } catch (e) {
    console.error('[/stats]', e.message);
  }
});

// ── Inline query ────────────────────────────────────────────────
bot.on('inline_query', async ctx => {
  try {
    await ctx.answerInlineQuery([], {
      switch_pm_text:      '📊 Открыть журнал',
      switch_pm_parameter: 'open'
    });
  } catch (e) {
    console.error('[inline_query]', e.message);
  }
});

// ── Express API server ──────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));


app.post('/api/sync', async (req, res) => {
  try {
    const { uid, apiKey, apiSecret, limit = 50 } = req.body;
    if (!uid || !apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Missing uid, apiKey or apiSecret' });
    }

    if (!db) return res.status(503).json({ error: 'Firebase not initialized' });

    // Динамически импортируем ccxt чтобы не ломать старт если пакет не установлен
    let ccxt;
    try { ccxt = require('ccxt'); } catch (e) {
      return res.status(503).json({ error: 'ccxt not available: ' + e.message });
    }

    const exchange = new ccxt.mexc({
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
      options: { defaultType: 'swap' }
    });

    const SYMBOLS = [
      'BTC/USDT:USDT', 'ETH/USDT:USDT', 'SOL/USDT:USDT',
      'BNB/USDT:USDT', 'XRP/USDT:USDT', 'DOGE/USDT:USDT',
      'ADA/USDT:USDT', 'AVAX/USDT:USDT', 'DOT/USDT:USDT',
      'LINK/USDT:USDT', 'TRX/USDT:USDT', 'ATOM/USDT:USDT',
      'APT/USDT:USDT', 'SUI/USDT:USDT', 'OP/USDT:USDT',
      'ARB/USDT:USDT', 'INJ/USDT:USDT'
    ];

    // Загружаем уже известные externalId
    const knownSnap = await db.ref(`trades/${uid}`)
      .orderByChild('source').equalTo('mexc').once('value');
    const knownIds = new Set();
    const existing = knownSnap.val();
    if (existing) {
      Object.values(existing).forEach(t => { if (t.externalId) knownIds.add(t.externalId); });
    }

    let imported = 0;

    for (const symbol of SYMBOLS) {
      let trades = [];
      try {
        trades = await exchange.fetchMyTrades(symbol, undefined, Number(limit));
      } catch (_) { continue; }

      for (const raw of trades) {
        const externalId = String(raw.id || '');
        if (!externalId || knownIds.has(externalId)) continue;
        knownIds.add(externalId);

        const sym    = (raw.symbol || '').replace('/USDT:USDT', 'USDT').replace('/', '');
        const side   = raw.side === 'buy' ? 'LONG' : 'SHORT';
        const price  = parseFloat(raw.price || 0);
        const cost   = parseFloat(raw.cost || 0);
        const pnl    = parseFloat(raw.info?.realizedPnl || raw.info?.profit || 0);
        const ts     = raw.timestamp ? new Date(raw.timestamp) : new Date();
        if (!price || !sym) continue;

        const tradeId = `mexc_${raw.id}_${Math.random().toString(36).slice(2, 6)}`;
        const isClosed = raw.info?.realizedPnl !== undefined;

        await db.ref(`trades/${uid}/${tradeId}`).set({
          id: tradeId, source: 'mexc', fromMexc: true,
          externalId, date: ts.toISOString().slice(0, 10),
          time: ts.toTimeString().slice(0, 5),
          side, asset: sym, entry: price, stop: 0,
          tp1_price: 0, tp2_price: 0, tp1_percent: 50,
          deposit: 0, leverage: parseFloat(raw.info?.leverage || 1),
          riskPercent: 0, riskUSD: cost,
          positionBase: cost, positionFull: cost, pnl,
          rr: 0, plannedRR: 0, pnl1: pnl, pnl2: 0,
          status: isClosed ? 'closed' : 'open',
          result: isClosed ? (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'be') : 'open',
          closeActions: [], strategy: 'MEXC Auto',
          note: `Авто-импорт MEXC. orderId: ${raw.orderId || raw.id || ''}`,
          emotion: '', followedRM: null, quality: 0,
          images: [], archived: false,
          closeDate: isClosed ? ts.toISOString().slice(0, 10) : '',
          closeTime: isClosed ? ts.toTimeString().slice(0, 5) : ''
        });
        imported++;
      }
      await new Promise(r => setTimeout(r, 150));
    }

    console.log(`[/api/sync] uid=${uid} imported=${imported}`);
    return res.json({ success: true, imported });
  } catch (e) {
    console.error('[/api/sync]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/:projectId/channel/post', async (req, res) => {
  try {
    const { trade, action, channelId, replyToMessageId } = req.body;

    if (!trade || !channelId) {
      return res.status(400).json({ error: 'Missing trade or channelId' });
    }

    const initData = req.headers['x-telegram-init-data'] || '';
    const uid      = _extractUidFromInitData(initData) || trade.userId;
    const text     = _buildChannelPostText(trade, action || 'open');
    const opts     = {
      parse_mode:               'HTML',
      disable_web_page_preview: true,
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {})
    };

    const sent = await bot.telegram.sendMessage(channelId, text, opts);

    if (uid && db && sent?.message_id) {
      const postsRef = db.ref(`channelPosts/${uid}/${trade.id}`);
      const snap     = await postsRef.once('value');
      const existing = snap.val() || {};
      const update   = {
        lastUpdatePostId: sent.message_id,
        closed:           action === 'close'
      };
      if (!existing.openPostId || action === 'open') {
        update.openPostId = sent.message_id;
        update.createdAt  = new Date().toISOString();
        await db.ref(`trades/${uid}/${trade.id}/tg_message_id`).set(sent.message_id);
      }
      await postsRef.update(update);
    }

    return res.json({ success: true, message_id: sent?.message_id });
  } catch (e) {
    console.error('[channel/post]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── Helpers ─────────────────────────────────────────────────────

function _extractUidFromInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const user   = JSON.parse(decodeURIComponent(params.get('user') || '{}'));
    return user.id ? String(user.id) : null;
  } catch (_) {
    return null;
  }
}

function _buildChannelPostText(trade, action) {
  const fmt      = (v, d = 2) => (isNaN(v) ? '0' : (+v).toFixed(d));
  const sideIcon = trade.side === 'LONG' ? '🟢' : '🔴';
  const leverage = trade.leverage || 1;
  const riskUSD  = trade.riskUSD || (trade.deposit * (trade.riskPercent || 0) / 100);

  const stopDist    = trade.entry && trade.stop
    ? Math.abs(trade.entry - trade.stop) / trade.entry * 100 : 0;
  const stopPnlLoss = -(riskUSD * leverage * (stopDist / 100));

  const tp1ProfitPct = trade.tp1_price && trade.entry
    ? Math.abs(trade.tp1_price - trade.entry) / trade.entry * 100 : 0;
  const tp2ProfitPct = trade.tp2_price && trade.entry
    ? Math.abs(trade.tp2_price - trade.entry) / trade.entry * 100 : 0;

  const closeActions = trade.closeActions || [];
  const realizedPnl  = closeActions.reduce((s, a) => s + (a.pnl || 0), 0);

  const plannedPnl1 = trade.pnl1 || 0;
  const plannedPnl2 = trade.pnl2 || 0;
  const totalPlan   = plannedPnl1 + plannedPnl2;
  const plannedRR   = totalPlan > 0 && Math.abs(stopPnlLoss) > 0
    ? totalPlan / Math.abs(stopPnlLoss) : (trade.rr || 0);

  const sourceBadge = trade.source === 'mexc' ? ' [MEXC]' : '';

  if (action === 'open') {
    return (
      `📈 <b>Открыта сделка${sourceBadge}</b>\n\n` +
      `<b>${trade.asset}</b> ${sideIcon} ${trade.side}${leverage > 1 ? ` x${leverage}` : ''}\n\n` +
      `📅 ${(trade.date || '').split('-').reverse().join('.')} ${trade.time || ''}\n` +
      `💰 Объём: <b>$${fmt(riskUSD)}</b>${trade.riskPercent ? ` (${trade.riskPercent}%)` : ''} <b>x${leverage}</b>\n\n` +
      `📍 Вход: <b>${trade.entry?.toLocaleString?.() || trade.entry || '—'}</b>\n` +
      `🛑 Стоп: <b>${trade.stop?.toLocaleString?.() || trade.stop || '—'}</b>${stopDist > 0 ? ` (${fmt(stopDist, 2)}%)` : ''}\n` +
      `💸 Стоп PnL: <b>${fmt(stopPnlLoss)}</b>\n\n` +
      (trade.tp1_price ? `🎯 TP1: <b>${trade.tp1_price}</b>${tp1ProfitPct > 0 ? ` (+${fmt(tp1ProfitPct, 2)}%)` : ''}\n` : '') +
      (trade.tp2_price ? `🎯 TP2: <b>${trade.tp2_price}</b>${tp2ProfitPct > 0 ? ` (+${fmt(tp2ProfitPct, 2)}%)` : ''}\n` : '') +
      `\n📊 Плановый RR: <b>${plannedRR > 0 ? '1:' + fmt(plannedRR, 2) : '—'}</b>\n` +
      (trade.strategy ? `📐 Стратегия: ${trade.strategy}\n` : '') +
      `\n🔗 <a href="https://t.me/ILTradesbot">Смотреть в журнале</a>`
    );
  }

  if (action === 'partial') {
    const closedPct = closeActions.reduce((s, a) => s + (a.pct || 0), 0);
    const remPct    = 100 - closedPct;
    const actualRR  = Math.abs(realizedPnl) > 0 && Math.abs(stopPnlLoss) > 0
      ? Math.abs(realizedPnl) / Math.abs(stopPnlLoss) : 0;
    const history   = closeActions.map((a, i) =>
      `${i + 1}. ${a.label} → ${(a.pnl || 0) >= 0 ? '+' : ''}$${fmt(a.pnl || 0)}`
    ).join('\n');

    return (
      `✂️ <b>Обновление сделки${sourceBadge}</b>\n\n` +
      `<b>${trade.asset}</b> ${sideIcon} ${trade.side}\n` +
      `📍 Вход: ${trade.entry} · 🛑 Стоп: ${trade.stop}\n\n` +
      (history ? `📋 <b>История:</b>\n${history}\n\n` : '') +
      `📊 Закрыто: <b>${fmt(closedPct, 0)}%</b> · Остаток: <b>${fmt(remPct, 0)}%</b>\n` +
      `💰 P&amp;L: <b>${realizedPnl >= 0 ? '+' : ''}$${fmt(realizedPnl)}</b>\n` +
      `📊 Факт. RR: <b>${actualRR > 0 ? '1:' + fmt(actualRR, 2) : '—'}</b>\n\n` +
      `🔗 <a href="https://t.me/ILTradesbot">Смотреть в журнале</a>`
    );
  }

  // action === 'close'
  const result   = trade.result || 'unknown';
  const rIcon    = result === 'win' ? '✅' : result === 'loss' ? '❌' : '➖';
  const finalPnl = trade.pnl || 0;
  const actualRR = Math.abs(finalPnl) > 0 && Math.abs(stopPnlLoss) > 0
    ? Math.abs(finalPnl) / Math.abs(stopPnlLoss) : 0;
  const history  = closeActions.map((a, i) =>
    `${i + 1}. ${a.label} → ${(a.pnl || 0) >= 0 ? '+' : ''}$${fmt(a.pnl || 0)}`
  ).join('\n');

  return (
    `🏁 <b>Сделка закрыта${sourceBadge}</b> ${rIcon}\n\n` +
    `<b>${trade.asset}</b> ${sideIcon} ${trade.side}\n` +
    `📅 Открыта: ${(trade.date || '').split('-').reverse().join('.')} ${trade.time || ''}\n` +
    `📅 Закрыта: ${(trade.closeDate || trade.date || '').split('-').reverse().join('.')} ${trade.closeTime || trade.time || ''}\n` +
    `📍 Вход: ${trade.entry}\n\n` +
    (history ? `📋 <b>История:</b>\n${history}\n\n` : '') +
    `💰 Итоговый P&amp;L: <b>${finalPnl >= 0 ? '+' : ''}$${fmt(finalPnl)}</b>\n` +
    `📊 Плановый RR: <b>${plannedRR > 0 ? '1:' + fmt(plannedRR, 2) : '—'}</b>\n` +
    `📊 Фактический RR: <b>${actualRR > 0 ? '1:' + fmt(actualRR, 2) : '—'}</b>\n` +
    (trade.strategy ? `📐 Стратегия: ${trade.strategy}\n` : '') +
    `\n🔗 <a href="https://t.me/ILTradesbot">Смотреть в журнале</a>`
  );
}

// ── Launch + Graceful Shutdown ──────────────────────────────────
async function main() {
  try {
    initFirebase();

    if (db) {
      mexcService.init(db, bot);
      console.log('[Bot] MexcService started');
    } else {
      console.warn('[Bot] Firebase not initialized — MexcService disabled');
    }

    app.listen(PORT, () => {
      console.log(`[Bot] HTTP server listening on port ${PORT}`);
    });

    await bot.launch();
    console.log('[Bot] ✅ IL-Trading Journal bot started');
    console.log(`[Bot] Mini App URL: ${MINI_APP_URL}`);
  } catch (e) {
    console.error('[Bot] Failed to start:', e.message);
    process.exit(1);
  }
}

function shutdown(signal) {
  console.log(`[Bot] ${signal} received — shutting down gracefully...`);
  bot.stop(signal);
  process.exit(0);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('[Bot] Unhandled rejection:', reason);
});

main();
