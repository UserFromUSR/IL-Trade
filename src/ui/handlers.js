// src/ui/handlers.js
// Все слушатели событий — никаких onclick/oninput в HTML

import { liveCalcValues, calcTrade, calcEarlyClose, calcPartialClose,
         tradeCoinsLev, buildExportData, fmt, nowStr } from '../services/calculator.js';
import { PROJECT_ID } from '../config/firebase.js';
import {
  renderLiveCalc, renderStats, renderJournal, renderOpenTrades,
  renderSummary, renderDayHistory, renderMexcSummary, renderNotifs,
  renderChannelUI, renderCloseHistory, renderImgPreview, showToast,
  renderLiveRequests, renderLiveWhitelist, S
} from './renderer.js';

// ── Состояние (будет инжектироваться из main.js) ───────────────────
let _state = null;
let _db    = null;

export function initHandlers(state, db) {
  _state = state;
  _db    = db;

  // Скрывать клавиатуру при тапе вне инпута
  document.addEventListener('click', e => {
    const isInput = e.target.tagName === 'INPUT'
      || e.target.tagName === 'TEXTAREA'
      || e.target.tagName === 'SELECT';
    if (!isInput) document.activeElement?.blur();
  });

  _bindTabs();
  _bindForm();
  _bindNotifs();
  _bindCloseModal();
  _bindLiveSection();
  _bindMexc();
  _bindChannel();
  _bindExport();
  _bindSummaryPeriod();
  _bindGlobalDelegation();
}

// ─────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────
function _bindTabs() {
  document.querySelectorAll('.tnav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn));
  });
}

export function switchTab(id, btn) {
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tnav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + id)?.classList.add('active');
  if (btn) btn.classList.add('active');

  if (id === 'itogi') {
    renderSummary(_state.trades, getPeriodStart(_state.currentPeriod));
    renderDayHistory(_state.trades, getPeriodStart(_state.currentPeriod));
  }
  if (id === 'mexc')    renderMexcSummary(_state.trades);
  if (id === 'open') {
    renderOpenTrades(_state.trades, _state.mexcWs);
    subscribeOpenTradeAssets();
  }
  if (id === 'channel') loadChannelSettings();
  if (id === 'live')    initLiveTab();
}

function subscribeOpenTradeAssets() {
  const openTrades = Object.values(_state.trades).filter(t => !t.status || t.status === 'open');
  if (openTrades.length > 0) {
    const assets = openTrades.map(t => t.asset).filter(Boolean);
    if (assets.length > 0) _state.mexcWs?.subscribe(assets);
  }
}

// ─────────────────────────────────────────────────────────────────
// Form
// ─────────────────────────────────────────────────────────────────
function _bindForm() {
  // Live-calc инпуты (leverage обрабатывается отдельно через syncLev)
  ['deposit','riskPercent','entry','stop','tp1_price','tp1_percent','tp2_price'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', _triggerLiveCalc);
  });

  // Слайдер плеча
  document.getElementById('leverage-slider')?.addEventListener('input', () => syncLev('slider'));
  document.getElementById('leverage')?.addEventListener('input', () => syncLev('input'));

  // Пресеты плеча
  document.querySelectorAll('.lev-preset[data-lev]').forEach(btn => {
    btn.addEventListener('click', () => setLev(+btn.dataset.lev));
  });

  // LONG / SHORT
  document.querySelectorAll('.side-btn[data-side]').forEach(btn => {
    btn.addEventListener('click', () => selectSide(btn.dataset.side));
  });

  // Эмоции
  document.querySelectorAll('.emotion-btn[data-emotion]').forEach(btn => {
    btn.addEventListener('click', () => selectEmotion(btn.dataset.emotion));
  });

  // RM
  document.querySelectorAll('.rm-btn[data-rm]').forEach(btn => {
    btn.addEventListener('click', () => selectRM(btn.dataset.rm === 'true'));
  });

  // Звёзды
  document.querySelectorAll('.star[data-star]').forEach(btn => {
    btn.addEventListener('click', () => selectStar(+btn.dataset.star));
  });

  // Аргументы
  document.querySelectorAll('#args-grid input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', updateArgs);
  });

  // Изображения
  document.getElementById('img-upload-trigger')?.addEventListener('click', () => {
    document.getElementById('img-input')?.click();
  });
  document.getElementById('img-input')?.addEventListener('change', handleImgSelect);

  // Сохранить сделку
  document.getElementById('save-trade-btn')?.addEventListener('click', saveTrade);
}

function _triggerLiveCalc() {
  const v = _getLiveCalcInputs();
  const result = liveCalcValues(v);
  if (result) {
    result.riskPercent = v.riskPercent;
    result.tp1Price    = v.tp1Price;
    result.tp1FixPct   = v.tp1FixPct;
    result.tp2Price    = v.tp2Price;
  }
  renderLiveCalc(result);
}

function _getLiveCalcInputs() {
  const g = id => +( document.getElementById(id)?.value ?? 0 );
  return {
    deposit:    g('deposit'),
    leverage:   g('leverage') || 1,
    riskPercent: g('riskPercent'),
    entry:      g('entry'),
    stop:       g('stop'),
    tp1Price:   g('tp1_price'),
    tp1FixPct:  g('tp1_percent') || 50,
    tp2Price:   g('tp2_price'),
    side:       document.getElementById('side')?.value || 'LONG'
  };
}

export function syncLev(src) {
  const sl  = document.getElementById('leverage-slider');
  const inp = document.getElementById('leverage');
  if (src === 'slider') {
    inp.value = sl.value;
  } else {
    const v = Math.min(300, Math.max(1, +inp.value || 1));
    inp.value = v;
    sl.value  = v;
  }
  document.querySelectorAll('.lev-preset').forEach(b => {
    b.classList.toggle('active', +b.dataset.lev === +inp.value);
  });
  _triggerLiveCalc();
}

export function setLev(v) {
  const inp = document.getElementById('leverage');
  const sl  = document.getElementById('leverage-slider');
  if (inp) inp.value = v;
  if (sl)  sl.value  = v;
  document.querySelectorAll('.lev-preset').forEach(b => {
    b.classList.toggle('active', +b.dataset.lev === v);
  });
  _triggerLiveCalc();
}

export function selectSide(side) {
  const hiddenEl = document.getElementById('side');
  if (hiddenEl) hiddenEl.value = side;
  document.getElementById('side-long')?.classList.toggle('active',  side === 'LONG');
  document.getElementById('side-short')?.classList.toggle('active', side === 'SHORT');
  _triggerLiveCalc();
}

export function selectEmotion(key) {
  _state.selectedEmotion = key;
  ['calm','excited','fear','fomo'].forEach(k =>
    document.getElementById('em-' + k)?.classList.toggle('selected', k === key)
  );
}

export function selectRM(v) {
  _state.selectedRM = v;
  document.getElementById('rm-yes')?.classList.toggle('selected-yes', v === true);
  document.getElementById('rm-no')?.classList.toggle('selected-no',  v === false);
}

export function selectStar(num) {
  _state.selectedStars = num;
  for (let i = 1; i <= 5; i++) {
    document.getElementById('star-' + i)?.classList.toggle('active', i <= num);
  }
}

export function updateArgs() {
  _state.selectedArgs = [];
  const argIds = [
    'arg-azgard-cloud','arg-azgard-anomaly','arg-algoalpha','arg-technique',
    'arg-candles','arg-ob','arg-fvg','arg-obfvg','arg-fibonacci','arg-smartmoney'
  ];
  argIds.forEach(id => {
    const el = document.getElementById(id);
    if (el?.checked) _state.selectedArgs.push(id.replace('arg-', '').replace(/-/g, ' '));
  });
}

export function clearForm() {
  ['asset','deposit','riskPercent','entry','stop','tp1_price','tp1_percent','tp2_price','note']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  setLev(10);
  clearImgPreview();
  selectEmotion(null);
  selectRM(null);
  selectStar(0);
  _state.selectedArgs = [];
  document.querySelectorAll('#args-grid input[type="checkbox"]').forEach(cb => cb.checked = false);
  selectSide('LONG');
  _triggerLiveCalc();
}

// ─────────────────────────────────────────────────────────────────
// Save trade
// ─────────────────────────────────────────────────────────────────
export async function saveTrade() {
  if (!_state.uid)      { alert('Не авторизован. Обновите страницу.'); return; }
  if (!_state.tradesRef) { alert('Firebase не подключён. Обновите страницу.'); return; }

  const asset = document.getElementById('asset')?.value?.trim();
  const entry = +document.getElementById('entry')?.value;
  if (!asset)  { alert('Укажите актив'); return; }
  if (!entry)  { alert('Укажите цену входа'); return; }

  const isNew       = !_state.editId;
  const safeImages  = _state.pendingImages.slice(0, 3);

  const raw = {
    id:          _state.editId || Date.now(),
    source: 'manual',
    date:        document.getElementById('date')?.value,
    time:        document.getElementById('time')?.value,
    side:        document.getElementById('side')?.value || 'LONG',
    asset,
    deposit:     +document.getElementById('deposit')?.value || 0,
    leverage:    +document.getElementById('leverage')?.value || 1,
    riskPercent: +document.getElementById('riskPercent')?.value || 0,
    entry,
    stop:        +document.getElementById('stop')?.value || 0,
    tp1_price:   +document.getElementById('tp1_price')?.value || 0,
    tp1_percent: +document.getElementById('tp1_percent')?.value || 50,
    tp2_price:   +document.getElementById('tp2_price')?.value || 0,
    strategy:    _state.selectedArgs.join(', '),
    result:      isNew ? 'open' : (_state.trades[_state.editId]?.result || 'open'),
    status:      isNew ? 'open' : (_state.trades[_state.editId]?.status || 'open'),
    closeDate:   isNew ? '' : (_state.trades[_state.editId]?.closeDate || ''),
    closeTime:   isNew ? '' : (_state.trades[_state.editId]?.closeTime || ''),
    emotion:     _state.selectedEmotion || '',
    followedRM:  _state.selectedRM,
    quality:     _state.selectedStars,
    note:        document.getElementById('note')?.value || '',
    images:      safeImages,
    archived:    false,
    closeActions: isNew ? [] : (_state.trades[_state.editId]?.closeActions || []),
    ...(!isNew ? {
      pnl:           _state.trades[_state.editId]?.pnl || 0,
      rr:            _state.trades[_state.editId]?.rr  || 0,
      plannedRR:     _state.trades[_state.editId]?.plannedRR || 0,
      pnl1:          _state.trades[_state.editId]?.pnl1 || 0,
      pnl2:          _state.trades[_state.editId]?.pnl2 || 0,
      tp1ProfitPct:  _state.trades[_state.editId]?.tp1ProfitPct || 0,
      tp2ProfitPct:  _state.trades[_state.editId]?.tp2ProfitPct || 0,
      totalProfitPct: _state.trades[_state.editId]?.totalProfitPct || 0,
      positionBase:  _state.trades[_state.editId]?.positionBase || 0,
      positionFull:  _state.trades[_state.editId]?.positionFull || 0,
      riskUSD:       _state.trades[_state.editId]?.riskUSD || 0
    } : {})
  };

  let t;
  try {
    t = calcTrade(raw);
  } catch (calcErr) {
    alert('Ошибка расчёта: ' + calcErr.message);
    return;
  }

  try {
    await _state.tradesRef.child(String(t.id)).set(t);
    clearForm();
    _state.editId = null;
    const journalBtn = document.querySelector('.tnav-btn[data-tab="journal"]');
    switchTab('journal', journalBtn);

    if (isNew && _state.channelSettings.channelId && _state.channelSettings.enabled) {
      await postToChannel(t, 'open');
    }
  } catch (e) {
    console.error('Save error:', e);
    if (safeImages.length > 0 && e.message?.includes('size')) {
      try {
        t.images = [];
        await _state.tradesRef.child(String(t.id)).set(t);
        alert('Сделка сохранена (без изображений — превышен лимит размера)');
        clearForm();
        _state.editId = null;
      } catch (e2) {
        alert('Ошибка сохранения: ' + e2.message);
      }
    } else {
      alert('Ошибка сохранения: ' + e.message);
    }
  }
}

export async function deleteTrade(id) {
  if (!confirm('Удалить сделку?')) return;
  try {
    await _state.tradesRef.child(String(id)).remove();
  } catch (e) {
    alert('Ошибка удаления: ' + e.message);
  }
}

export function editTrade(id) {
  const t = _state.trades[id];
  if (!t) return;
  _state.editId = id;

  document.getElementById('date').value         = t.date       || '';
  document.getElementById('time').value         = t.time       || '';
  selectSide(t.side || 'LONG');
  document.getElementById('asset').value        = t.asset      || '';
  document.getElementById('deposit').value      = t.deposit    || '';
  document.getElementById('leverage').value     = t.leverage   || 1;
  document.getElementById('leverage-slider').value = t.leverage || 1;
  document.getElementById('riskPercent').value  = t.riskPercent || '';
  document.getElementById('entry').value        = t.entry      || '';
  document.getElementById('stop').value         = t.stop       || '';
  document.getElementById('tp1_price').value    = t.tp1_price  || '';
  document.getElementById('tp1_percent').value  = t.tp1_percent || 50;
  document.getElementById('tp2_price').value    = t.tp2_price  || '';
  document.getElementById('note').value         = t.note       || '';

  if (t.emotion) selectEmotion(t.emotion);
  if (t.followedRM !== null && t.followedRM !== undefined) selectRM(t.followedRM);
  if (t.quality) selectStar(t.quality);

  if (t.strategy) {
    const args = t.strategy.split(', ').map(a => a.trim().toLowerCase().replace(/ /g, '-'));
    document.querySelectorAll('#args-grid input[type="checkbox"]').forEach(cb => {
      const argKey = cb.id.replace('arg-', '');
      cb.checked = args.some(a => a.includes(argKey) || argKey.includes(a));
    });
    updateArgs();
  }

  if (t.images?.length) {
    _state.pendingImages = [...t.images];
    renderImgPreview(_state.pendingImages);
  }

  syncLev('slider');
  _triggerLiveCalc();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────
function _bindNotifs() {
  document.getElementById('notif-btn')?.addEventListener('click',    toggleNotif);
  document.getElementById('notif-close-btn')?.addEventListener('click', toggleNotif);
  document.getElementById('notif-overlay')?.addEventListener('click',   toggleNotif);
  document.getElementById('mark-all-read-btn')?.addEventListener('click', markAllRead);
  document.getElementById('clear-notifs-btn')?.addEventListener('click', clearNotifs);
}

export function toggleNotif() {
  const panel = document.getElementById('notif-panel');
  panel?.classList.toggle('open');
  if (panel?.classList.contains('open')) markAllRead();
}

export async function addNotif(data) {
  if (!_state.notifsRef) return;
  const id = Date.now();
  await _state.notifsRef.child(String(id)).set({ id, ...data, read: false });
}

export async function markAllRead() {
  const updates = {};
  _state.notifications.forEach(n => { updates[`${n.id}/read`] = true; });
  if (Object.keys(updates).length) await _state.notifsRef.update(updates);
}

export async function clearNotifs() {
  if (!confirm('Очистить все уведомления?')) return;
  await _state.notifsRef.remove();
}

export function checkReminders() {
  const now    = new Date();
  const hour   = now.getHours();
  const today  = now.toISOString().slice(0, 10);
  const todayTrades = Object.values(_state.trades).filter(t => t.date === today);

  if (todayTrades.length === 0 && hour >= 10) {
    addNotif({ icon: '📝', title: 'Сделок сегодня нет', desc: 'Не забудь записать свои сделки за день', time: nowStr() });
  }
  if (hour >= 20 && todayTrades.length > 0) {
    const dayPnl  = todayTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const dayWins = todayTrades.filter(t => t.result === 'win').length;
    addNotif({
      icon: dayPnl >= 0 ? '📈' : '📉',
      title: `Итоги дня — ${today}`,
      desc: `Сделок: ${todayTrades.length} · Побед: ${dayWins} · PnL: ${dayPnl >= 0 ? '+' : ''}${fmt(dayPnl)}$`,
      time: nowStr()
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Period (Итоги)
// ─────────────────────────────────────────────────────────────────
function _bindSummaryPeriod() {
  document.querySelectorAll('.stats-period-btn[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      _state.currentPeriod = btn.dataset.period;
      document.querySelectorAll('.stats-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderSummary(_state.trades, getPeriodStart(_state.currentPeriod));
      renderDayHistory(_state.trades, getPeriodStart(_state.currentPeriod));
    });
  });
}

export function getPeriodStart(p) {
  const d     = new Date();
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (p === 'day')   return today.toISOString().slice(0, 10);
  if (p === 'week')  { const day = today.getDay() || 7; today.setDate(today.getDate() - day + 1); return today.toISOString().slice(0, 10); }
  if (p === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  if (p === 'year')  return new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10);
  return today.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────
// Close modal
// ─────────────────────────────────────────────────────────────────
function _bindCloseModal() {
  document.getElementById('close-modal-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('close-modal-overlay')) closeCloseModal();
  });
  document.getElementById('close-modal-cancel-btn')?.addEventListener('click', closeCloseModal);
  document.getElementById('apply-close-action-btn')?.addEventListener('click', applyCloseAction);
  document.getElementById('cm-finalize-btn')?.addEventListener('click', () => finalizeTrade(false));

  // Close opts
  document.querySelectorAll('.close-opt[data-val]').forEach(el => {
    el.addEventListener('click', () => selectCloseOpt(el, el.dataset.val));
  });

  // Extra inputs
  ['partial-price','partial-percent','early-price','customstop-price'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calcExtra);
  });
}

export function openCloseModal(id) {
  const t = _state.trades[id];
  if (!t) return;
  _state.closingTradeId   = id;
  _state.selectedCloseOpt = null;
  _state.closeActions     = Array.isArray(t.closeActions) ? [...t.closeActions] : [];

  const now = new Date();
  document.getElementById('cm-close-date').value = now.toISOString().slice(0, 10);
  document.getElementById('cm-close-time').value = now.toTimeString().slice(0, 5);
  document.getElementById('cm-trade-title').textContent = t.side + ' ' + t.asset;
  document.getElementById('cm-trade-sub').textContent   =
    'Открыта ' + t.date + ' ' + t.time + ' · Вход: ' + t.entry + ' · Риск: $' + fmt(t.riskUSD || 0, 2);

  resetCloseOpts();
  renderCloseHistory(_state.closeActions, _state.trades[_state.closingTradeId]);
  document.getElementById('close-modal-overlay')?.classList.add('open');
}

function closeCloseModal() {
  document.getElementById('close-modal-overlay')?.classList.remove('open');
  _state.closingTradeId   = null;
  _state.selectedCloseOpt = null;
}

function resetCloseOpts() {
  document.querySelectorAll('.close-opt').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('.co-extra').forEach(e => e.classList.remove('visible'));
  ['early-price','partial-price','partial-percent'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  ['early-result','partial-result'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = '—'; el.style.color = 'var(--t2)'; }
  });
  _state.selectedCloseOpt = null;
}

function selectCloseOpt(el, val) {
  document.querySelectorAll('.close-opt').forEach(o => o.classList.remove('selected'));
  document.querySelectorAll('.co-extra').forEach(e => e.classList.remove('visible'));
  el.classList.add('selected');
  _state.selectedCloseOpt = val;
  const extra = document.getElementById('extra-' + val);
  if (extra) {
    extra.classList.add('visible');
    setTimeout(() => extra.querySelector('input')?.focus(), 50);
  }
  calcExtra();
}

function calcExtra() {
  const t = _state.closingTradeId ? _state.trades[_state.closingTradeId] : null;
  if (!t) return;

  const coinsLev = tradeCoinsLev(t);
  const usedPct  = _state.closeActions.reduce((s, a) => s + (a.pct || 0), 0);
  const rem      = Math.max(0, 100 - usedPct);

  if (_state.selectedCloseOpt === 'early') {
    const price = +document.getElementById('early-price')?.value;
    const resEl = document.getElementById('early-result');
    if (!price) { if (resEl) { resEl.textContent = '—'; resEl.style.color = 'var(--t2)'; } return; }
    const { pnl, pct } = calcEarlyClose(t, price, coinsLev, rem);
    if (resEl) {
      resEl.textContent = (pnl >= 0 ? '+' : '') + '$' + fmt(pnl) + ' (' + pct.toFixed(2) + '%) · ' + rem.toFixed(0) + '% объёма';
      resEl.style.color = pnl >= 0 ? 'var(--green)' : 'var(--red)';
    }
  }

  if (_state.selectedCloseOpt === 'partial') {
    const price  = +document.getElementById('partial-price')?.value;
    const pct    = +document.getElementById('partial-percent')?.value;
    const resEl  = document.getElementById('partial-result');
    if (!price || !pct) { if (resEl) { resEl.textContent = '—'; resEl.style.color = 'var(--t2)'; } return; }
    const { pnl: pnlCalc, pricePct, actualPct, remaining } = calcPartialClose(t, price, pct, coinsLev, rem);
    if (resEl) {
      resEl.textContent = (pnlCalc >= 0 ? '+' : '') + '$' + fmt(pnlCalc) + ' (' + pricePct.toFixed(2) + '%) · ' + actualPct.toFixed(0) + '% объёма · осталось ' + remaining.toFixed(0) + '%';
      resEl.style.color = pnlCalc >= 0 ? 'var(--green)' : 'var(--red)';
    }
  }
}

export function applyCloseAction() {
  const t = _state.closingTradeId ? _state.trades[_state.closingTradeId] : null;
  if (!t || !_state.selectedCloseOpt) { alert('Выберите действие'); return; }

  const calc     = calcTrade(t);
  const coinsLev = tradeCoinsLev(t);
  const usedPct  = _state.closeActions.reduce((s, a) => s + (a.pct || 0), 0);
  const rem      = Math.max(0, 100 - usedPct);
  const remCoins = coinsLev * (rem / 100);
  const dt       = document.getElementById('cm-close-date')?.value;
  const tm       = document.getElementById('cm-close-time')?.value;

  let action = null;

  if (_state.selectedCloseOpt === 'partial') {
    const price = +document.getElementById('partial-price')?.value;
    const pct   = +document.getElementById('partial-percent')?.value;
    if (!price || !pct) { alert('Укажите цену и % закрытия'); return; }
    const actualPct = Math.min(pct, rem);
    const partCoins = coinsLev * (actualPct / 100);
    const pnl = t.side === 'LONG' ? (price - t.entry) * partCoins : (t.entry - price) * partCoins;
    action = { type: 'partial', label: `Частичное ${actualPct}% по ${price}`, price, pct: actualPct, pnl, dt, tm };

  } else if (_state.selectedCloseOpt === 'early') {
    const price = +document.getElementById('early-price')?.value;
    if (!price) { alert('Укажите цену закрытия'); return; }
    const pnl = t.side === 'LONG' ? (price - t.entry) * remCoins : (t.entry - price) * remCoins;
    action = { type: 'early', label: `Ушёл раньше ${rem.toFixed(0)}% по ${price}`, price, pct: rem, pnl, dt, tm };

  } else if (_state.selectedCloseOpt === 'tp1only') {
    const tp1Pct    = t.tp1_percent || 50;
    const actualPct = Math.min(tp1Pct, rem);
    const tp1Coins  = coinsLev * (actualPct / 100);
    const pnl = t.side === 'LONG' ? (t.tp1_price - t.entry) * tp1Coins : (t.entry - t.tp1_price) * tp1Coins;
    action = { type: 'tp1', label: `TP1 ${actualPct}% по ${t.tp1_price}`, price: t.tp1_price, pct: actualPct, pnl, dt, tm };

  } else if (_state.selectedCloseOpt === 'tp1tp2') {
    const tp1Pct   = Math.min(t.tp1_percent || 50, rem);
    const tp1Coins = coinsLev * (tp1Pct / 100);
    const pnl1 = t.side === 'LONG' ? (t.tp1_price - t.entry) * tp1Coins : (t.entry - t.tp1_price) * tp1Coins;
    const rem2     = rem - tp1Pct;
    const tp2Coins = coinsLev * (rem2 / 100);
    const pnl2 = t.side === 'LONG' ? (t.tp2_price - t.entry) * tp2Coins : (t.entry - t.tp2_price) * tp2Coins;
    _state.closeActions.push({ type: 'tp1', label: `TP1 ${tp1Pct}% по ${t.tp1_price}`,         price: t.tp1_price, pct: tp1Pct, pnl: pnl1, dt, tm });
    _state.closeActions.push({ type: 'tp2', label: `TP2 ${rem2.toFixed(0)}% по ${t.tp2_price}`, price: t.tp2_price, pct: rem2,   pnl: pnl2, dt, tm });
    _applyAndPostAction(t);
    return;

  } else if (_state.selectedCloseOpt === 'be') {
    action = { type: 'be', label: `Безубыток ${rem.toFixed(0)}% по ${t.entry}`, price: t.entry, pct: rem, pnl: 0, dt, tm };

  } else if (_state.selectedCloseOpt === 'tp1be') {
    const tp1Pct   = Math.min(t.tp1_percent || 50, rem);
    const tp1Coins = coinsLev * (tp1Pct / 100);
    const pnl1 = t.side === 'LONG' ? (t.tp1_price - t.entry) * tp1Coins : (t.entry - t.tp1_price) * tp1Coins;
    const rem2 = rem - tp1Pct;
    _state.closeActions.push({ type: 'tp1', label: `TP1 ${tp1Pct}% по ${t.tp1_price}`,       price: t.tp1_price, pct: tp1Pct, pnl: pnl1, dt, tm });
    _state.closeActions.push({ type: 'be',  label: `Б/У ${rem2.toFixed(0)}% по ${t.entry}`,  price: t.entry,     pct: rem2,   pnl: 0,    dt, tm });
    _applyAndPostAction(t);
    return;

  } else if (_state.selectedCloseOpt === 'stop') {
    const pnl = calc.pnlStop * (rem / 100);
    action = { type: 'stop', label: `Стоп ${rem.toFixed(0)}% по ${t.stop}`, price: t.stop, pct: rem, pnl, dt, tm };

  } else if (_state.selectedCloseOpt === 'customstop') {
    const price = +document.getElementById('customstop-price')?.value;
    if (!price) { alert('Укажите цену кастомного стоп-лосса'); return; }
    const pnl = t.side === 'LONG' ? (price - t.entry) * remCoins : (t.entry - price) * remCoins;
    action = { type: 'customstop', label: `Кастом.стоп ${rem.toFixed(0)}% по ${price}`, price, pct: rem, pnl, dt, tm };
  }

  if (action) {
    _state.closeActions.push(action);
    _applyAndPostAction(t);
  }
}

async function _applyAndPostAction(t) {
  resetCloseOpts();
  renderCloseHistory(_state.closeActions, _state.trades[_state.closingTradeId]);
  await _savePartialState();

  const usedPct = _state.closeActions.reduce((s, a) => s + (a.pct || 0), 0);
  if (usedPct >= 99.9) {
    setTimeout(() => { finalizeTrade(true); }, 500);
    return;
  }

  if (_state.channelSettings.channelId && _state.channelSettings.enabled && _state.channelSettings.autoPostPartial) {
    const posts   = await _getChannelPosts(t.id);
    const updated = { ...t, closeActions: _state.closeActions };
    updated.partialPnl = _state.closeActions.reduce((s, a) => s + (a.pnl || 0), 0);
    updated.closedPct  = usedPct;
    await _postToChannelWithReply(updated, 'partial', posts.openPostId);
  }

  closeCloseModal();
  renderOpenTrades(_state.trades, _state.mexcWs);
  showToast(`✅ Закрыто ${usedPct.toFixed(0)}% объёма`);
}

async function _savePartialState() {
  const t = _state.closingTradeId ? _state.trades[_state.closingTradeId] : null;
  if (!t || !_state.tradesRef) return;
  try {
    const partial = {
      ...t,
      closeActions: _state.closeActions,
      closedPct:    _state.closeActions.reduce((s, a) => s + (a.pct || 0), 0),
      partialPnl:   _state.closeActions.reduce((s, a) => s + (a.pnl || 0), 0),
      status:       'open'
    };
    await _state.tradesRef.child(String(t.id)).set(partial);
    _state.trades[t.id] = partial;
  } catch (e) {
    console.error('Partial save error:', e);
  }
}

export async function finalizeTrade(autoClose = false) {
  const t = _state.closingTradeId ? _state.trades[_state.closingTradeId] : null;
  if (!t || _state.closeActions.length === 0) return;

  const usedPct = _state.closeActions.reduce((s, a) => s + (a.pct || 0), 0);
  const pnl     = _state.closeActions.reduce((s, a) => s + (a.pnl || 0), 0);
  const lastAct = _state.closeActions[_state.closeActions.length - 1];

  let result = 'be';
  if (pnl > 0) result = 'win';
  if (pnl < 0) result = 'loss';
  const hasStop = _state.closeActions.some(a => a.type === 'stop');
  const hasTp1  = _state.closeActions.some(a => a.type === 'tp1');
  if (hasStop && hasTp1) result = 'tp1be';

  const lev     = t.leverage || 1;
  const riskUSD = t.riskUSD || (t.deposit * (t.riskPercent / 100));
  const stopPct = t.entry && t.stop ? Math.abs(t.entry - t.stop) / t.entry : 0;
  const pnlStop = -(riskUSD * lev * stopPct);

  // ── ИСПРАВЛЕНО: Фактический RR = factualPnl / |pnlStop|
  const actualRR = pnl !== 0 && pnlStop !== 0 ? Math.abs(pnl) / Math.abs(pnlStop) : 0;

  const updated = {
    ...t,
    status:       'closed',
    result,
    closeDate:    lastAct.dt,
    closeTime:    lastAct.tm,
    closeActions: _state.closeActions,
    closedPct:    usedPct,
    pnl,
    pnl1: _state.closeActions.filter(a => a.type === 'tp1').reduce((s, a) => s + a.pnl, 0),
    pnl2: _state.closeActions.filter(a => a.type === 'tp2').reduce((s, a) => s + a.pnl, 0),
    rr: actualRR
  };

  try {
    await _state.tradesRef.child(String(t.id)).set(updated);
    closeCloseModal();

    if (_state.channelSettings.channelId && _state.channelSettings.enabled && _state.channelSettings.autoPostClose) {
      const posts   = await _getChannelPosts(t.id);
      const replyId = posts.lastUpdatePostId || posts.openPostId;
      await _postToChannelWithReply(updated, 'close', replyId);
    }

    if (!autoClose) {
      const journalBtn = document.querySelector('.tnav-btn[data-tab="journal"]');
      switchTab('journal', journalBtn);
    } else {
      renderOpenTrades(_state.trades, _state.mexcWs);
    }
  } catch (e) {
    alert('Ошибка сохранения: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// Images
// ─────────────────────────────────────────────────────────────────
function handleImgSelect(e) {
  const files     = Array.from(e.target.files);
  const remaining = 3 - _state.pendingImages.length;
  const toAdd     = files.slice(0, remaining);
  toAdd.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      _state.pendingImages.push(ev.target.result);
      renderImgPreview(_state.pendingImages);
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
}

function clearImgPreview() {
  _state.pendingImages = [];
  const row = document.getElementById('img-preview-row');
  if (row) row.innerHTML = '';
  const btn = document.querySelector('.img-upload-btn');
  if (btn) btn.style.display = 'flex';
}

// ─────────────────────────────────────────────────────────────────
// MEXC
// ─────────────────────────────────────────────────────────────────
const SYNC_FUNCTION_URL = 'https://europe-west1-il-trade.cloudfunctions.net/syncMexc';

function _bindMexc() {
  document.getElementById('save-mexc-keys-btn')?.addEventListener('click', saveMexcKeys);
  document.getElementById('delete-mexc-keys-btn')?.addEventListener('click', deleteMexcKeys);
  document.getElementById('mexc-sync-btn')?.addEventListener('click', syncMexcNow);
  document.getElementById('mexc-import-btn')?.addEventListener('click', syncMexcNow);
}

export async function loadMexcKeys() {
  if (!_state.uid) return;
  const snap = await _db.ref(`users/${_state.uid}/mexc`).once('value');
  const data = snap.val();
  setMexcStatus(
    data && data.hasKeys ? 'saved' : 'none',
    data && data.hasKeys ? `Ключи сохранены · ${data.lastSync || 'не синхронизировано'}` : 'Ключи не настроены'
  );
}

async function saveMexcKeys() {
  const k = document.getElementById('mexc-api-key')?.value.trim();
  const s = document.getElementById('mexc-api-secret')?.value.trim();
  if (!k || !s) { alert('Введите API Key и Secret'); return; }
  try {
    await _db.ref(`users/${_state.uid}/mexcApiKey`).set(k);
    await _db.ref(`users/${_state.uid}/mexcApiSecret`).set(s);
    await _db.ref(`users/${_state.uid}/mexc`).update({ hasKeys: true });
    document.getElementById('mexc-api-key').value   = '';
    document.getElementById('mexc-api-secret').value = '';
    setMexcStatus('saved', 'Ключи сохранены ✅');
  } catch (e) { alert('Ошибка: ' + e.message); }
}

async function deleteMexcKeys() {
  if (!confirm('Удалить API ключи MEXC?')) return;
  await _db.ref(`users/${_state.uid}/mexcApiKey`).remove();
  await _db.ref(`users/${_state.uid}/mexcApiSecret`).remove();
  await _db.ref(`users/${_state.uid}/mexc`).update({ hasKeys: false });
  setMexcStatus('none', 'Ключи удалены');
}

async function syncMexcNow() {
  if (!_state.uid) return;
  const btn  = document.getElementById('mexc-sync-btn');
  const prog = document.getElementById('mexc-progress');
  const sk   = await _db.ref(`users/${_state.uid}/mexcApiKey`).once('value');
  const ss   = await _db.ref(`users/${_state.uid}/mexcApiSecret`).once('value');
  const k = sk.val(), s = ss.val();
  if (!k || !s) { alert('Сначала сохраните API ключи MEXC'); return; }
  if (btn)  { btn.disabled = true;  btn.textContent = '⏳ Загрузка...'; }
  if (prog)   prog.style.display = 'block';
  setMexcStatus('loading', 'Подключение к MEXC...');
  try {
    const res  = await fetch(SYNC_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: _state.uid, apiKey: k, apiSecret: s, limit: 50 }) });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const now = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    await _db.ref(`users/${_state.uid}/mexc`).update({ lastSync: now });
    setMexcStatus('saved', `Импортировано: ${data.imported || 0} · ${now}`);
    renderMexcSummary(_state.trades);
  } catch (e) { setMexcStatus('error', 'Ошибка: ' + e.message); }
  finally {
    if (btn)  { btn.disabled = false; btn.textContent = '🔄 Синхронизировать'; }
    if (prog)   prog.style.display = 'none';
  }
}

export async function autoSyncOnOpen() {
  if (!_state.uid) return;
  const snap = await _db.ref(`users/${_state.uid}/mexc`).once('value');
  const data = snap.val();
  if (!data || !data.hasKeys) return;
  try {
    const sk = await _db.ref(`users/${_state.uid}/mexcApiKey`).once('value');
    const ss = await _db.ref(`users/${_state.uid}/mexcApiSecret`).once('value');
    const k = sk.val(), s = ss.val();
    if (!k || !s) return;
    setMexcStatus('loading', 'Авто-синхронизация...');
    const res   = await fetch(SYNC_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: _state.uid, apiKey: k, apiSecret: s, limit: 20 }) });
    const data2 = await res.json();
    const now   = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    await _db.ref(`users/${_state.uid}/mexc`).update({ lastSync: now });
    setMexcStatus('saved', `Авто: ${data2.imported || 0} новых · ${now}`);
  } catch (e) { setMexcStatus('error', 'Ошибка авто-синхр'); }
}

function setMexcStatus(type, text) {
  const dot  = document.getElementById('mexc-dot');
  const txt  = document.getElementById('mexc-status-text');
  const cols = { none: 'var(--t3)', saved: 'var(--green)', loading: 'var(--amber)', error: 'var(--red)' };
  if (dot) dot.style.background = cols[type] || 'var(--t3)';
  if (txt) { txt.textContent = text; txt.style.color = type === 'error' ? 'var(--red)' : 'var(--t2)'; }
}

// ─────────────────────────────────────────────────────────────────
// Channel
// ─────────────────────────────────────────────────────────────────
function _bindChannel() {
  document.getElementById('save-channel-btn')?.addEventListener('click', saveChannelSettings);
  document.getElementById('disconnect-channel-btn')?.addEventListener('click', disconnectChannel);
  document.getElementById('copy-channel-id-btn')?.addEventListener('click', copyChannelId);
  document.getElementById('refresh-preview-btn')?.addEventListener('click', refreshPreview);
  document.getElementById('test-post-btn')?.addEventListener('click', testPost);

  document.querySelectorAll('.channel-toggle-switch[data-option]').forEach(el => {
    el.addEventListener('click', () => toggleChannelOption(el.dataset.option));
  });
}

export async function loadChannelSettings() {
  if (!_state.uid) return;
  const snap = await _db.ref(`channel/${_state.uid}`).once('value');
  const data = snap.val();
  if (data) Object.assign(_state.channelSettings, data);
  renderChannelUI(_state.channelSettings);
}

async function saveChannelSettings() {
  if (!_state.uid) return;
  const channelId   = document.getElementById('channel-id')?.value?.trim()   || '';
  const channelName = document.getElementById('channel-name')?.value?.trim() || '';
  _state.channelSettings.channelId   = channelId;
  _state.channelSettings.channelName = channelName;
  _state.channelSettings.enabled     = !!channelId;
  await _db.ref(`channel/${_state.uid}`).set(_state.channelSettings);
  renderChannelUI(_state.channelSettings);
  showToast(channelId ? '✅ Канал сохранён' : 'ℹ️ Канал отключён');
}

async function disconnectChannel() {
  if (!_state.uid) return;
  Object.assign(_state.channelSettings, { channelId: '', channelName: '', enabled: false, autoPostOpen: true, autoPostPartial: true, autoPostClose: true });
  await _db.ref(`channel/${_state.uid}`).set(_state.channelSettings);
  const cidEl = document.getElementById('channel-id');
  const cnEl  = document.getElementById('channel-name');
  if (cidEl) cidEl.value = '';
  if (cnEl)  cnEl.value  = '';
  renderChannelUI(_state.channelSettings);
  showToast('ℹ️ Канал отключён');
}

function toggleChannelOption(option) {
  _state.channelSettings[option] = !_state.channelSettings[option];
  renderChannelUI(_state.channelSettings);
  saveChannelSettings();
}

function copyChannelId() {
  const id = _state.channelSettings.channelId;
  if (id) {
    navigator.clipboard.writeText(id)
      .then(() => showToast('📋 Скопировано!'))
      .catch(() => showToast('⚠️ Не удалось скопировать'));
  }
}

function refreshPreview() {
  const openTrades   = Object.values(_state.trades).filter(t => !t.status || t.status === 'open');
  const previewEl    = document.getElementById('channel-preview-text');
  if (!previewEl) return;

  let tradeToPreview = null;
  if (openTrades.length > 0) {
    openTrades.sort((a, b) => b.id - a.id);
    tradeToPreview = openTrades[0];
  } else {
    const closed = Object.values(_state.trades).filter(t => t.status === 'closed');
    if (closed.length > 0) { closed.sort((a, b) => b.id - a.id); tradeToPreview = closed[0]; }
  }

  if (tradeToPreview) {
    const action   = tradeToPreview.status === 'open' ? 'open' : 'close';
    const postText = generateTradePost(tradeToPreview, action, true);
    previewEl.innerHTML = postText.replace(/\n/g, '<br>');
  } else {
    if (_state.mexcWs) _state.mexcWs._prices['BTC'] = { price: 42800, timestamp: Date.now() };
    const mockTrade = {
      id: 'preview-' + Date.now(), asset: 'BTC', side: 'LONG', leverage: 10, deposit: 1000,
      entry: 42500, stop: 42000, tp1_price: 43000, tp1_percent: 50,
      tp2_price: 44000, rr: 2.5, riskUSD: 10, riskPercent: 1,
      date: new Date().toISOString().slice(0, 10), time: new Date().toTimeString().slice(0, 5),
      status: 'open', closeActions: [], strategy: 'Azgard Cloud', quality: 4, followedRM: true
    };
    const postText = generateTradePost(mockTrade, 'open', true);
    previewEl.innerHTML = postText.replace(/\n/g, '<br>');
  }
  showToast('🔄 Превью обновлено');
}

async function testPost() {
  if (!_state.channelSettings.channelId) { showToast('⚠️ Сначала укажите ID канала'); return; }
  const now = new Date();
  const mockTrade = {
    id: 'test-' + Date.now(), asset: 'BTC', side: 'LONG', leverage: 10, deposit: 1000,
    entry: 42500, stop: 42000, tp1_price: 43000, tp1_percent: 50, tp2_price: 44000,
    rr: 2.5, riskUSD: 10, riskPercent: 1, stopPct: 1.18,
    date: now.toISOString().slice(0, 10), time: now.toTimeString().slice(0, 5),
    status: 'open', result: null, closeActions: [],
    strategy: 'Azgard Cloud', note: 'Тестовая публикация', followedRM: true, quality: 4
  };
  const result = await postToChannel(mockTrade, 'open');
  showToast(result?.success ? '✅ Тестовая публикация отправлена!' : '⚠️ Проверьте настройки канала');
}

// ─────────────────────────────────────────────────────────────────
// Channel posting helpers
// ─────────────────────────────────────────────────────────────────
export async function postToChannel(trade, action = 'open') {
  if (!_state.uid || !_state.channelSettings.channelId || !_state.channelSettings.enabled) return null;
  const postEnabled =
    (action === 'open'    && _state.channelSettings.autoPostOpen)    ||
    (action === 'partial' && _state.channelSettings.autoPostPartial) ||
    (action === 'close'   && _state.channelSettings.autoPostClose);
  if (!postEnabled) return null;

  try {
    const response = await fetch('/api/' + PROJECT_ID + '/channel/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': window.Telegram?.WebApp?.initData || '' },
      body: JSON.stringify({ trade, action, channelId: _state.channelSettings.channelId })
    });
    if (response.ok) return await response.json();
  } catch (err) { console.error('[postToChannel]', err); }
  return null;
}

async function _postToChannelWithReply(trade, action, replyToMessageId) {
  if (!_state.uid || !_state.channelSettings.channelId || !_state.channelSettings.enabled) return null;
  const postEnabled =
    (action === 'open'    && _state.channelSettings.autoPostOpen)    ||
    (action === 'partial' && _state.channelSettings.autoPostPartial) ||
    (action === 'close'   && _state.channelSettings.autoPostClose);
  if (!postEnabled) return null;

  try {
    const response = await fetch('/api/' + PROJECT_ID + '/channel/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-telegram-init-data': window.Telegram?.WebApp?.initData || '' },
      body: JSON.stringify({ trade, action, channelId: _state.channelSettings.channelId, replyToMessageId })
    });
    if (response.ok) return await response.json();
  } catch (err) { console.error('[postToChannelWithReply]', err); }
  return null;
}

async function _getChannelPosts(tradeId) {
  if (!_state.uid) return { openPostId: null, lastUpdatePostId: null, closed: false };
  try {
    const snap = await _db.ref(`channelPosts/${_state.uid}/${tradeId}`).once('value');
    return snap.val() || { openPostId: null, lastUpdatePostId: null, closed: false };
  } catch (e) {
    return { openPostId: null, lastUpdatePostId: null, closed: false };
  }
}

function generateTradePost(trade, action = 'open', includeLivePrice = true) {
  const side     = trade.side === 'LONG' ? 'LONG' : 'SHORT';
  const sideIcon = side === 'LONG' ? '🟢' : '🔴';
  const now      = new Date();
  const dateStr  = trade.date || now.toISOString().slice(0, 10);
  const timeStr  = trade.time || now.toTimeString().slice(0, 5);

  const tp1ProfitPct   = trade.tp1_price && trade.entry ? Math.abs(trade.tp1_price - trade.entry) / trade.entry * 100 : 0;
  const tp2ProfitPct   = trade.tp2_price && trade.entry ? Math.abs(trade.tp2_price - trade.entry) / trade.entry * 100 : 0;
  const totalProfitPct = tp1ProfitPct + (tp2ProfitPct > 0 ? tp2ProfitPct : 0);

  const riskUSD      = trade.riskUSD || (trade.deposit * trade.riskPercent / 100);
  const leverage     = trade.leverage || 1;
  const posSize      = riskUSD * leverage;
  const stopDist     = trade.entry && trade.stop ? Math.abs(trade.entry - trade.stop) / trade.entry * 100 : 0;
  const stopPnlLoss  = -(riskUSD * leverage * (stopDist / 100));
  const maxProfitTP1 = trade.tp1_price ? (trade.side === 'LONG' ? (trade.tp1_price - trade.entry) * posSize / trade.entry : (trade.entry - trade.tp1_price) * posSize / trade.entry) : 0;
  const maxProfitTP2 = trade.tp2_price ? (trade.side === 'LONG' ? (trade.tp2_price - trade.entry) * posSize / trade.entry : (trade.entry - trade.tp2_price) * posSize / trade.entry) : 0;
  const tp1PnlCalc   = maxProfitTP1;
  const tp2PnlCalc   = maxProfitTP2;
  const totalPlanPnl = tp1PnlCalc + tp2PnlCalc;
  const plannedRR    = totalPlanPnl > 0 && Math.abs(stopPnlLoss) > 0 ? totalPlanPnl / Math.abs(stopPnlLoss) : (trade.rr || 0);

  const closeActionsData = trade.closeActions || [];
  const realizedPnl      = closeActionsData.reduce((s, a) => s + (a.pnl || 0), 0);

  let livePnlHtml = '';
  if (includeLivePrice && trade.status === 'open' && _state.mexcWs) {
    const liveData = _state.mexcWs.calculateLivePnl(trade);
    if (liveData?.currentPrice) {
      const sign    = liveData.changePct > 0 ? '+' : '';
      const pnlSign = liveData.totalPnl >= 0 ? '+' : '';
      const col     = liveData.totalPnl >= 0 ? 'var(--green)' : 'var(--red)';
      livePnlHtml   = `\n💰 <strong>Live P&L:</strong> <span style="color:${col};">${pnlSign}${fmt(liveData.totalPnl)}</span> (${sign}${liveData.changePct.toFixed(2)}%)`;
    }
  }

  let actionHistory = '';
  closeActionsData.forEach((a, i) => {
    const actPnlPct = a.price && trade.entry ? Math.abs(a.price - trade.entry) / trade.entry * 100 : 0;
    const actDir    = a.price > trade.entry ? '+' : a.price < trade.entry ? '−' : '';
    const pnlColor  = (a.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red)';
    actionHistory  += `\n${i + 1}. <strong>${a.label}</strong> @ ${a.price?.toLocaleString() || '—'} (${actDir}${actPnlPct.toFixed(2)}%) → <span style="color:${pnlColor};">${(a.pnl || 0) >= 0 ? '+' : ''}${fmt(a.pnl)}</span>`;
  });

  if (action === 'open') {
    return `📈 <strong>Открыта сделка</strong>

<strong>${trade.asset}</strong> ${sideIcon} ${side} ${leverage > 1 ? 'x' + leverage : ''}

📅 Дата: ${dateStr.split('-').reverse().join('.')} ${timeStr}
💰 Депозит: <strong>$${fmt(trade.deposit || 0)}</strong>
💰 Объём: <strong>$${fmt(riskUSD)}</strong> ${trade.riskPercent ? '(' + trade.riskPercent + '%)' : ''} <span style="color:var(--blue);">(x${leverage})</span>

📍 Вход: <strong>${trade.entry?.toLocaleString() || '—'}</strong>
🛑 Стоп: <strong>${trade.stop?.toLocaleString() || '—'}</strong> ${stopDist > 0 ? `(${stopDist.toFixed(2)}%)` : ''}
💸 Стоп PnL: <strong style="color:var(--red);">${fmt(stopPnlLoss)}</strong>

🎯 TP1: <strong>${trade.tp1_price?.toLocaleString() || '—'}</strong> ${tp1ProfitPct > 0 ? `(+${fmt(tp1ProfitPct, 2)}%)` : ''}
${trade.tp2_price ? `🎯 TP2: <strong>${trade.tp2_price.toLocaleString()}</strong> ${tp2ProfitPct > 0 ? `(+${fmt(tp2ProfitPct, 2)}%)` : ''}` : ''}

📊 Max прибыль TP1: <strong style="color:var(--green);">+${fmt(maxProfitTP1)}</strong>
${maxProfitTP2 > 0 ? `📊 Max прибыль TP2: <strong style="color:var(--green);">+${fmt(maxProfitTP2)}</strong>` : ''}
${totalProfitPct > 0 ? `💰 Σ Прибыль: <strong style="color:var(--green);">+${fmt(totalProfitPct, 2)}%</strong>` : ''}

📊 Плановый RR: <strong>${plannedRR > 0 ? '1:' + plannedRR.toFixed(2) : '—'}</strong>
💵 Риск: <strong>$${fmt(riskUSD)}</strong>
${livePnlHtml}${actionHistory ? `\n📋 <strong>История закрытий:</strong>${actionHistory}` : ''}

${trade.strategy ? `📐 Стратегия: ${trade.strategy}` : ''}

🔗 <a href="https://t.me/ILTradesbot">Посмотреть сделку</a>`;
  } else if (action === 'partial') {
    const closedPct = closeActionsData.reduce((s, a) => s + (a.pct || 0), 0);
    const remPct    = 100 - closedPct;
    const actualRR  = Math.abs(realizedPnl) > 0 && Math.abs(stopPnlLoss) > 0 ? Math.abs(realizedPnl) / Math.abs(stopPnlLoss) : 0;
    return `✂️ <strong>Обновление сделки</strong>

<strong>${trade.asset}</strong> ${sideIcon} ${side}

📅 Дата открытия: ${dateStr.split('-').reverse().join('.')} ${timeStr}
📍 Вход: ${trade.entry?.toLocaleString() || '—'} · 🛑 Стоп: ${trade.stop?.toLocaleString() || '—'}

${actionHistory ? `📋 <strong>История закрытий:</strong>${actionHistory}` : ''}

📊 Закрыто: <strong>${closedPct.toFixed(0)}%</strong> · Остаток: <strong>${remPct.toFixed(0)}%</strong>
💰 P&L: <strong style="color:${realizedPnl >= 0 ? 'var(--green)' : 'var(--red)'};">${realizedPnl >= 0 ? '+' : ''}${fmt(realizedPnl)}</strong>
📊 Факт. RR: <strong>${actualRR > 0 ? '1:' + actualRR.toFixed(2) : '—'}</strong>

🔗 <a href="https://t.me/ILTradesbot">Посмотреть сделку</a>`;
  } else if (action === 'close') {
    const result    = trade.result || 'unknown';
    const rIcon     = result === 'win' ? '✅' : result === 'loss' ? '❌' : '➖';
    const rText     = result === 'win' ? 'Профит' : result === 'loss' ? 'Убыток' : 'Безубыток';
    const finalPnl  = trade.pnl || 0;
    const closeDate = trade.closeDate || dateStr;
    const closeTime = trade.closeTime || timeStr;
    const actualRR  = Math.abs(realizedPnl) > 0 && Math.abs(stopPnlLoss) > 0 ? Math.abs(realizedPnl) / Math.abs(stopPnlLoss) : 0;
    return `🏁 <strong>Сделка закрыта</strong> ${rIcon}

<strong>${trade.asset}</strong> ${sideIcon} ${side}

📅 Открыта: ${dateStr.split('-').reverse().join('.')} ${timeStr}
📅 Закрыта: ${closeDate.split('-').reverse().join('.')} ${closeTime}
📍 Вход: ${trade.entry?.toLocaleString() || '—'} · 🛑 Стоп: ${trade.stop?.toLocaleString() || '—'}

${actionHistory ? `📋 <strong>История закрытий:</strong>${actionHistory}` : ''}

📊 Результат: <strong>${rText}</strong>
💰 Итоговый P&L: <strong style="color:${finalPnl >= 0 ? 'var(--green)' : 'var(--red)'};">${finalPnl >= 0 ? '+' : ''}${fmt(finalPnl)}</strong>
📊 Плановый RR: <strong>${plannedRR > 0 ? '1:' + plannedRR.toFixed(2) : '—'}</strong>
📊 Фактический RR: <strong>${actualRR > 0 ? '1:' + actualRR.toFixed(2) : '—'}</strong>

${trade.strategy ? `📐 Стратегия: ${trade.strategy}` : ''}

🔗 <a href="https://t.me/ILTradesbot">Посмотреть сделку</a>`;
  }
  return '';
}

export function shareTradeFromOwnName(tradeId) {
  if (String(tradeId).startsWith('open-')) {
    const id = parseInt(String(tradeId).replace('open-', ''));
    const t  = _state.trades[id];
    if (!t) return;
    postToChannel(t, 'open').then(() => showToast('📤 Сделка отправлена в канал!'));
  } else {
    const t = _state.trades[tradeId];
    if (!t) return;
    postToChannel(t, t.status === 'open' ? 'open' : 'close').then(() => showToast('📤 Сделка отправлена в канал!'));
  }
}

// ─────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────
function _bindExport() {
  document.getElementById('export-csv-btn')?.addEventListener('click', () => exportTrades('csv'));
  document.getElementById('export-xls-btn')?.addEventListener('click', () => exportTrades('xls'));
}

function exportTrades(format) {
  const from = document.getElementById('export-from')?.value || '';
  const to   = document.getElementById('export-to')?.value   || '';

  const { headers, rows, count } = buildExportData(_state.trades, from, to);
  if (!count) { alert('Нет сделок за выбранный период'); return; }

  if (format === 'csv') {
    const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n');
    _downloadBlob(new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' }), `il-trade-${from || 'all'}-${to || 'all'}.csv`);
  } else {
    const xlsContent = [headers, ...rows].map(r => r.join('\t')).join('\n');
    _downloadBlob(new Blob([xlsContent], { type: 'application/vnd.ms-excel' }), `il-trade-${from || 'all'}-${to || 'all'}.xls`);
  }
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────
// LIVE section
// ─────────────────────────────────────────────────────────────────
function _bindLiveSection() {
  // Platform tabs
  document.querySelectorAll('.live-platform-tab[data-live-tab]').forEach(btn => {
    btn.addEventListener('click', () => _switchLivePlatformTab(btn.dataset.liveTab, btn));
  });
  // Stream filters
  document.querySelectorAll('.live-filter-btn[data-stream-filter]').forEach(btn => {
    btn.addEventListener('click', () => _setStreamFilter(btn.dataset.streamFilter, btn));
  });
  // Access request modal
  document.getElementById('open-live-request-btn')?.addEventListener('click', openLiveRequestModal);
  document.getElementById('close-live-request-modal-btn')?.addEventListener('click', closeLiveRequestModal);
  document.getElementById('submit-live-request-btn')?.addEventListener('click', submitLiveRequest);
  // Role/viewshow in request modal
  document.querySelectorAll('.live-role-btn[data-role]').forEach(btn => {
    btn.addEventListener('click', () => _selectLiveRole(btn.dataset.role));
  });
  document.querySelectorAll('.live-vs-btn[data-vs]').forEach(btn => {
    btn.addEventListener('click', () => _selectLiveViewShow(btn.dataset.vs));
  });
  // Admin modal buttons
  document.getElementById('approve-live-user-btn')?.addEventListener('click', approveLiveUser);
  document.getElementById('extend-live-access-btn')?.addEventListener('click', extendLiveAccess);
  document.getElementById('block-live-user-btn')?.addEventListener('click',   blockLiveUser);
  document.getElementById('close-live-admin-modal-btn')?.addEventListener('click', closeLiveAdminModal);
  // Admin role buttons
  document.querySelectorAll('.live-role-btn[data-admin-role]').forEach(btn => {
    btn.addEventListener('click', () => _setAdminRole(btn.dataset.adminRole));
  });
  // Admin nav
  document.querySelectorAll('.live-admin-nav-btn[data-admin-section]').forEach(btn => {
    btn.addEventListener('click', () => _switchAdminSection(btn.dataset.adminSection, btn));
  });
  // Trader controls
  document.getElementById('live-stream-btn')?.addEventListener('click',   _toggleLiveStream);
  document.getElementById('live-mic-btn')?.addEventListener('click',      _toggleMic);
  document.getElementById('live-schedule-btn')?.addEventListener('click', _openScheduleModal);
  document.getElementById('live-stats-btn')?.addEventListener('click',    () => showToast('📊 Статистика: Скоро...'));
  document.getElementById('live-help-btn')?.addEventListener('click',     () => showToast('❓ LIVE — демонстрация экрана и комментарии трейдеров'));
  // Overlay close
  document.querySelectorAll('.live-modal-overlay').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
  });
}

const ADMIN_ID = 2082376478;
let _selectedLiveRole     = 'viewer';
let _selectedLiveViewShow = 'watch';
let _selectedAdminUserId  = null;
let _selectedAdminRole    = 'viewer';
let _liveStreamActive     = false;
let _liveMicActive        = true;

export function initLiveTab() {
  const tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (tgId == ADMIN_ID) {
    _showLiveAdminPanel();
    return;
  }
  _checkLiveAccess();
}

function _switchLivePlatformTab(section, btn) {
  document.getElementById('live-streams-section').style.display  = 'none';
  document.getElementById('live-profiles-section').style.display = 'none';
  document.getElementById('live-archive-section').style.display  = 'none';
  document.querySelectorAll('.live-platform-tab').forEach(t => t.classList.remove('active'));

  const map = { streams: 'live-streams-section', profiles: 'live-profiles-section', archive: 'live-archive-section' };
  const el  = document.getElementById(map[section]);
  if (el) el.style.display = 'flex';
  btn?.classList.add('active');

  if (section === 'profiles') _loadLiveProfiles();
  else if (section === 'archive') _loadArchive();
  else _loadLiveTraders();
}

function _setStreamFilter(filter, btn) {
  _state.currentStreamFilter = filter;
  document.querySelectorAll('.live-filter-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  _loadLiveTraders();
}

function openLiveRequestModal() {
  const modal = document.getElementById('live-request-modal');
  modal?.classList.add('open');
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (tgUser) {
    const nn = document.getElementById('live-req-nickname');
    const id = document.getElementById('live-req-id');
    if (nn) nn.value = tgUser.username ? '@' + tgUser.username : '';
    if (id) id.value = tgUser.id || '';
  }
}

function closeLiveRequestModal() {
  document.getElementById('live-request-modal')?.classList.remove('open');
}

function _selectLiveRole(role) {
  _selectedLiveRole = role;
  document.getElementById('live-role-viewer')?.classList.toggle('active', role === 'viewer');
  document.getElementById('live-role-trader')?.classList.toggle('active', role === 'trader');
}

function _selectLiveViewShow(vs) {
  _selectedLiveViewShow = vs;
  document.getElementById('live-vs-watch')?.classList.toggle('active', vs === 'watch');
  document.getElementById('live-vs-show')?.classList.toggle('active',  vs === 'show');
}

async function submitLiveRequest() {
  const nickname   = document.getElementById('live-req-nickname')?.value.trim();
  const telegramId = document.getElementById('live-req-id')?.value.trim();
  if (!telegramId) { showToast('⚠️ Укажите Telegram ID'); return; }
  try {
    await _db.ref(`liveRequests/${ADMIN_ID}/${telegramId}`).set({
      telegramId, nickname: nickname || '',
      role: _selectedLiveRole, viewShow: _selectedLiveViewShow,
      createdAt: new Date().toISOString()
    });
    closeLiveRequestModal();
    showToast('✅ Заявка отправлена! Ожидайте одобрения.');
  } catch (e) { showToast('⚠️ Ошибка отправки заявки'); }
}

function _openLiveAdminModal(userId, nickname, role) {
  _selectedAdminUserId = userId;
  _selectedAdminRole   = role;
  const info = document.getElementById('live-admin-user-info');
  if (info) info.innerHTML = `
    <div style="font-size:14px;margin-bottom:12px;">
      <strong>${nickname || '@unknown'}</strong><br>
      <span style="color:#888;">Telegram ID: ${userId}</span>
    </div>`;
  document.getElementById('admin-role-viewer')?.classList.toggle('active', role === 'viewer');
  document.getElementById('admin-role-trader')?.classList.toggle('active', role === 'trader');
  document.getElementById('live-admin-modal')?.classList.add('open');
}

function closeLiveAdminModal() {
  document.getElementById('live-admin-modal')?.classList.remove('open');
  _selectedAdminUserId = null;
}

function _setAdminRole(role) {
  _selectedAdminRole = role;
  document.getElementById('admin-role-viewer')?.classList.toggle('active', role === 'viewer');
  document.getElementById('admin-role-trader')?.classList.toggle('active', role === 'trader');
}

async function approveLiveUser() {
  if (!_selectedAdminUserId) return;
  const days = parseInt(document.getElementById('admin-access-days')?.value) || 1;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  try {
    const reqSnap = await _db.ref(`liveRequests/${ADMIN_ID}/${_selectedAdminUserId}`).once('value');
    const request = reqSnap.val() || {};
    await _db.ref(`liveWhitelist/${ADMIN_ID}/${_selectedAdminUserId}`).set({
      telegramId: _selectedAdminUserId, nickname: request.nickname || '',
      role: _selectedAdminRole, viewShow: request.viewShow || 'watch',
      expiresAt: expiresAt.toISOString(), approvedAt: new Date().toISOString()
    });
    await _db.ref(`liveRequests/${ADMIN_ID}/${_selectedAdminUserId}`).remove();
    closeLiveAdminModal();
    _loadLiveAdminData();
    showToast(`✅ Доступ одобрен на ${days} дн.`);
  } catch (e) { showToast('⚠️ Ошибка одобрения'); }
}

async function extendLiveAccess() {
  if (!_selectedAdminUserId) return;
  const days = parseInt(document.getElementById('admin-access-days')?.value) || 1;
  try {
    const snap  = await _db.ref(`liveWhitelist/${ADMIN_ID}/${_selectedAdminUserId}`).once('value');
    const entry = snap.val();
    if (entry) {
      const cur = entry.expiresAt ? new Date(entry.expiresAt) : new Date();
      cur.setDate(cur.getDate() + days);
      entry.expiresAt = cur.toISOString();
      await _db.ref(`liveWhitelist/${ADMIN_ID}/${_selectedAdminUserId}`).set(entry);
      closeLiveAdminModal();
      _loadLiveAdminData();
      showToast(`⏰ Доступ продлён на ${days} дн.`);
    }
  } catch (e) { showToast('⚠️ Ошибка продления'); }
}

async function blockLiveUser() {
  if (!_selectedAdminUserId) return;
  if (!confirm('Заблокировать доступ?')) return;
  try {
    await _db.ref(`liveWhitelist/${ADMIN_ID}/${_selectedAdminUserId}`).remove();
    closeLiveAdminModal();
    _loadLiveAdminData();
    showToast('🚫 Пользователь заблокирован');
  } catch (e) { showToast('⚠️ Ошибка блокировки'); }
}

async function _checkLiveAccess() {
  if (!_state.uid) return;
  try {
    const snap      = await _db.ref(`liveWhitelist/${ADMIN_ID}`).once('value');
    const whitelist = snap.val() || {};
    const userId    = String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || '');
    const entry     = Object.values(whitelist).find(w => String(w.telegramId) === userId);

    const denied  = document.getElementById('live-access-denied');
    const content = document.getElementById('live-content');

    if (entry) {
      const expiry = entry.expiresAt ? new Date(entry.expiresAt) : null;
      if (expiry && expiry < new Date()) {
        if (denied)  denied.style.display  = 'block';
        if (content) content.style.display = 'none';
        showToast('⏰ Срок доступа истёк');
      } else {
        if (denied)  denied.style.display  = 'none';
        if (content) content.style.display = 'block';
        S('live-user-role',    entry.role === 'trader' ? '📹 Трейдер' : '👁 Зритель');
        S('live-user-expires', 'Доступ истекает: ' + (expiry ? expiry.toLocaleDateString('ru-RU') : '∞'));
        const roleEl = document.getElementById('live-user-role');
        if (roleEl) roleEl.style.color = entry.role === 'trader' ? 'var(--green)' : 'var(--blue)';

        const vs = document.getElementById('live-viewer-section');
        const ts = document.getElementById('live-trader-section');
        if (entry.role === 'trader') { if (vs) vs.style.display = 'none'; if (ts) ts.style.display = 'block'; }
        else { if (vs) vs.style.display = 'block'; if (ts) ts.style.display = 'none'; }

        _loadLiveTraders();
      }
    } else {
      if (denied)  denied.style.display  = 'block';
      if (content) content.style.display = 'none';
    }
  } catch (e) {
    console.error('[checkLiveAccess]', e);
    document.getElementById('live-access-denied').style.display = 'block';
    document.getElementById('live-content').style.display       = 'none';
  }
}

function _showLiveAdminPanel() {
  document.getElementById('live-access-denied').style.display = 'none';
  document.getElementById('live-content').style.display       = 'none';
  document.getElementById('live-admin-panel').style.display   = 'block';
  _loadLiveAdminData();
}

async function _loadLiveAdminData() {
  if (!_state.uid) return;
  try {
    const reqSnap = await _db.ref(`liveRequests/${ADMIN_ID}`).once('value');
    _state.livePendingRequests = Object.values(reqSnap.val() || {});
    const wlSnap = await _db.ref(`liveWhitelist/${ADMIN_ID}`).once('value');
    _state.liveWhitelist = Object.values(wlSnap.val() || {});
    renderLiveRequests(_state.livePendingRequests);
    renderLiveWhitelist(_state.liveWhitelist);
  } catch (e) { console.error('[loadLiveAdminData]', e); }
}

function _switchAdminSection(section, btn) {
  ['requests','users','streams','archive'].forEach(s => {
    const el = document.getElementById('admin-section-' + s);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.live-admin-nav-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('admin-section-' + section);
  if (el) el.style.display = 'block';
  btn?.classList.add('active');
  if (section === 'streams') _loadAdminStreams();
  else if (section === 'archive') _loadAdminArchive();
}

async function _loadAdminStreams() {
  const list = document.getElementById('admin-streams-list');
  if (!list) return;
  try {
    const snap    = await _db.ref('liveStreams').once('value');
    const streams = snap.val() ? Object.values(snap.val()) : [];
    if (!streams.length) { list.innerHTML = '<div class="live-empty">Нет активных трансляций</div>'; return; }
    list.innerHTML = streams.map(s => `
      <div class="admin-stream-card">
        <div class="admin-stream-info">
          <div class="admin-stream-trader">${s.traderName || 'Неизвестный'}</div>
          <div class="admin-stream-meta">👁 ${s.viewers || 0} зрителей</div>
        </div>
        <div class="admin-stream-actions">
          <button class="btn-admin-action" data-admin-stop-stream="${s.id}">⏹</button>
          <button class="btn-admin-action" data-admin-delete-stream="${s.id}">🗑</button>
        </div>
      </div>`).join('');
  } catch (e) { list.innerHTML = '<div class="live-empty">Ошибка загрузки</div>'; }
}

async function _loadAdminArchive() {
  const list = document.getElementById('admin-archive-list');
  if (!list) return;
  try {
    const snap     = await _db.ref('liveArchive').once('value');
    const archives = snap.val() ? Object.values(snap.val()) : [];
    if (!archives.length) { list.innerHTML = '<div class="live-empty">Записей нет</div>'; return; }
    list.innerHTML = archives.map(a => `
      <div class="admin-stream-card">
        <div class="admin-stream-info">
          <div class="admin-stream-trader">${a.title || 'Запись'}</div>
          <div class="admin-stream-meta">📹 ${a.traderName || '—'} · ${a.views || 0} просмотров</div>
        </div>
        <div class="admin-stream-actions">
          <button class="btn-admin-action" data-admin-delete-archive="${a.id}">🗑</button>
        </div>
      </div>`).join('');
  } catch (e) { list.innerHTML = '<div class="live-empty">Ошибка загрузки</div>'; }
}

async function _loadLiveTraders() {
  const list = document.getElementById('live-traders-list');
  if (!list) return;
  try {
    const streamsSnap   = await _db.ref('liveStreams').once('value');
    const scheduledSnap = await _db.ref('scheduledStreams').once('value');
    let streams   = streamsSnap.val()   ? Object.values(streamsSnap.val())   : [];
    let scheduled = scheduledSnap.val() ? Object.values(scheduledSnap.val()) : [];

    const filter = _state.currentStreamFilter || 'live';
    let filteredStreams   = filter === 'all' || filter === 'live' ? streams.filter(s => s.status === 'live') : [];
    let filteredScheduled = filter === 'all' || filter === 'scheduled' ? scheduled : [];

    if (!filteredStreams.length && !filteredScheduled.length) {
      list.innerHTML = '<div class="live-empty">Пока нет трансляций</div>';
      return;
    }

    let html = filteredStreams.map(s => `
      <div class="live-trader-card" data-join-stream="${s.id}">
        <div class="live-trader-avatar">${s.avatar || '📹'}</div>
        <div class="live-trader-info">
          <div class="live-trader-name">${s.traderName || 'Неизвестный'}</div>
          <div class="live-trader-status">🔴 Идёт трансляция</div>
        </div>
        <div class="live-trader-viewers"><span>👁</span><span>${s.viewers || 0}</span></div>
      </div>`).join('');

    html += filteredScheduled.map(s => {
      const d = s.scheduledAt ? new Date(s.scheduledAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Не указано';
      return `
      <div class="live-trader-card" data-show-scheduled="${s.id}">
        <div class="live-trader-avatar">📅</div>
        <div class="live-trader-info">
          <div class="live-trader-name">${s.traderName || 'Неизвестный'}</div>
          <div class="live-trader-status">Запланировано: ${d}</div>
        </div>
        <div class="live-trader-viewers"><span>🔔</span><span>${s.subscribers || 0}</span></div>
      </div>`;
    }).join('');

    list.innerHTML = html;
  } catch (e) {
    console.error('[loadLiveTraders]', e);
    list.innerHTML = '<div class="live-empty">Ошибка загрузки</div>';
  }
}

async function _loadLiveProfiles() {
  const list = document.getElementById('live-profiles-list');
  if (!list) return;
  try {
    const snap     = await _db.ref('liveProfiles').once('value');
    const profiles = snap.val() ? Object.values(snap.val()) : [];
    if (!profiles.length) { list.innerHTML = '<div class="live-empty">Профилей пока нет</div>'; return; }
    list.innerHTML = profiles.map(p => `
      <div class="live-profile-card" data-view-profile="${p.id}">
        <div class="live-profile-header">
          <div class="live-profile-avatar">${p.avatar || '👤'}</div>
          <div class="live-profile-info">
            <div class="live-profile-name">${p.name || 'Трейдер'}</div>
            <div class="live-profile-role">${p.role === 'trader' ? '📹 Трейдер' : '👁 Зритель'}</div>
          </div>
        </div>
        <div class="live-profile-stats">
          <div class="live-profile-stat"><span class="live-profile-stat-val">${p.streams || 0}</span><span>Эфиров</span></div>
          <div class="live-profile-stat"><span class="live-profile-stat-val">${p.followers || 0}</span><span>Подписчиков</span></div>
          <div class="live-profile-stat"><span class="live-profile-stat-val" style="color:${(p.winRate || 0) >= 50 ? 'var(--green)' : 'var(--red)'}">${p.winRate || 0}%</span><span>Винрейт</span></div>
        </div>
      </div>`).join('');
  } catch (e) { list.innerHTML = '<div class="live-empty">Ошибка загрузки профилей</div>'; }
}

async function _loadArchive() {
  const list = document.getElementById('live-archive-list');
  if (!list) return;
  try {
    const snap     = await _db.ref('liveArchive').orderByChild('createdAt').limitToLast(50).once('value');
    const archives = snap.val() ? Object.values(snap.val()).reverse() : [];
    if (!archives.length) { list.innerHTML = '<div class="live-empty">Записей пока нет</div>'; return; }
    list.innerHTML = archives.map(a => {
      const dur  = a.duration ? _formatDuration(a.duration) : '—';
      const date = a.createdAt ? new Date(a.createdAt).toLocaleDateString('ru-RU') : '—';
      return `
        <div class="live-archive-card" data-watch-archive="${a.id}">
          <div class="live-archive-header">
            <div class="live-archive-title">${a.title || 'Запись эфира'}</div>
            <div class="live-archive-date">${date}</div>
          </div>
          <div class="live-archive-meta">
            <div class="live-archive-duration">⏱ ${dur}</div>
            <div class="live-archive-views">👁 ${a.views || 0}</div>
          </div>
        </div>`;
    }).join('');
  } catch (e) { list.innerHTML = '<div class="live-empty">Ошибка загрузки архива</div>'; }
}

function _formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

function _toggleLiveStream() {
  _liveStreamActive = !_liveStreamActive;
  const btn     = document.getElementById('live-stream-btn');
  const preview = document.getElementById('live-stream-preview');
  if (btn) {
    btn.textContent = _liveStreamActive ? '⏹ Остановить трансляцию' : '📹 Начать трансляцию';
    btn.classList.toggle('active', _liveStreamActive);
  }
  if (preview) {
    preview.innerHTML = _liveStreamActive
      ? '<div style="color:var(--red);font-size:14px;">🔴 ИДЁТ ТРАНСЛЯЦИЯ</div>'
      : '<div class="live-preview-placeholder">Предпросмотр трансляции</div>';
  }
}

function _toggleMic() {
  _liveMicActive = !_liveMicActive;
  const btn = document.getElementById('live-mic-btn');
  if (btn) {
    btn.textContent = _liveMicActive ? '🎤 Микрофон: Вкл' : '🔇 Микрофон: Выкл';
    btn.classList.toggle('muted', !_liveMicActive);
  }
}

function _openScheduleModal() {
  const modal = document.createElement('div');
  modal.id        = 'schedule-modal';
  modal.className = 'live-modal-overlay open';
  modal.innerHTML = `
    <div class="live-modal">
      <div class="live-modal-title">📅 Запланировать эфир</div>
      <div class="live-form-group"><label>Дата и время</label><input type="datetime-local" id="schedule-datetime"></div>
      <div class="live-form-group"><label>Название эфира</label><input id="schedule-title" placeholder="Тематика трансляции"></div>
      <div class="live-form-group"><label>Описание</label><textarea id="schedule-desc" placeholder="О чём будет эфир"></textarea></div>
      <button id="save-schedule-btn" class="btn-live-submit">💾 Сохранить</button>
      <button id="close-schedule-btn" class="btn-live-cancel">Отмена</button>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
  document.getElementById('save-schedule-btn')?.addEventListener('click',  _saveSchedule);
  document.getElementById('close-schedule-btn')?.addEventListener('click', () => modal.remove());
}

async function _saveSchedule() {
  if (!_state.uid) return;
  const datetime = document.getElementById('schedule-datetime')?.value;
  const title    = document.getElementById('schedule-title')?.value.trim();
  const desc     = document.getElementById('schedule-desc')?.value.trim();
  if (!datetime) { showToast('⚠️ Укажите дату и время'); return; }
  try {
    const scheduleId = Date.now();
    const tgUser     = window.Telegram?.WebApp?.initDataUnsafe?.user;
    await _db.ref('scheduledStreams/' + scheduleId).set({
      id: scheduleId,
      traderId:    String(tgUser?.id || ''),
      traderName:  tgUser?.username ? '@' + tgUser.username : tgUser?.first_name || 'Неизвестный',
      scheduledAt: new Date(datetime).toISOString(),
      title:       title || 'Трансляция',
      description: desc,
      createdAt:   new Date().toISOString(),
      status:      'scheduled'
    });
    document.getElementById('schedule-modal')?.remove();
    showToast('✅ Эфир запланирован!');
    _loadLiveTraders();
  } catch (e) { showToast('⚠️ Ошибка сохранения'); }
}

// ─────────────────────────────────────────────────────────────────
// Global event delegation (для динамически рендеримых элементов)
// ─────────────────────────────────────────────────────────────────
function _bindGlobalDelegation() {
  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-edit-trade]');
    if (t) { editTrade(+t.dataset.editTrade); return; }

    const d = e.target.closest('[data-delete-trade]');
    if (d) { await deleteTrade(+d.dataset.deleteTrade); return; }

    const s = e.target.closest('[data-share-trade]');
    if (s) { shareTradeFromOwnName(s.dataset.shareTrade); return; }

    const om = e.target.closest('[data-open-close-modal]');
    if (om) { openCloseModal(+om.dataset.openCloseModal); return; }

    const lb = e.target.closest('[data-lightbox]');
    if (lb) { _openLightbox(lb.dataset.lightbox); return; }

    const ri = e.target.closest('[data-remove-img]');
    if (ri) { _state.pendingImages.splice(+ri.dataset.removeImg, 1); renderImgPreview(_state.pendingImages); return; }

    const ra = e.target.closest('[data-remove-action]');
    if (ra) { _state.closeActions.splice(+ra.dataset.removeAction, 1); renderCloseHistory(_state.closeActions, _state.trades[_state.closingTradeId]); await _savePartialState(); return; }

    const td = e.target.closest('[data-toggle-day]');
    if (td) { document.getElementById('dr-' + td.dataset.toggleDay)?.classList.toggle('open'); return; }

    // LIVE delegations
    const js = e.target.closest('[data-join-stream]');
    if (js) { _joinStream(js.dataset.joinStream); return; }

    const ss = e.target.closest('[data-show-scheduled]');
    if (ss) { _showScheduledInfo(ss.dataset.showScheduled); return; }

    const vp = e.target.closest('[data-view-profile]');
    if (vp) { showToast('👤 Профиль трейдера: Скоро...'); return; }

    const wa = e.target.closest('[data-watch-archive]');
    if (wa) { _watchArchive(wa.dataset.watchArchive); return; }

    const lam = e.target.closest('[data-live-admin-modal]');
    if (lam) { _openLiveAdminModal(lam.dataset.liveAdminModal, lam.dataset.nickname, lam.dataset.role); return; }

    const aStop = e.target.closest('[data-admin-stop-stream]');
    if (aStop) { await _adminStopStream(aStop.dataset.adminStopStream); return; }

    const aDel = e.target.closest('[data-admin-delete-stream]');
    if (aDel) { await _adminDeleteStream(aDel.dataset.adminDeleteStream); return; }

    const aDelA = e.target.closest('[data-admin-delete-archive]');
    if (aDelA) { await _adminDeleteArchive(aDelA.dataset.adminDeleteArchive); return; }

    // Lightbox close
    if (e.target.id === 'lightbox') { _closeLightbox(); return; }
  });
}

function _openLightbox(src) {
  const lb  = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  if (!lb || !img) return;
  img.src = src;
  lb.classList.add('open');
}

function _closeLightbox() {
  document.getElementById('lightbox')?.classList.remove('open');
}

async function _joinStream(streamId) {
  const snap   = await _db.ref('liveStreams/' + streamId).once('value');
  const stream = snap.val();
  if (stream?.inviteLink) {
    if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(stream.inviteLink);
    else window.open(stream.inviteLink, '_blank');
  } else {
    showToast('🔗 Ссылка на трансляцию скоро будет доступна');
  }
}

async function _showScheduledInfo(streamId) {
  const snap   = await _db.ref('scheduledStreams/' + streamId).once('value');
  const stream = snap.val();
  if (stream) showToast(`📅 Эфир запланирован на ${new Date(stream.scheduledAt).toLocaleString('ru-RU')}`);
}

async function _watchArchive(archiveId) {
  const snap    = await _db.ref('liveArchive/' + archiveId).once('value');
  const archive = snap.val();
  if (archive?.videoUrl) {
    if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(archive.videoUrl);
    else window.open(archive.videoUrl, '_blank');
  } else {
    showToast('📼 Видеозапись скоро будет доступна');
  }
}

async function _adminStopStream(streamId) {
  if (!confirm('Принудительно остановить трансляцию?')) return;
  try {
    await _db.ref('liveStreams/' + streamId).update({ status: 'stopped', endedAt: new Date().toISOString() });
    showToast('⏹ Трансляция остановлена');
    _loadAdminStreams();
  } catch (e) { showToast('⚠️ Ошибка'); }
}

async function _adminDeleteStream(streamId) {
  if (!confirm('Удалить трансляцию?')) return;
  try {
    await _db.ref('liveStreams/' + streamId).remove();
    showToast('🗑 Трансляция удалена');
    _loadAdminStreams();
  } catch (e) { showToast('⚠️ Ошибка'); }
}

async function _adminDeleteArchive(archiveId) {
  if (!confirm('Удалить запись?')) return;
  try {
    await _db.ref('liveArchive/' + archiveId).remove();
    showToast('🗑 Запись удалена');
    _loadAdminArchive();
  } catch (e) { showToast('⚠️ Ошибка'); }
}

// ─────────────────────────────────────────────────────────────────
// User settings loader
// ─────────────────────────────────────────────────────────────────
export async function loadUserSettings(db, uid) {
  const snap = await db.ref(`settings/${uid}`).once('value');
  const data = snap.val();
  if (data) {
    if (data.deposit)     { const el = document.getElementById('deposit');     if (el) el.value = data.deposit; }
    if (data.riskPercent) { const el = document.getElementById('riskPercent'); if (el) el.value = data.riskPercent; }
    if (data.leverage)    setLev(data.leverage);
    _triggerLiveCalc();
  }
}
