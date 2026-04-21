import WebSocket from "ws";
import express from "express";
import crypto from "crypto";
import cors from "cors";

const API_KEY = process.env.API_KEY;
const SECRET  = process.env.SECRET;

const app = express();
app.use(cors());

let clients = [];
let positions = {};

// SSE
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

function sign(params) {
  const query = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join("&");

  return crypto.createHmac("sha256", SECRET)
    .update(query)
    .digest("hex");
}

// 🚀 WS
function connectWS() {
  const ws = new WebSocket("wss://wbs.mexc.com/ws");

  ws.on("open", () => {
    const timestamp = Date.now();

    const params = {
      apiKey: API_KEY,
      reqTime: timestamp
    };

    const signature = sign(params);

    ws.send(JSON.stringify({
      method: "LOGIN",
      params: {
        apiKey: API_KEY,
        reqTime: timestamp,
        signature
      }
    }));

    ws.send(JSON.stringify({
      method: "SUBSCRIPTION",
      params: ["futures@private.orders"]
    }));
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg.toString());

    if (data?.c !== "futures@private.orders" || !data?.d) return;

    const d = data.d;

    const symbol = d.s;
    const price  = parseFloat(d.p);
    const qty    = parseFloat(d.v);
    const side   = d.S === 1 ? "BUY" : "SELL";
    const status = d.X;

    if (status !== "FILLED") return;

    if (!positions[symbol]) {
      positions[symbol] = { size: 0, entry: 0 };
    }

    let pos = positions[symbol];

    if (side === "BUY") {
      if (pos.size < 0) {
        const closeQty = Math.min(qty, Math.abs(pos.size));
        const pnl = (pos.entry - price) * closeQty;

        emitTrade(symbol, pos.entry, price, closeQty, pnl, "SHORT");

        pos.size += closeQty;

        if (qty > closeQty) {
          pos.entry = price;
          pos.size = qty - closeQty;
        }

      } else {
        const newSize = pos.size + qty;
        pos.entry = (pos.entry * pos.size + price * qty) / newSize;
        pos.size = newSize;
      }
    }

    if (side === "SELL") {
      if (pos.size > 0) {
        const closeQty = Math.min(qty, pos.size);
        const pnl = (price - pos.entry) * closeQty;

        emitTrade(symbol, pos.entry, price, closeQty, pnl, "LONG");

        pos.size -= closeQty;

        if (qty > closeQty) {
          pos.entry = price;
          pos.size = -(qty - closeQty);
        }

      } else {
        const newSize = Math.abs(pos.size) + qty;
        pos.entry = (pos.entry * Math.abs(pos.size) + price * qty) / newSize;
        pos.size = -newSize;
      }
    }

    if (pos.size === 0) delete positions[symbol];
  });

  ws.on("close", () => {
    setTimeout(connectWS, 3000);
  });
}

function emitTrade(symbol, entry, exit, qty, pnl, side) {
  broadcast({
    id: Date.now() + Math.random(),
    asset: symbol,
    entry,
    exit,
    qty,
    pnl,
    side,
    date: new Date().toISOString().slice(0,10),
    time: new Date().toTimeString().slice(0,5)
  });
}

connectWS();

app.listen(3000, () => console.log("Server running"));
