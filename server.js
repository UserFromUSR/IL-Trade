import WebSocket from "ws";
import express from "express";
import crypto from "crypto";
import cors from "cors";

const API_KEY = "ТВОЙ_API_KEY";
const SECRET  = "ТВОЙ_SECRET_KEY";

const app = express();
app.use(cors());

let clients = [];

// SSE поток в фронт
app.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  clients.push(res);

  req.on("close", () => {
    clients = clients.filter(c => c !== res);
  });
});

function broadcast(data) {
  clients.forEach(c => {
    c.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// 🔐 подпись
function sign(params) {
  const query = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join("&");

  return crypto
    .createHmac("sha256", SECRET)
    .update(query)
    .digest("hex");
}

// 🚀 подключение к приватному WS
function connectPrivateWS() {
  const ws = new WebSocket("wss://wbs.mexc.com/ws");

  ws.on("open", () => {
    console.log("🔗 Connected to MEXC");

    const timestamp = Date.now();

    const params = {
      apiKey: API_KEY,
      reqTime: timestamp
    };

    const signature = sign(params);

    // 🔐 логин
    ws.send(JSON.stringify({
      method: "LOGIN",
      params: {
        apiKey: API_KEY,
        reqTime: timestamp,
        signature
      }
    }));

    // 📡 подписка на ОРДЕРА (твои)
    ws.send(JSON.stringify({
      method: "SUBSCRIPTION",
      params: ["spot@private.orders"]
    }));
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg.toString());

    // 🎯 Ловим ТВОИ сделки
    if (data?.c === "spot@private.orders" && data?.d) {
      const d = data.d;

      const trade = {
        id: d.i, // order id
        asset: d.s,
        entry: parseFloat(d.p),
        qty: parseFloat(d.v),
        side: d.S === 1 ? "LONG" : "SHORT",
        status: d.X,
        date: new Date().toISOString().slice(0,10),
        time: new Date().toTimeString().slice(0,5)
      };

      console.log("📈 New Trade:", trade);

      broadcast(trade);
    }
  });

  ws.on("close", () => {
    console.log("❌ WS closed. Reconnecting...");
    setTimeout(connectPrivateWS, 3000);
  });

  ws.on("error", (err) => {
    console.log("WS error:", err.message);
  });
}

connectPrivateWS();

app.listen(3000, () => console.log("🚀 Server started on 3000"));
