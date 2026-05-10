// src/services/calculator.js
// Чистые функции расчётов.
// МАТЕМАТИКУ ТРОГАТЬ ЗАПРЕЩЕНО — кроме исправленного расчёта RR:
//   Плановый RR  = (pnl1 + pnl2) / Math.abs(pnlStop)
//   Фактический RR = factualPnl / Math.abs(pnlStop)

export const fmt    = (v, d = 2) => (isNaN(v) ? 0 : +v).toFixed(d);
export const nowStr = () =>
  new Date().toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });

// ── Основной расчёт сделки (для сохранения) ─────────────────────────
export function calcTrade(t) {
  const leverage  = t.leverage || 1;
  const riskUSD   = t.deposit * (t.riskPercent / 100);

  const posBase   = riskUSD;
  const posFull   = riskUSD * leverage;

  const diffStop  = Math.abs(t.entry - t.stop);
  const stopPct   = t.entry ? diffStop / t.entry : 0;
  const pnlStop   = -(riskUSD * leverage * stopPct);

  const coinsLev  = posFull / t.entry;

  const tp1Fix    = t.tp1_percent || 50;
  const tp1Coins  = coinsLev * (tp1Fix / 100);
  let   pnl1 = 0;
  if (t.tp1_price && tp1Fix) {
    pnl1 = t.side === 'LONG'
      ? (t.tp1_price - t.entry) * tp1Coins
      : (t.entry - t.tp1_price) * tp1Coins;
  }

  const remainCoins = coinsLev - tp1Coins;
  let   pnl2 = 0;
  if (t.tp2_price && remainCoins > 0) {
    pnl2 = t.side === 'LONG'
      ? (t.tp2_price - t.entry) * remainCoins
      : (t.entry - t.tp2_price) * remainCoins;
  }

  const pnl = pnl1 + pnl2;

  const pctToTp1 = t.tp1_price ? Math.abs(t.tp1_price - t.entry) / t.entry * 100 : 0;
  const pctStop  = stopPct * 100;

  // ── ИСПРАВЛЕНО: Плановый RR = (pnl1+pnl2) / |pnlStop| ──
  const rr = pnlStop < 0 && pnl !== 0 ? Math.abs(pnl) / Math.abs(pnlStop) : 0;

  const tp1ProfitPct   = t.tp1_price ? Math.abs(t.tp1_price - t.entry) / t.entry * 100 : 0;
  const tp2ProfitPct   = t.tp2_price ? Math.abs(t.tp2_price - t.entry) / t.entry * 100 : 0;
  const totalProfitPct = tp1ProfitPct + (tp2ProfitPct > 0 ? tp2ProfitPct : 0);

  return {
    ...t,
    positionBase: posBase,
    positionFull: posFull,
    riskUSD,
    stopPct: stopPct * 100,
    pnlStop,
    pnl1, pnl2, pnl,
    rr,
    plannedRR: rr,
    tp1ProfitPct,
    tp2ProfitPct,
    totalProfitPct
  };
}

// ── Живой калькулятор (для формы) ──────────────────────────────────
export function liveCalcValues({ deposit, leverage, riskPercent, entry, stop, tp1Price, tp1FixPct, tp2Price, side }) {
  if (!deposit || !entry || !stop || !riskPercent) return null;

  const riskUSD  = deposit * (riskPercent / 100);
  const posBase  = riskUSD;
  const posFull  = riskUSD * leverage;
  const diffStop = Math.abs(entry - stop);
  const stopPct  = diffStop / entry;
  const pnlStop  = -(riskUSD * leverage * stopPct);

  const coinsLev = posFull / entry;

  let pnl1 = 0, tp1Coins = 0, volTp1 = 0;
  if (tp1Price && tp1FixPct > 0) {
    tp1Coins = coinsLev * (tp1FixPct / 100);
    volTp1   = tp1Coins * entry;
    pnl1     = side === 'LONG'
      ? (tp1Price - entry) * tp1Coins
      : (entry - tp1Price) * tp1Coins;
  }

  let pnl2 = 0, remainCoins = 0, volTp2 = 0;
  const remainCoinsCalc = coinsLev - tp1Coins;
  if (tp2Price && remainCoinsCalc > 0) {
    remainCoins = remainCoinsCalc;
    volTp2      = remainCoins * entry;
    pnl2        = side === 'LONG'
      ? (tp2Price - entry) * remainCoins
      : (entry - tp2Price) * remainCoins;
  }

  const pnlTotal = pnl1 + pnl2;

  // ── ИСПРАВЛЕНО: Плановый RR = (pnl1+pnl2) / |pnlStop|
  // rr1 здесь — соотношение TP1 к риску (для отображения в колонке TP1)
  const rr1 = pnlStop < 0 && pnl1 !== 0 ? Math.abs(pnl1) / Math.abs(pnlStop) : 0;

  return {
    posBase, posFull, riskUSD, stopPct, pnlStop, coinsLev,
    pnl1, tp1Coins, volTp1,
    pnl2, remainCoins, volTp2, remainCoinsCalc,
    pnlTotal, rr1, leverage
  };
}

// ── Расчёт PnL для частичного закрытия (extra) ──────────────────────
export function calcEarlyClose(trade, price, coinsLev, remPct) {
  const remCoins = coinsLev * (remPct / 100);
  const pnl      = trade.side === 'LONG'
    ? (price - trade.entry) * remCoins
    : (trade.entry - price) * remCoins;
  const pct      = ((price - trade.entry) / trade.entry * 100 * (trade.side === 'LONG' ? 1 : -1));
  return { pnl, pct, remPct };
}

export function calcPartialClose(trade, price, closePct, coinsLev, remPct) {
  const actualPct  = Math.min(closePct, remPct);
  const partCoins  = coinsLev * (actualPct / 100);
  const pnl        = trade.side === 'LONG'
    ? (price - trade.entry) * partCoins
    : (trade.entry - price) * partCoins;
  const pricePct   = ((price - trade.entry) / trade.entry * 100 * (trade.side === 'LONG' ? 1 : -1));
  return { pnl, pricePct, actualPct, remaining: remPct - actualPct };
}

// ── Монеты от плеча ────────────────────────────────────────────────
export function tradeCoinsLev(trade) {
  const lev     = trade.leverage || 1;
  const riskUSD = trade.deposit * (trade.riskPercent / 100);
  const posFull = riskUSD * lev;
  return posFull / trade.entry;
}

// ── Статистика по массиву сделок ───────────────────────────────────
export function computeStats(tradesArr) {
  const closed  = tradesArr.filter(t => t.status === 'closed');
  if (!closed.length) return null;

  const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0);
  const deposit  = closed[closed.length - 1]?.deposit || 0;
  const balance  = deposit + totalPnl;

  const wl      = closed.filter(t => t.result === 'win' || t.result === 'loss');
  const wins    = wl.filter(t => t.result === 'win').length;
  const winrate = wl.length ? wins / wl.length * 100 : 0;

  const validRR = closed.filter(t => t.rr > 0);
  const avgRR   = validRR.length
    ? validRR.reduce((s, t) => s + t.rr, 0) / validRR.length : 0;

  return { totalPnl, balance, winrate, avgRR, count: closed.length };
}

// ── RR расчёты для отображения ──────────────────────────────────────

/**
 * Плановый RR = (общий планируемый PnL с обоих тейков) / |pnlStop|
 */
export function calcPlannedRR(pnl1, pnl2, pnlStop) {
  const totalPlanned = (pnl1 || 0) + (pnl2 || 0);
  if (totalPlanned === 0 || pnlStop === 0) return 0;
  return Math.abs(totalPlanned) / Math.abs(pnlStop);
}

/**
 * Фактический RR = фактический PnL (из closeActions) / |pnlStop|
 */
export function calcActualRR(factualPnl, pnlStop) {
  if (factualPnl === 0 || pnlStop === 0) return 0;
  return Math.abs(factualPnl) / Math.abs(pnlStop);
}

/**
 * Вспомогательная: посчитать pnlStop для трейда
 */
export function tradePnlStop(trade) {
  const lev     = trade.leverage || 1;
  const riskUSD = trade.riskUSD || (trade.deposit * (trade.riskPercent / 100));
  const stopDist = trade.entry && trade.stop ? Math.abs(trade.entry - trade.stop) / trade.entry : 0;
  return -(riskUSD * lev * stopDist);
}

// ── Экспорт CSV/XLS ────────────────────────────────────────────────
export function buildExportData(tradesObj, from, to) {
  let arr = Object.values(tradesObj).filter(t => t.status === 'closed');
  if (from) arr = arr.filter(t => t.date >= from);
  if (to)   arr = arr.filter(t => t.date <= to);
  arr.sort((a, b) => a.date.localeCompare(b.date));

  const headers = [
    'Дата','Время','Актив','Сторона','Депозит','Плечо','Риск%',
    'Вход','Стоп','TP1','TP2','PnL','RR','Результат','Комментарий'
  ];

  const rows = arr.map(t => [
    t.date, t.time, t.asset, t.side,
    t.deposit, t.leverage || 1, t.riskPercent,
    t.entry, t.stop, t.tp1_price || '', t.tp2_price || '',
    fmt(t.pnl || 0), fmt(t.rr || 0, 2), t.result || '',
    (t.note || '').replace(/,/g, '；')
  ]);

  return { headers, rows, count: arr.length };
}
