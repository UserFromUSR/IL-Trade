// src/api/mexc-ws.js
// Изолированный класс WebSocket для MEXC с логикой реконнекта

const MEXC_WS_URL           = 'wss://wbs.mexc.com/ws';
const MEXC_WS_PING_INTERVAL = 20000;

export class MexcWebSocket {
  constructor({ onPriceUpdate } = {}) {
    this._ws            = null;
    this._prices        = {};
    this._subscriptions = [];
    this._pingTimer     = null;
    this._reconnecting  = false;
    this._onPriceUpdate = onPriceUpdate || (() => {});
  }

  // Публичный геттер цен
  get prices() {
    return this._prices;
  }

  getPrice(asset) {
    const base = this._normalizeBase(asset);
    return this._prices[base]?.price || null;
  }

  getPriceData(asset) {
    const base = this._normalizeBase(asset);
    return this._prices[base] || null;
  }

  // Подключить WebSocket
  connect() {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) return;

    try {
      this._ws = new WebSocket(MEXC_WS_URL);

      this._ws.onopen = () => {
        console.log('[MEXC WS] Connected');
        this._reconnecting = false;
        if (this._subscriptions.length > 0) {
          this._sendSubscriptions(this._subscriptions);
        }
        this._startPing();
      };

      this._ws.onmessage = (event) => {
        try {
          // ✅ ИСПРАВЛЕНО: MEXC может слать бинарный pong — игнорируем
          if (typeof event.data !== 'string') return;
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch (_) {
          // Ignore non-JSON
        }
      };

      this._ws.onerror = (error) => {
        console.error('[MEXC WS] Error:', error);
      };

      this._ws.onclose = () => {
        console.log('[MEXC WS] Disconnected, reconnecting in 3s...');
        this._ws = null;
        this._stopPing();
        if (!this._reconnecting) {
          this._reconnecting = true;
          setTimeout(() => this.connect(), 3000);
        }
      };
    } catch (e) {
      console.error('[MEXC WS] Init error:', e);
      setTimeout(() => this.connect(), 5000);
    }
  }

  // Подписаться на активы
  subscribe(assets) {
    if (!assets || assets.length === 0) return;

    // Сохраняем подписки (дедупликация)
    assets.forEach(a => {
      if (!this._subscriptions.includes(a)) {
        this._subscriptions.push(a);
      }
    });

    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      this.connect();
      return;
    }

    this._sendSubscriptions(assets);
  }

  // Отписаться от активов
  unsubscribe(assets) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;

    assets.forEach(asset => {
      const symbol = this._toSymbol(asset);
      const msg = {
        method: 'UNSUBSCRIPTION',
        // ✅ ИСПРАВЛЕНО: правильный формат топика
        params: [`spot@public.miniTickers.v3.api@${symbol}`]
      };
      this._ws.send(JSON.stringify(msg));
    });

    this._subscriptions = this._subscriptions.filter(a => !assets.includes(a));
  }

  // Рассчитать live PnL для открытой сделки
  calculateLivePnl(trade) {
    const currentPrice = this.getPrice(trade.asset);
    if (!currentPrice || !trade.entry) return null;

    const closeActions = trade.closeActions || [];
    const closedPct    = closeActions.reduce((sum, a) => sum + (a.pct || 0), 0);
    const remainingPct = 100 - closedPct;

    const riskUSD  = trade.riskUSD || (trade.deposit * (trade.riskPercent || 0) / 100);
    const leverage = trade.leverage || 1;
    const posSize  = riskUSD * leverage;

    let pnl = 0;
    if (trade.side === 'LONG') {
      pnl = (currentPrice - trade.entry) * posSize / trade.entry;
    } else {
      pnl = (trade.entry - currentPrice) * posSize / trade.entry;
    }

    pnl = pnl * (remainingPct / 100);

    const realizedPnl = closeActions.reduce((sum, a) => sum + (a.pnl || 0), 0);

    return {
      currentPrice,
      remainingPct,
      unrealizedPnl: pnl,
      realizedPnl,
      totalPnl:  pnl + realizedPnl,
      changePct: ((currentPrice - trade.entry) / trade.entry * 100) * (trade.side === 'SHORT' ? -1 : 1)
    };
  }

  // ─── Private ────────────────────────────────────────────────────

  // Нормализует любой формат актива → базовый тикер (BTC, ETH, ...)
  // Поддерживает: BTCUSDT, BTC/USDT, BTC/USDT:USDT, BTCUSDT/USDT.P, BTC_USDT, BTC
  _normalizeBase(asset) {
    return (asset || '')
      .replace('/USDT:USDT', '')  // BTC/USDT:USDT → BTC
      .replace('/USDT.P', '')     // BTCUSDT/USDT.P → BTCUSDT (затем следующая строка)
      .replace(/USDT$/, '')       // ✅ ИСПРАВЛЕНО: только суффикс, не середину строки
      .replace('/USDT', '')       // BTC/USDT → BTC
      .replace('_USDT', '')       // BTC_USDT → BTC
      .replace(/\/$/, '')         // BTC/ → BTC (остаток)
      .toUpperCase()
      .trim();
  }

  _toSymbol(asset) {
    return this._normalizeBase(asset) + '_USDT';
  }

  _sendSubscriptions(assets) {
    assets.forEach(asset => {
      const symbol = this._toSymbol(asset);
      // ✅ ИСПРАВЛЕНО: правильный топик MEXC WebSocket API v3
      const msg = {
        method: 'SUBSCRIPTION',
        params: [`spot@public.miniTickers.v3.api@${symbol}`]
      };
      this._ws.send(JSON.stringify(msg));
    });
  }

  _handleMessage(data) {
    // ✅ ИСПРАВЛЕНО: правильная проверка pong-ответа от MEXC
    if (data.msg === 'PONG' || data.id) return;

    // ✅ ИСПРАВЛЕНО: правильная структура данных MEXC WS v3
    // Ответ приходит в формате: { c: "spot@public.miniTickers.v3.api@BTC_USDT", d: { ... }, t: ... }
    if (data.d && data.c) {
      const ticker    = data.d;
      const symbol    = ticker.s || data.c.split('@').pop() || '';
      const baseAsset = this._normalizeBase(symbol);

      // ✅ ИСПРАВЛЕНО: правильные поля MEXC miniTicker v3
      // c = закрытие (текущая цена), h = high, l = low, v = volume, r = изменение %
      const priceRaw = ticker.c || ticker.p || ticker.lastPrice;

      if (baseAsset && priceRaw) {
        const price = parseFloat(priceRaw);
        if (!isNaN(price) && price > 0) {
          const prevPrice = this._prices[baseAsset]?.price || price;
          this._prices[baseAsset] = {
            price,
            timestamp:    Date.now(),
            high24h:      parseFloat(ticker.h)  || price,
            low24h:       parseFloat(ticker.l)  || price,
            volume24h:    parseFloat(ticker.v)  || 0,
            // ✅ ИСПРАВЛЕНО: r — процент изменения за 24ч в MEXC v3
            change24h:    price - prevPrice,
            changePct24h: parseFloat(ticker.r)  || 0
          };

          this._onPriceUpdate(baseAsset, this._prices[baseAsset]);
        }
      }
    }
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        // ✅ ИСПРАВЛЕНО: MEXC ожидает JSON ping, не строку
        this._ws.send(JSON.stringify({ method: 'PING' }));
      }
    }, MEXC_WS_PING_INTERVAL);
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }
}
