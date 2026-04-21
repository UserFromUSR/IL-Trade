import WebSocket from "ws";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

let clients = [];

// подключение фронта
app.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  clients.push(res);

  req.on("close", () => {
    clients = clients.filter(c => c !== res);
  });
});

// отправка всем клиентам
function broadcast(data) {
  clients.forEach(c => {
    c.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// 🔥 WebSocket MEXC
function connectMEXC(apiKey) {
  const ws = new WebSocket("wss://wbs.mexc.com/ws");

  ws.on("open", () => {
    console.log("MEXC connected");

    // публичные сделки (пример)
    ws.send(JSON.stringify({
      method: "SUBSCRIPTION",
      params: ["spot@public.deals.v3.api@BTCUSDT"]
    }));
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg.toString());

    if (data.d) {
      const trade = {
        id: Date.now(),
        asset: "BTCUSDT",
        entry: data.d.p,
        side: data.d.S === 1 ? "LONG" : "SHORT",
        time: new Date().toTimeString().slice(0,5),
        date: new Date().toISOString().slice(0,10)
      };

      broadcast(trade);
    }
  });

  ws.on("close", () => {
    console.log("Reconnecting...");
    setTimeout(() => connectMEXC(apiKey), 3000);
  });
}

// старт
connectMEXC();

app.listen(3000, () => console.log("Server running"));
