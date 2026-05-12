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
    const base = asset.replace('USDT', '').replace('_USDT', '');
    return this._prices[base]?.price || null;
  }

  getPriceData(asset) {
    const base = asset.replace('USDT', '').replace('_USDT', '');
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
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch (_) {
          // Ignore non-JSON (e.g. pong responses)
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
        method: 'UNSUBSCRIBE',
        params: [`spot@public.ticker.v3@${symbol}`],
        id: Date.now() + Math.random()
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

  _toSymbol(asset) {
    return asset.replace('USDT', '').replace('_USDT', '') + '_USDT';
  }

  _sendSubscriptions(assets) {
    assets.forEach(asset => {
      const symbol = this._toSymbol(asset);
      const msg = {
        method: 'SUBSCRIBE',
        params: [`spot@public.ticker.v3@${symbol}`],
        id: Date.now() + Math.random()
      };
      this._ws.send(JSON.stringify(msg));
    });
  }

  _handleMessage(data) {
    if (data.channel && data.channel.startsWith('sub')) {
      console.log('[MEXC WS] Subscribed to:', data.symbol);
      return;
    }

    if (data.data && data.data.length > 0) {
      const ticker    = data.data[0];
      const symbol    = ticker.symbol || data.symbol || '';
      const baseAsset = symbol.replace('USDT', '').replace('_USDT', '');

      if (baseAsset && ticker.last) {
        const price = parseFloat(ticker.last);
        if (!isNaN(price) && price > 0) {
          this._prices[baseAsset] = {
            price,
            timestamp:    Date.now(),
            high24h:      parseFloat(ticker.high)      || price,
            low24h:       parseFloat(ticker.low)       || price,
            volume24h:    parseFloat(ticker.volume)    || 0,
            change24h:    parseFloat(ticker.change)    || 0,
            changePct24h: parseFloat(ticker.changePct) || 0
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
        this._ws.send('ping');
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
