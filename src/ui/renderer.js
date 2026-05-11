// src/ui/renderer.js
// Функции обновления DOM, отрисовка таблиц, списков и превью

import { fmt, nowStr, calcPlannedRR, calcActualRR, tradePnlStop } from '../services/calculator.js';

// ── Утилита установки текста/цвета ────────────────────────────────
export function S(id, txt, color) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = txt;
  if (color) el.style.color = color;
}

// ── Live Calc DOM update ──────────────────────────────────────────
export function renderLiveCalc(result) {
  const allIds = [
    'lc-pos-base','lc-pos','lc-risk','lc-stop-pct','lc-lev',
    'lc-pnl-stop','lc-pnl1','lc-vol-tp1','lc-rr1',
    'lc-pnl2','lc-vol-tp2','lc-pnl-total'
  ];

  if (!result) {
    allIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = '—'; el.style.color = 'var(--blue)'; }
    });
    const rp = document.getElementById('lc-risk-pct');
    const nb = document.getElementById('lc-pos-base-note');
    if (rp) rp.textContent = '';
    if (nb) nb.textContent = '';
    return;
  }

  const {
    posBase, posFull, riskUSD, stopPct, pnlStop, leverage,
    pnl1, volTp1, rr1,
    pnl2, volTp2, remainCoinsCalc,
    pnlTotal, riskPercent
  } = result;

  S('lc-pos-base',  '$' + fmt(posBase, 2),    'var(--blue)');
  S('lc-pos',       '$' + fmt(posFull, 2),    'var(--blue)');
  S('lc-lev',       'x' + leverage,            'var(--blue)');
  S('lc-stop-pct',  fmt(stopPct * 100, 2) + '%', 'var(--blue)');
  S('lc-pnl-stop',  fmt(pnlStop, 2) + '$',    'var(--red)');

  const riskEl = document.getElementById('lc-risk');
  if (riskEl) {
    riskEl.textContent = '$' + fmt(riskUSD, 2);
    riskEl.style.color = (riskPercent || 0) > 3 ? 'var(--red)' : 'var(--blue)';
  }

  S('lc-risk-pct', (riskPercent || '') + '% от депозита');

  const nb = document.getElementById('lc-pos-base-note');
  if (nb) nb.textContent = '×' + leverage + ' = $' + fmt(posFull, 2);

  if (result.tp1Price && result.tp1FixPct > 0) {
    const c1 = pnl1 >= 0 ? 'var(--green)' : 'var(--red)';
    S('lc-pnl1',    (pnl1 >= 0 ? '+' : '') + '$' + fmt(pnl1, 2), c1);
    S('lc-vol-tp1', '$' + fmt(volTp1, 2),                         'var(--t2)');
    S('lc-rr1',     rr1 ? '1:' + fmt(rr1, 2) : '—',              'var(--blue)');
  } else {
    ['lc-pnl1','lc-vol-tp1','lc-rr1'].forEach(id => S(id, '—', 'var(--blue)'));
  }

  if (result.tp2Price && remainCoinsCalc > 0) {
    const c2 = pnl2 >= 0 ? 'var(--green)' : 'var(--red)';
    const ct = pnlTotal >= 0 ? 'var(--green)' : 'var(--red)';
    S('lc-pnl2',      (pnl2 >= 0 ? '+' : '') + '$' + fmt(pnl2, 2),       c2);
    S('lc-vol-tp2',   '$' + fmt(volTp2, 2),                               'var(--t2)');
    S('lc-pnl-total', (pnlTotal >= 0 ? '+' : '') + '$' + fmt(pnlTotal, 2), ct);
  } else {
    ['lc-pnl2','lc-vol-tp2','lc-pnl-total'].forEach(id => S(id, '—', 'var(--blue)'));
  }
}

// ── Stats bar ────────────────────────────────────────────────────
export function renderStats(tradesObj) {
  const arr = Object.values(tradesObj).filter(t => t.status === 'closed');
  if (!arr.length) return;

  const totalPnl = arr.reduce((s, t) => s + (t.pnl || 0), 0);
  const deposit  = arr[arr.length - 1]?.deposit || 0;
  const balance  = deposit + totalPnl;

  const closed  = arr.filter(t => t.result === 'win' || t.result === 'loss');
  const wins    = closed.filter(t => t.result === 'win').length;
  const winrate = closed.length ? wins / closed.length * 100 : 0;

  const validRR = arr.filter(t => t.rr > 0);
  const avgRR   = validRR.length
    ? validRR.reduce((s, t) => s + t.rr, 0) / validRR.length : 0;

  const pnlEl = document.getElementById('stat-pnl');
  if (pnlEl) {
    pnlEl.textContent = (totalPnl >= 0 ? '+' : '') + '$' + fmt(totalPnl);
    pnlEl.style.color = totalPnl >= 0 ? 'var(--green)' : 'var(--red)';
  }

  S('stat-balance', '$' + fmt(balance));
  S('stat-wr',      fmt(winrate, 1) + '%');
  S('stat-rr',      '1:' + fmt(avgRR, 2));
}

// ── Journal list ─────────────────────────────────────────────────
export function renderJournal(tradesObj) {
  const list = document.getElementById('list');
  if (!list) return;

  const arr = Object.values(tradesObj)
    .filter(t => t.status === 'closed')
    .sort((a, b) => b.id - a.id);

  if (!arr.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--t3);font-size:14px;margin-top:20px;">Закрытых сделок нет</p>';
    return;
  }

  const rBadge = {
    win:   '<span class="badge badge-win">WIN</span>',
    loss:  '<span class="badge badge-loss">LOSS</span>',
    be:    '<span class="badge badge-be">BE</span>',
    tp1be: '<span class="badge" style="background:#1a2a3a;color:var(--blue);">TP1+BE</span>',
  };

  list.innerHTML = arr.map(t => {
    const lev      = t.leverage || 1;
    const riskUSD  = t.riskUSD || 0;
    const posFull  = riskUSD * lev;
    const acts     = Array.isArray(t.closeActions) ? t.closeActions : [];

    const stopPct  = t.entry && t.stop ? Math.abs(t.entry - t.stop) / t.entry * 100 : 0;
    const pnlStop  = -(riskUSD * lev * (stopPct / 100));

    const tp1Pnl   = t.pnl1 || 0;
    const tp2Pnl   = t.pnl2 || 0;
    const pnlTotal = tp1Pnl + tp2Pnl;

    const totalActPnl = acts.reduce((s, a) => s + (a.pnl || 0), 0);

    // ── ИСПРАВЛЕНО RR ──
    const plannedRR       = calcPlannedRR(tp1Pnl, tp2Pnl, pnlStop);
    const actualRR        = calcActualRR(totalActPnl, pnlStop);
    const plannedRRDisplay = plannedRR > 0 ? '1:' + fmt(plannedRR, 2) : '—';
    const actualRRDisplay  = actualRR  > 0 ? '1:' + fmt(actualRR,  2) : '—';

    const closeHistory = acts.length
      ? acts.map(a =>
          `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;">
            <span style="color:var(--t2);">${a.dt || ''} ${a.tm || ''} · ${a.label}</span>
            <span style="color:${(a.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:bold;">
              ${(a.pnl || 0) >= 0 ? '+' : ''}${fmt(a.pnl || 0)}$
            </span>
          </div>`).join('')
      : `<span style="color:var(--t3);font-size:12px;">${t.closeDate || ''} ${t.closeTime || ''}</span>`;

    const tp1ProfitPct = t.tp1_price && t.entry ? Math.abs(t.tp1_price - t.entry) / t.entry * 100 : 0;
    const tp2ProfitPct = t.tp2_price && t.entry ? Math.abs(t.tp2_price - t.entry) / t.entry * 100 : 0;
    const tp1PnlStr    = tp1Pnl >= 0 ? `+${fmt(Math.abs(tp1Pnl))}` : `-${fmt(Math.abs(tp1Pnl))}`;
    const tp2PnlStr    = tp2Pnl >= 0 ? `+${fmt(Math.abs(tp2Pnl))}` : `-${fmt(Math.abs(tp2Pnl))}`;

    return `
    <div class="trade-card">
      <div class="trade-header">
        <b>${t.date} / ${t.time}</b>
        ${rBadge[t.result] || ''}
      </div>
      <b style="font-size:15px;">${t.side} ${t.asset}/USDT.P</b><br>
      Объём: <b>${fmt(t.riskPercent || 0, 1)}%</b> от депозита
        (${fmt(riskUSD, 2)}$) <span style="color:var(--blue);">(х${lev})</span> <span style="color:var(--blue);">${fmt(posFull, 2)}$</span><br>
      Риск (стоп PnL): <span style="color:var(--red);font-weight:bold;">${fmt(pnlStop, 2)}$</span><br>
      Вход: ${t.entry} · Стоп: ${t.stop} <span style="color:var(--red);">(${fmt(stopPct, 2)}%)</span><br>
      ${t.tp1_price ? `
        <div style="display:flex;gap:8px;margin-top:4px;">
          <div>
            <span style="color:var(--amber);">TP1: ${t.tp1_price}</span>
            <span style="color:#888;">(+${fmt(tp1ProfitPct, 2)}%)</span>
          </div>
          <div style="color:var(--green);font-weight:bold;">${tp1PnlStr}$</div>
        </div>` : ''}
      ${t.tp2_price ? `
        <div style="display:flex;gap:8px;margin-top:2px;">
          <div>
            <span style="color:var(--amber);">TP2: ${t.tp2_price}</span>
            <span style="color:#888;">(+${fmt(tp2ProfitPct, 2)}%)</span>
          </div>
          <div style="color:var(--green);font-weight:bold;">${tp2PnlStr}$</div>
        </div>` : ''}
      ${t.tp2_price ? `<span style="color:var(--blue);font-size:12px;">План. RR: <b>${plannedRRDisplay}</b></span><br>` : ''}
      ${pnlTotal > 0 ? `<span style="color:var(--green);font-weight:bold;">Σ Прибыль: +${fmt(pnlTotal, 2)}$</span>` : ''}<br>
      <hr style="border:none;border-top:0.5px solid var(--sep);margin:6px 0;">
      <div style="font-size:11px;color:var(--t2);margin-bottom:4px;">📋 История закрытия:</div>
      ${closeHistory}
      ${acts.length > 0 ? `
      <div style="font-size:12px;margin-top:4px;">
        <span style="color:var(--amber);">Факт. RR: <b>${actualRRDisplay}</b></span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;
                  margin-top:6px;padding-top:6px;border-top:0.5px solid var(--sep);">
        <span style="font-size:13px;color:var(--t2);">Итог:</span>
        <span style="font-size:16px;font-weight:bold;color:${(t.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)'};">
          ${(t.pnl || 0) >= 0 ? '+' : ''}${fmt(t.pnl || 0)}$ · RR ${actualRRDisplay}
        </span>
      </div>
      ${t.strategy ? `<div style="font-size:11px;color:#888;margin-top:4px;">📐 ${t.strategy}</div>` : ''}
      ${t.note ? `<i style="color:var(--t2);font-size:12px;">${t.note}</i><br>` : ''}
      ${t.images && t.images.length
        ? `<div class="trade-imgs">${t.images.map(src =>
            `<img class="trade-img-thumb" src="${src}" data-lightbox="${src.replace(/'/g, "\\'")}">`
          ).join('')}</div>`
        : ''}
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button class="btn-small btn-edit" style="flex:1;" data-edit-trade="${t.id}">✏️ Изменить</button>
        <button class="btn-small btn-gray" style="flex:1;" data-share-trade="${t.id}">📤 Поделиться</button>
        <button class="btn-small btn-danger" style="flex:1;" data-delete-trade="${t.id}">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// ── Open trades list ─────────────────────────────────────────────
export function renderOpenTrades(tradesObj, mexcWs) {
  const list = document.getElementById('open-list');
  if (!list) return;

  const arr = Object.values(tradesObj)
    .filter(t => !t.status || t.status === 'open')
    .sort((a, b) => b.id - a.id);

  const tabBtn = document.getElementById('open-tab-btn');
  if (tabBtn) {
    const label = tabBtn.querySelector('.tab-label');
    if (label) label.textContent = arr.length > 0 ? `Открытые (${arr.length})` : 'Открытые';
  }

  if (!arr.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--t3);font-size:14px;padding:30px 0;">Нет открытых сделок</p>';
    return;
  }

  list.innerHTML = arr.map(t => {
    const lev      = t.leverage || 1;
    const riskUSD  = t.riskUSD || (t.deposit * (t.riskPercent || 0) / 100);
    const posFull  = riskUSD * lev;
    const coinsLev = posFull / t.entry;

    const tp1Pct   = t.tp1_percent || 50;
    const tp1Coins = coinsLev * (tp1Pct / 100);
    const pnlTp1   = t.tp1_price
      ? (t.side === 'LONG' ? (t.tp1_price - t.entry) * tp1Coins : (t.entry - t.tp1_price) * tp1Coins)
      : null;

    const remCoins = coinsLev - tp1Coins;
    const pnlTp2   = t.tp2_price && remCoins > 0
      ? (t.side === 'LONG' ? (t.tp2_price - t.entry) * remCoins : (t.entry - t.tp2_price) * remCoins)
      : null;

    const stopPct  = t.entry && t.stop ? Math.abs(t.entry - t.stop) / t.entry * 100 : 0;
    const pnlStop  = -(riskUSD * lev * (stopPct / 100));
    const pnlTotal = (pnlTp1 || 0) + (pnlTp2 || 0);

    const acts     = Array.isArray(t.closeActions) ? t.closeActions : [];
    const usedPct  = acts.reduce((s, a) => s + (a.pct || 0), 0);
    const partPnl  = acts.reduce((s, a) => s + (a.pnl || 0), 0);
    const remPct   = 100 - usedPct;

    const tp1ProfitPct = t.tp1_price && t.entry ? Math.abs(t.tp1_price - t.entry) / t.entry * 100 : 0;
    const tp2ProfitPct = t.tp2_price && t.entry ? Math.abs(t.tp2_price - t.entry) / t.entry * 100 : 0;
    const tp1PnlStr    = pnlTp1 !== null ? `${pnlTp1 >= 0 ? '+' : ''}${fmt(Math.abs(pnlTp1))}` : '—';
    const tp2PnlStr    = pnlTp2 !== null && pnlTp2 >= 0 ? `+${fmt(Math.abs(pnlTp2))}` : '—';

    const actHistory = acts.length ? `
      <hr style="border:none;border-top:0.5px solid var(--sep);margin:8px 0;">
      <div style="font-size:11px;color:var(--t2);margin-bottom:6px;">📊 Частичные закрытия:</div>
      <div class="action-progress">
        <div class="action-progress-fill" style="width:${Math.min(usedPct, 100).toFixed(0)}%;"></div>
      </div>
      ${acts.map(a => {
        const priceMovePct = t.entry && a.price ? Math.abs(a.price - t.entry) / t.entry * 100 : 0;
        const moveDir = t.side === 'LONG' ? (a.price > t.entry ? '↑' : '↓') : (a.price > t.entry ? '↓' : '↑');
        return `
        <div class="action-history-item">
          <span style="color:var(--t2);">${a.label}</span>
          <span style="color:#888;font-size:10px;">${a.pct}% @ ${a.price} (${moveDir}${fmt(priceMovePct, 1)}%)</span>
          <span style="color:${(a.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:bold;">
            ${(a.pnl || 0) >= 0 ? '+' : ''}${fmt(a.pnl || 0)}
          </span>
        </div>`;
      }).join('')}
      <div class="action-history-summary">
        <span style="color:var(--t2);">Закрыто <b style="color:var(--t1);">${usedPct.toFixed(0)}%</b> · Остаток <b style="color:var(--blue);">${remPct.toFixed(0)}%</b></span>
        <span style="color:${partPnl >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:bold;">${partPnl >= 0 ? '+' : ''}${fmt(partPnl)}</span>
      </div>` : '';

    const maxProfitPct = pnlTotal > 0 ? (pnlTotal / (t.deposit || 1) * 100) : 0;

    const liveData       = mexcWs ? mexcWs.calculateLivePnl(t) : null;
    const currentPrice   = liveData?.currentPrice || null;
    const livePnl        = liveData?.totalPnl || null;
    const liveChangePct  = liveData?.changePct || null;

    let livePriceHtml = '';
    if (currentPrice) {
      const priceColor = liveChangePct > 0 ? 'var(--green)' : liveChangePct < 0 ? 'var(--red)' : 'var(--t1)';
      const priceSign  = liveChangePct > 0 ? '+' : '';
      livePriceHtml = `
        <div class="live-price-badge">
          <span class="live-price-label">📍 Сейчас:</span>
          <span class="live-price-value" style="color:${priceColor};">${currentPrice.toLocaleString()}</span>
          <span class="live-price-change" style="color:${priceColor};">${priceSign}${liveChangePct.toFixed(2)}%</span>
        </div>
        <div class="live-pnl-badge">
          <span class="live-pnl-label">💰 Live P&L:</span>
          <span class="live-pnl-value" style="color:${livePnl >= 0 ? 'var(--green)' : 'var(--red)'};">
            ${livePnl >= 0 ? '+' : ''}${fmt(livePnl)}
            <span style="font-size:10px;opacity:0.8;">(${priceSign}${liveChangePct.toFixed(2)}%)</span>
          </span>
        </div>`;
    } else {
      livePriceHtml = `
        <div class="live-price-badge live-price-loading">
          <span class="live-price-label">📍 Сейчас:</span>
          <span class="live-price-value loading-dots">Загрузка...</span>
        </div>`;
    }

    return `
    <div class="trade-card">
      <div class="trade-header">
        <b>${t.date} / ${t.time}</b>
        <span class="open-badge">🟢 Открыта</span>
      </div>
      <div class="live-trade-info">
        <b style="font-size:15px;">${t.side} ${t.asset}/USDT.P</b>
        ${livePriceHtml}
      </div><br>
      Объём: <b>${fmt(t.riskPercent || 0, 1)}%</b> от депозита (${fmt(riskUSD, 2)}$) <span style="color:var(--blue);">(х${lev})</span> <span style="color:var(--blue);">${fmt(posFull, 2)}$</span><br>
      Вход: ${t.entry} · Стоп: ${t.stop}<br>
      Риск: <span style="color:var(--red);font-weight:bold;">${fmt(riskUSD, 2)}$</span>
        &nbsp;·&nbsp; Стоп PnL: <span style="color:var(--red);">(${fmt(stopPct, 2)}%)</span>
        <span style="color:var(--red);font-weight:bold;">${fmt(pnlStop, 2)}$</span><br>
      ${t.tp1_price ? `
        <div style="display:flex;gap:8px;margin-top:4px;">
          <div>
            <span style="color:var(--amber);">TP1: ${t.tp1_price}</span>
            <span style="color:#888;">(+${fmt(tp1ProfitPct, 2)}%)</span>
          </div>
          <div style="color:var(--green);font-weight:bold;">${tp1PnlStr}$ | PnL</div>
        </div>` : ''}
      ${t.tp2_price ? `
        <div style="display:flex;gap:8px;margin-top:2px;">
          <div>
            <span style="color:var(--amber);">TP2: ${t.tp2_price}</span>
            <span style="color:#888;">(+${fmt(tp2ProfitPct, 2)}%)</span>
          </div>
          <div style="color:var(--green);font-weight:bold;">${tp2PnlStr}$ | PnL</div>
        </div>` : ''}
      ${pnlTotal > 0 ? `<span style="color:var(--amber);font-weight:bold;">Σ Макс. прибыль: (+${fmt(maxProfitPct, 2)}%) +$${fmt(pnlTotal)}</span>` : ''}<br>
      <div style="margin-top:6px;padding:6px 0;border-top:0.5px solid var(--sep);">
        <span style="color:var(--green);font-weight:bold;">Макс. прибыль: +$${fmt(pnlTotal)}</span>
        &nbsp;&nbsp;
        <span style="color:var(--red);font-weight:bold;">Макс. убыток: $${fmt(pnlStop, 2)}</span>
      </div>
      ${actHistory}
      ${t.strategy ? `<div style="font-size:11px;color:#888;margin-top:4px;">📐 ${t.strategy}</div>` : ''}
      ${t.note ? `<i style="color:var(--t2);font-size:12px;">${t.note}</i><br>` : ''}
      ${t.images && t.images.length
        ? `<div class="trade-imgs">${t.images.map(src => `<img class="trade-img-thumb" src="${src}" data-lightbox="${src.replace(/'/g, "\\'")}">`).join('')}</div>`
        : ''}
      <div style="display:flex;gap:6px;margin-top:8px;">
        <button data-open-close-modal="${t.id}">
          🔒 Управление закрытием
        </button>
        <button class="btn-small btn-gray" data-share-trade="open-${t.id}">📤</button>
      </div>
    </div>`;
  }).join('');
}

// ── Summary (Итоги) ──────────────────────────────────────────────
export function renderSummary(tradesObj, from) {
  const arr = Object.values(tradesObj).filter(t => t.date >= from && !t.archived && t.status === 'closed');

  if (!arr.length) {
    S('sp-pnl', '$0', 'var(--t2)');
    S('sp-sub', '0 сделок');
    S('sp-wr', '0%');
    S('sp-wr-sub', 'W 0 / L 0');
    S('sp-rr', '—');
    S('sp-best', '—');
    S('sp-best-sub', '');
    const de = document.getElementById('sp-days');
    if (de) de.innerHTML = '<span style="color:var(--t3);font-size:13px;">Нет сделок за период</span>';
    return;
  }

  const totalPnl = arr.reduce((s, t) => s + (t.pnl || 0), 0);
  const closed   = arr.filter(t => t.result === 'win' || t.result === 'loss');
  const wins     = closed.filter(t => t.result === 'win').length;
  const losses   = closed.filter(t => t.result === 'loss').length;
  const wr       = closed.length ? wins / closed.length * 100 : 0;
  const vRR      = arr.filter(t => t.rr > 0);
  const avgRR    = vRR.length ? vRR.reduce((s, t) => s + t.rr, 0) / vRR.length : 0;
  const best     = arr.reduce((a, b) => (b.pnl || 0) > (a.pnl || 0) ? b : a, arr[0]);

  S('sp-pnl',     (totalPnl >= 0 ? '+' : '') + '$' + fmt(totalPnl), totalPnl >= 0 ? 'var(--green)' : 'var(--red)');
  S('sp-sub',     arr.length + ' сделок');
  S('sp-wr',      fmt(wr, 1) + '%');
  S('sp-wr-sub',  `W ${wins} / L ${losses}`);
  S('sp-rr',      avgRR ? '1:' + fmt(avgRR, 2) : '—');
  S('sp-best',    best ? (best.pnl >= 0 ? '+' : '') + '$' + fmt(best.pnl) : '—', best && best.pnl >= 0 ? 'var(--green)' : 'var(--red)');
  S('sp-best-sub', best ? best.asset + ' ' + best.side : '');

  const byDay = {};
  arr.forEach(t => {
    if (!byDay[t.date]) byDay[t.date] = { pnl: 0, cnt: 0 };
    byDay[t.date].pnl += t.pnl || 0;
    byDay[t.date].cnt++;
  });

  const days = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
  const de   = document.getElementById('sp-days');
  if (de) de.innerHTML = days.map(([date, d]) => `
    <div class="day-col">
      <span class="day-date">${date.slice(5)}</span>
      <span class="day-pnl" style="color:${d.pnl >= 0 ? 'var(--green)' : 'var(--red)'};">${d.pnl >= 0 ? '+' : ''}${fmt(d.pnl)}$</span>
      <span class="day-cnt">${d.cnt} сд.</span>
    </div>`).join('') || '<span style="color:var(--t3);font-size:13px;">Нет данных</span>';
}

// ── Day history ──────────────────────────────────────────────────
export function renderDayHistory(tradesObj, from) {
  const container = document.getElementById('day-history');
  if (!container) return;

  const arr = Object.values(tradesObj).filter(t => t.date >= from && !t.archived && t.status === 'closed');
  if (!arr.length) {
    container.innerHTML = '<p style="text-align:center;color:var(--t3);font-size:13px;padding:16px 0;">Нет сделок за период</p>';
    return;
  }

  const byDay = {};
  arr.forEach(t => {
    if (!byDay[t.date]) byDay[t.date] = [];
    byDay[t.date].push(t);
  });

  const sortedDates = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

  container.innerHTML = sortedDates.map(date => {
    const dayTrades = byDay[date].sort((a, b) => a.time.localeCompare(b.time));
    const dayPnl    = dayTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const wins      = dayTrades.filter(t => t.result === 'win').length;
    const losses    = dayTrades.filter(t => t.result === 'loss').length;
    const total     = dayTrades.length;

    const deposit0  = dayTrades[0]?.deposit || 0;
    const prevPnl   = Object.values(tradesObj)
      .filter(t => t.date < date && !t.archived)
      .reduce((s, t) => s + (t.pnl || 0), 0);
    const startBal  = deposit0 + prevPnl;
    const endBal    = startBal + dayPnl;

    const rBadge = {
      win:  '<span class="badge badge-win">WIN</span>',
      loss: '<span class="badge badge-loss">LOSS</span>',
      be:   '<span class="badge badge-be">BE</span>'
    };

    const tradeCards = dayTrades.map(t => {
      const lev       = t.leverage || 1;
      const riskUSD   = t.riskUSD || 0;
      const acts      = Array.isArray(t.closeActions) ? t.closeActions : [];

      const closeHistory = acts.length
        ? acts.map(a => `
          <div style="display:flex;justify-content:space-between;font-size:11px;padding:1px 0;color:var(--t2);">
            <span>${a.label}</span>
            <span style="color:${(a.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:bold;">${(a.pnl || 0) >= 0 ? '+' : ''}${fmt(a.pnl || 0)}</span>
          </div>`).join('')
        : '';

      const stopDistPct = t.entry && t.stop ? Math.abs(t.entry - t.stop) / t.entry : 0;
      const pnlStop     = -(riskUSD * lev * stopDistPct);

      const tp1PnlVal   = t.pnl1 || 0;
      const tp2PnlVal   = t.pnl2 || 0;

      // ── ИСПРАВЛЕНО RR ──
      const plannedRR       = calcPlannedRR(tp1PnlVal, tp2PnlVal, pnlStop);
      const totalActPnl     = acts.reduce((s, a) => s + (a.pnl || 0), 0);
      const actualRR        = calcActualRR(totalActPnl, pnlStop);
      const plannedRRDisplay = plannedRR > 0 ? '1:' + fmt(plannedRR, 2) : '—';
      const actualRRDisplay  = actualRR  > 0 ? '1:' + fmt(actualRR,  2) : '—';

      const stopPctDisplay  = t.entry && t.stop ? Math.abs(t.entry - t.stop) / t.entry * 100 : 0;
      const tp1ProfitPct    = t.tp1_price && t.entry ? Math.abs(t.tp1_price - t.entry) / t.entry * 100 : 0;
      const tp2ProfitPct    = t.tp2_price && t.entry ? Math.abs(t.tp2_price - t.entry) / t.entry * 100 : 0;

      return `
        <div class="trade-card" style="margin-bottom:6px;">
          <div class="trade-header">
            <b>${t.time} · ${t.side} ${t.asset}/USDT.P</b>
            ${rBadge[t.result] || ''}
          </div>
          Объём: <b>${fmt(t.riskPercent || 0, 1)}%</b> от депозита
            (${fmt(riskUSD, 2)}$) <span style="color:var(--blue);">(х${lev})</span><br>
          Вход: ${t.entry} · Стоп: ${t.stop} (${fmt(stopPctDisplay, 2)}%<span style="color:var(--red);">)</span><br>
          Риск (стоп PnL): <span style="color:var(--red);font-weight:bold;">${fmt(pnlStop, 2)}$</span>
          &nbsp;·&nbsp; <span style="color:var(--blue);">План. RR: <b>${plannedRRDisplay}</b></span>
          ${acts.length > 0 ? `&nbsp;·&nbsp; <span style="color:var(--amber);">Факт. RR: <b>${actualRRDisplay}</b></span>` : ''}<br>
          ${t.tp1_price ? `<div style="display:flex;gap:8px;margin-top:4px;">
            <span style="color:var(--amber);">TP1: ${t.tp1_price}</span>
            <span style="color:#888;">(+${fmt(tp1ProfitPct, 2)}%)</span>
            <span style="color:var(--green);font-weight:bold;">${(tp1PnlVal || 0) >= 0 ? '+' : ''}${fmt(Math.abs(tp1PnlVal || 0))}$</span>
          </div>` : ''}
          ${t.tp2_price ? `<div style="display:flex;gap:8px;margin-top:2px;">
            <span style="color:var(--amber);">TP2: ${t.tp2_price}</span>
            <span style="color:#888;">(+${fmt(tp2ProfitPct, 2)}%)</span>
            <span style="color:var(--green);font-weight:bold;">${(tp2PnlVal || 0) >= 0 ? '+' : ''}${fmt(Math.abs(tp2PnlVal || 0))}$</span>
          </div>` : ''}
          ${closeHistory ? `<div style="margin:4px 0 2px;font-size:10px;">📋 Выход:${closeHistory}</div>` : ''}
          Итог: <span style="color:${(t.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:bold;"><b>${(t.pnl || 0) >= 0 ? '+' : ''}${fmt(Math.abs(t.pnl || 0))}$</b></span><br>
          ${t.strategy ? `<span style="color:var(--t2);font-size:11px;">📐 ${t.strategy}</span><br>` : ''}
          ${t.note ? `<i style="color:var(--t2);font-size:12px;">${t.note}</i><br>` : ''}
          ${t.images && t.images.length ? `<div class="trade-imgs">${t.images.map(src => `<img class="trade-img-thumb" src="${src}" data-lightbox="${src.replace(/'/g, "\\'")}">`).join('')}</div>` : ''}
        </div>`;
    }).join('');

    return `
    <div class="day-row" id="dr-${date}">
      <div class="day-row-head" data-toggle-day="${date}">
        <span class="day-row-date">${date}</span>
        <div class="day-row-stats">
          <div class="day-stat"><span class="day-stat-label">Сделок</span><span class="day-stat-val">${total}</span></div>
          <div class="day-stat">
            <span class="day-stat-label">W/L</span>
            <span class="day-stat-val" style="color:var(--green);">${wins}</span><span style="color:var(--t2);">/</span><span class="day-stat-val" style="color:var(--red);">${losses}</span>
          </div>
          <div class="day-stat"><span class="day-stat-label">Старт</span><span class="day-stat-val">$${fmt(startBal, 0)}</span></div>
          <div class="day-stat"><span class="day-stat-label">Финиш</span><span class="day-stat-val">$${fmt(endBal, 0)}</span></div>
        </div>
        <span class="day-row-pnl" style="color:${dayPnl >= 0 ? 'var(--green)' : 'var(--red)'};">${dayPnl >= 0 ? '+' : ''}${fmt(dayPnl)}$</span>
        <span class="day-arrow">▶</span>
      </div>
      <div class="day-trades">${tradeCards}</div>
    </div>`;
  }).join('');
}

// ── MEXC Summary ─────────────────────────────────────────────────
export function renderMexcSummary(tradesObj) {
  const arr = Object.values(tradesObj).filter(t => t.fromMexc === true);
  if (!arr.length) {
    S('mx-pnl', '$0', 'var(--t2)'); S('mx-sub', '0 MEXC сделок');
    S('mx-wr', '0%'); S('mx-wr-sub', 'W 0 / L 0');
    S('mx-best', '—'); S('mx-best-sub', '');
    S('mx-worst', '—'); S('mx-worst-sub', '');
    return;
  }
  const totalPnl = arr.reduce((s, t) => s + (t.pnl || 0), 0);
  const closed   = arr.filter(t => t.result === 'win' || t.result === 'loss');
  const wins     = closed.filter(t => t.result === 'win').length;
  const losses   = closed.filter(t => t.result === 'loss').length;
  const wr       = closed.length ? wins / closed.length * 100 : 0;
  const best     = arr.reduce((a, b) => (b.pnl || 0) > (a.pnl || 0) ? b : a, arr[0]);
  const worst    = arr.reduce((a, b) => (b.pnl || 0) < (a.pnl || 0) ? b : a, arr[0]);

  S('mx-pnl',     (totalPnl >= 0 ? '+' : '') + '$' + fmt(totalPnl), totalPnl >= 0 ? 'var(--green)' : 'var(--red)');
  S('mx-sub',     arr.length + ' MEXC сделок');
  S('mx-wr',      fmt(wr, 1) + '%');
  S('mx-wr-sub',  `W ${wins} / L ${losses}`);
  S('mx-best',    best ? (best.pnl >= 0 ? '+' : '') + '$' + fmt(best.pnl) : '—', 'var(--green)');
  S('mx-best-sub', best ? best.asset + ' ' + best.side : '');
  S('mx-worst',   worst ? (worst.pnl >= 0 ? '+' : '') + '$' + fmt(worst.pnl) : '—', 'var(--red)');
  S('mx-worst-sub', worst ? worst.asset + ' ' + worst.side : '');
}

// ── Notifications ────────────────────────────────────────────────
export function renderNotifs(notifications) {
  const list    = document.getElementById('notif-list');
  const badge   = document.getElementById('notif-badge');
  const unread  = notifications.filter(n => !n.read).length;
  const sorted  = [...notifications].sort((a, b) => b.id - a.id);

  if (badge) {
    badge.style.display = unread > 0 ? 'flex' : 'none';
    badge.textContent   = unread > 9 ? '9+' : unread;
  }

  if (!list) return;
  if (!sorted.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--t3);font-size:14px;padding:20px 0;">Уведомлений нет</p>';
    return;
  }

  list.innerHTML = sorted.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div class="notif-icon">${n.icon || '🔔'}</div>
      <div class="notif-text">
        <div class="notif-title">${n.title}</div>
        <div class="notif-desc">${n.desc || ''}</div>
        <div class="notif-time">${n.time || ''}</div>
      </div>
    </div>
  `).join('');
}

// ── Channel UI ────────────────────────────────────────────────────
export function renderChannelUI(channelSettings) {
  const dot          = document.getElementById('channel-dot');
  const statusText   = document.getElementById('channel-status-text');
  const connDisp     = document.getElementById('channel-connected-display');
  const connId       = document.getElementById('channel-connected-id');
  const chIdInput    = document.getElementById('channel-id');
  const chNameInput  = document.getElementById('channel-name');

  if (channelSettings.channelId) {
    dot?.classList.add('active');
    if (statusText) statusText.textContent = 'Канал подключен';
    if (connDisp)   connDisp.style.display = 'block';
    if (connId)     connId.textContent = channelSettings.channelId;
    if (chIdInput)  chIdInput.value = channelSettings.channelId;
    if (chNameInput) chNameInput.value = channelSettings.channelName || '';
  } else {
    dot?.classList.remove('active');
    if (statusText) statusText.textContent = 'Канал не подключен';
    if (connDisp)   connDisp.style.display = 'none';
  }

  document.getElementById('auto-post-open')?.classList.toggle('active',    channelSettings.autoPostOpen);
  document.getElementById('auto-post-partial')?.classList.toggle('active', channelSettings.autoPostPartial);
  document.getElementById('auto-post-close')?.classList.toggle('active',   channelSettings.autoPostClose);
}

// ── Close history modal ───────────────────────────────────────────
export function renderCloseHistory(closeActions, closingTrade) {
  const wrap   = document.getElementById('cm-partials-wrap');
  const list   = document.getElementById('cm-partials-list');
  const pctEl  = document.getElementById('cm-closed-pct');
  const pnlEl  = document.getElementById('cm-total-pnl');
  const rrEl   = document.getElementById('cm-actual-rr');
  const finBtn = document.getElementById('cm-finalize-btn');

  const usedPct = closeActions.reduce((s, a) => s + (a.pct || 0), 0);
  const pnl     = closeActions.reduce((s, a) => s + (a.pnl || 0), 0);
  const rem     = 100 - usedPct;

  // ── ИСПРАВЛЕНО: Фактический RR = factualPnl / |pnlStop|
  let actualRR = 0;
  if (closingTrade && closeActions.length > 0) {
    const pnlStop = tradePnlStop(closingTrade);
    actualRR = calcActualRR(pnl, pnlStop);
  }

  if (closeActions.length > 0) {
    if (wrap) wrap.style.display = 'block';
    if (list) list.innerHTML = closeActions.map((a, i) => `
      <div class="action-history-item">
        <span style="color:var(--t2);">${a.label}</span>
        <span style="color:${a.pnl >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:bold;">
          ${a.pnl >= 0 ? '+' : ''}$${fmt(a.pnl)}
        </span>
        <button data-remove-action="${i}" class="btn-remove-action">✕</button>
      </div>`).join('');

    if (pctEl) pctEl.textContent = usedPct.toFixed(0) + '% · осталось ' + rem.toFixed(0) + '%';
    if (pnlEl) {
      pnlEl.textContent = (pnl >= 0 ? '+' : '') + '$' + fmt(pnl);
      pnlEl.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
    }
    if (rrEl) {
      rrEl.textContent = actualRR > 0 ? '1:' + fmt(actualRR, 2) : '—';
      rrEl.style.color = 'var(--amber)';
    }
  } else {
    if (wrap) wrap.style.display = 'none';
  }

  if (finBtn) finBtn.style.display = closeActions.length > 0 ? 'block' : 'none';
}

// ── Toast ─────────────────────────────────────────────────────────
export function showToast(message, duration = 2000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Img preview ───────────────────────────────────────────────────
export function renderImgPreview(pendingImages) {
  const row = document.getElementById('img-preview-row');
  if (!row) return;

  row.innerHTML = pendingImages.map((src, i) => `
    <div class="img-thumb-wrap">
      <img class="img-thumb" src="${src}" data-lightbox="${src.replace(/'/g, "\\'")}">
      <button class="img-remove" data-remove-img="${i}">✕</button>
    </div>`).join('');

  const btn = document.querySelector('.img-upload-btn');
  if (btn) btn.style.display = pendingImages.length >= 3 ? 'none' : 'flex';
}

// ── LIVE ──────────────────────────────────────────────────────────
export function renderLiveRequests(livePendingRequests) {
  const list = document.getElementById('live-requests-list');
  if (!list) return;
  if (livePendingRequests.length === 0) {
    list.innerHTML = '<div class="live-empty">Нет заявок</div>';
    return;
  }
  list.innerHTML = livePendingRequests.map(req => `
    <div class="live-request-card" data-live-admin-modal="${req.telegramId}" data-nickname="${req.nickname || ''}" data-role="${req.role || 'viewer'}">
      <div class="live-request-info">
        <div class="live-request-nickname">${req.nickname || '@unknown'}</div>
        <div class="live-request-role">ID: ${req.telegramId} · ${req.role === 'trader' ? '📹 Трейдер' : '👁 Зритель'}</div>
      </div>
      <button class="live-request-action">➕</button>
    </div>`).join('');
}

export function renderLiveWhitelist(liveWhitelist) {
  const list = document.getElementById('live-whitelist');
  if (!list) return;
  if (liveWhitelist.length === 0) {
    list.innerHTML = '<div class="live-empty">Список пуст</div>';
    return;
  }
  list.innerHTML = liveWhitelist.map(entry => {
    const expiry = entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString('ru-RU') : '∞';
    return `
    <div class="live-whitelist-item">
      <div class="live-whitelist-info">
        <div class="live-whitelist-name">${entry.nickname || '@unknown'}</div>
        <div class="live-whitelist-role">${entry.role === 'trader' ? '📹 Трейдер' : '👁 Зритель'}</div>
        <div class="live-whitelist-expires">До: ${expiry}</div>
      </div>
      <div class="live-wl-actions">
        <button class="btn-wl-action" data-live-admin-modal="${entry.telegramId}" data-nickname="${entry.nickname || ''}" data-role="${entry.role || 'viewer'}">⚙️</button>
      </div>
    </div>`;
  }).join('');
}
