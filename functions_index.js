const functions  = require("firebase-functions");
const admin      = require("firebase-admin");
const crypto     = require("crypto");
const https      = require("https");

admin.initializeApp();
const db = admin.database();

// ── MEXC API helper ───────────────────────────────────────────────
const MEXC_BASE = "futures.mexc.com";

function mexcRequest(path, apiKey, apiSecret, params = {}) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const paramStr  = Object.entries({ ...params, timestamp })
      .map(([k, v]) => `${k}=${v}`)
      .join("&");

    const signature = crypto
      .createHmac("sha256", apiSecret)
      .update(apiKey + timestamp + paramStr)
      .digest("hex");

    const fullPath = `/api/v1${path}?${paramStr}&signature=${signature}`;

    const options = {
      hostname: MEXC_BASE,
      path:     fullPath,
      method:   "GET",
      headers:  {
        "ApiKey":       apiKey,
        "Request-Time": timestamp,
        "Signature":    signature,
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Invalid JSON: " + data)); }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

// ── Конвертация сделки MEXC → формат журнала ─────────────────────
function mexcOrderToTrade(order) {
  const side       = order.side === 1 ? "LONG" : "SHORT";   // 1=Open Long / 3=Open Short
  const isWin      = order.realised > 0;
  const result     = order.state === 3                       // 3=filled
    ? (order.realised > 0 ? "win" : order.realised < 0 ? "loss" : "be")
    : "";

  const entry      = parseFloat(order.dealAvgPrice || order.price || 0);
  const leverage   = parseFloat(order.leverage     || 1);
  const deposit    = parseFloat(order.margin       || 0);
  const posSize    = deposit * leverage;
  const pnl        = parseFloat(order.realised     || 0);

  // Дата
  const ts   = order.createTime || order.updateTime || Date.now();
  const date = new Date(ts);
  const dateStr = date.toISOString().slice(0, 10);
  const timeStr = date.toTimeString().slice(0, 5);

  return {
    id:           order.orderId || Date.now(),
    mexcOrderId:  order.orderId,
    date:         dateStr,
    time:         timeStr,
    side:         side,
    asset:        (order.symbol || "").replace("_USDT", "") + "USDT",
    deposit:      deposit,
    leverage:     leverage,
    riskPercent:  0,
    entry:        entry,
    stop:         parseFloat(order.stopLossPrice  || 0),
    tp1_price:    parseFloat(order.takeProfitPrice || 0),
    tp1_percent:  100,
    tp2_price:    0,
    tp2_percent:  0,
    bplus:        0,
    timeframe:    "",
    strategy:     "MEXC Auto",
    result:       result,
    emotion:      "",
    followedRM:   null,
    quality:      0,
    note:         `Авто-импорт с MEXC. Объём: ${posSize.toFixed(2)}$`,
    // расчётные поля
    positionFull: posSize,
    positionBase: deposit,
    riskUSD:      Math.abs(pnl < 0 ? pnl : deposit * 0.01),
    stopPct:      0,
    pnl:          pnl,
    pnl1:         pnl,
    pnl2:         0,
    pnl1Base:     pnl / leverage,
    pnl2Base:     0,
    pnlBase:      pnl / leverage,
    rr:           0,
    archived:     false,
    fromMexc:     true,
  };
}

// ════════════════════════════════════════════════════════════════
// HTTPS Function: синхронизация по запросу пользователя
// POST https://<region>-<project>.cloudfunctions.net/syncMexc
// Body: { uid, apiKey, apiSecret, limit }
// ════════════════════════════════════════════════════════════════
exports.syncMexc = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {

    // CORS
    res.set("Access-Control-Allow-Origin",  "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST")   { res.status(405).send("Method Not Allowed"); return; }

    const { uid, apiKey, apiSecret, limit = 50 } = req.body;

    if (!uid || !apiKey || !apiSecret) {
      res.status(400).json({ error: "uid, apiKey и apiSecret обязательны" });
      return;
    }

    try {
      // Получаем историю ордеров с MEXC Futures
      const data = await mexcRequest(
        "/private/order/history/list",
        apiKey,
        apiSecret,
        { pageSize: limit, pageNum: 1 }
      );

      if (!data || data.code !== 200) {
        res.status(400).json({ error: "MEXC API error", details: data });
        return;
      }

      const orders       = data.data?.resultList || [];
      const tradesRef    = db.ref(`trades/${uid}`);
      const existingSnap = await tradesRef.once("value");
      const existing     = existingSnap.val() || {};

      // Уже импортированные MEXC ID
      const existingMexcIds = new Set(
        Object.values(existing)
          .filter(t => t.mexcOrderId)
          .map(t => String(t.mexcOrderId))
      );

      let added = 0;
      const updates = {};

      for (const order of orders) {
        if (existingMexcIds.has(String(order.orderId))) continue;
        // Только закрытые сделки (state=3 filled, state=4 cancelled — пропускаем)
        if (order.state !== 3) continue;

        const trade = mexcOrderToTrade(order);
        updates[String(trade.id)] = trade;
        added++;
      }

      if (added > 0) await tradesRef.update(updates);

      // Уведомление пользователю
      if (added > 0) {
        await db.ref(`notifications/${uid}`).push({
          id:    Date.now(),
          icon:  "📡",
          title: `MEXC: импортировано ${added} сделок`,
          desc:  "Новые сделки добавлены в журнал",
          time:  new Date().toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }),
          read:  false,
        });
      }

      res.json({ success: true, imported: added, total: orders.length });

    } catch (err) {
      console.error("syncMexc error:", err);
      res.status(500).json({ error: err.message });
    }
  });


// ════════════════════════════════════════════════════════════════
// Scheduled Function: авто-синхронизация каждые 30 минут
// Для каждого пользователя у кого сохранены ключи MEXC
// ════════════════════════════════════════════════════════════════
exports.autoSyncMexc = functions
  .region("europe-west1")
  .pubsub.schedule("every 30 minutes")
  .onRun(async () => {

    const usersSnap = await db.ref("users").once("value");
    const users     = usersSnap.val() || {};

    for (const [uid, userData] of Object.entries(users)) {
      const apiKey    = userData.mexcApiKey;
      const apiSecret = userData.mexcApiSecret;

      if (!apiKey || !apiSecret) continue;

      try {
        const data = await mexcRequest(
          "/private/order/history/list",
          apiKey,
          apiSecret,
          { pageSize: 20, pageNum: 1 }
        );

        if (!data || data.code !== 200) continue;

        const orders       = data.data?.resultList || [];
        const tradesRef    = db.ref(`trades/${uid}`);
        const existingSnap = await tradesRef.once("value");
        const existing     = existingSnap.val() || {};

        const existingMexcIds = new Set(
          Object.values(existing)
            .filter(t => t.mexcOrderId)
            .map(t => String(t.mexcOrderId))
        );

        let added = 0;
        const updates = {};

        for (const order of orders) {
          if (existingMexcIds.has(String(order.orderId))) continue;
          if (order.state !== 3) continue;

          const trade = mexcOrderToTrade(order);
          updates[String(trade.id)] = trade;
          added++;
        }

        if (added > 0) {
          await tradesRef.update(updates);
          await db.ref(`notifications/${uid}`).push({
            id:    Date.now(),
            icon:  "🔄",
            title: `Авто-синхронизация MEXC: +${added}`,
            desc:  "Новые закрытые позиции добавлены",
            time:  new Date().toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }),
            read:  false,
          });
          console.log(`uid=${uid}: добавлено ${added} сделок`);
        }

      } catch (err) {
        console.error(`Ошибка авто-синхр uid=${uid}:`, err.message);
      }
    }

    return null;
  });
