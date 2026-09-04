
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

const waiting = [];

function send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function removeWaiting(ws) {
    const index = waiting.indexOf(ws);

    if (index !== -1) {
        waiting.splice(index, 1);
    }
}

function findPartner(ws) {
    removeWaiting(ws);

    if (waiting.length === 0) {
        waiting.push(ws);
        send(ws, {
            type: "waiting"
        });
        return;
    }

    const partner = waiting.shift();

    send(ws, {
        type: "matched",
        initiator: true
    });

    send(partner, {
        type: "matched",
        initiator: false
    });

    ws.partner = partner;
    partner.partner = ws;
}

wss.on("connection", (ws) => {
    send(ws, {
        type: "connected"
    });

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "find") {
                findPartner(ws);
            }

            if (data.type === "next") {
                const partner = ws.partner;

                if (partner) {
                    partner.partner = null;

                    send(partner, {
                        type: "partner_left"
                    });
                }

                ws.partner = null;

                findPartner(ws);
            }

            if (
                data.type === "offer" ||
                data.type === "answer" ||
                data.type === "candidate"
            ) {
                if (ws.partner) {
                    send(ws.partner, data);
                }
            }
        } catch (error) {
            console.error("Ошибка сообщения:", error);
        }
    });

    ws.on("close", () => {
        removeWaiting(ws);

        if (ws.partner) {
            const partner = ws.partner;

            partner.partner = null;

            send(partner, {
                type: "partner_left"
            });
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("==============================");
    console.log("ВИДЕО-РУЛЕТКА ЗАПУЩЕНА");
    console.log("==============================");
    console.log("Порт:", PORT);
});
