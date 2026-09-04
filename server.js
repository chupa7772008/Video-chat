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

    while (waiting.length > 0) {
        const partner = waiting.shift();

        if (
            partner.readyState === WebSocket.OPEN &&
            partner !== ws
        ) {
            ws.partner = partner;
            partner.partner = ws;

            send(ws, {
                type: "matched",
                initiator: true
            });

            send(partner, {
                type: "matched",
                initiator: false
            });

            console.log("Пара найдена");

            return;
        }
    }

    waiting.push(ws);

    send(ws, {
        type: "waiting"
    });

    console.log("Пользователь ожидает");
}

wss.on("connection", (ws) => {

    console.log("Новый пользователь подключился");

    ws.partner = null;

    send(ws, {
        type: "connected"
    });

    ws.on("message", (message) => {

        try {

            const data = JSON.parse(message.toString());

            if (data.type === "find") {
                findPartner(ws);
                return;
            }

            if (data.type === "next") {

                const partner = ws.partner;

                ws.partner = null;

                if (partner) {

                    partner.partner = null;

                    send(partner, {
                        type: "partner_left"
                    });
                }

                findPartner(ws);

                return;
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

            console.log(
                "Ошибка:",
                error.message
            );
        }
    });

    ws.on("close", () => {

        removeWaiting(ws);

        if (ws.partner) {

            const partner = ws.partner;

            ws.partner = null;
            partner.partner = null;

            send(partner, {
                type: "partner_left"
            });
        }

        console.log("Пользователь отключился");
    });
});

server.listen(3000, "0.0.0.0", () => {

    console.log("");
    console.log("==============================");
    console.log("ВИДЕО-РУЛЕТКА ЗАПУЩЕНА");
    console.log("==============================");
    console.log("Порт: 3000");
    console.log("");
});

