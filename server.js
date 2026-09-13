const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const db = require("./db");
const bcrypt = require("bcrypt");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


// ======================================================
// РЕГИСТРАЦИЯ
// ======================================================

app.post("/api/register", async (req, res) => {
    try {
        const {
            username,
            password,
            country,
            gender
        } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                error: "Введите логин и пароль"
            });
        }

        if (username.length < 3 || username.length > 32) {
            return res.status(400).json({
                error: "Логин должен содержать от 3 до 32 символов"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                error: "Пароль должен содержать минимум 6 символов"
            });
        }

        const existing = await db.query(
            "SELECT id FROM users WHERE username = $1",
            [username]
        );

        if (existing.rows.length > 0) {
            return res.status(409).json({
                error: "Такой пользователь уже существует"
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const result = await db.query(
            `INSERT INTO users
            (username, password_hash, country, gender)
            VALUES ($1, $2, $3, $4)
            RETURNING id, username, country, gender, role`,
            [
                username,
                passwordHash,
                country || "unknown",
                gender || "none"
            ]
        );

        res.status(201).json({
            success: true,
            user: result.rows[0]
        });

    } catch (error) {
        console.error("Ошибка регистрации:", error);

        res.status(500).json({
            error: "Ошибка сервера"
        });
    }
});


// ======================================================
// ВХОД
// ======================================================

app.post("/api/login", async (req, res) => {
    try {
        const {
            username,
            password
        } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                error: "Введите логин и пароль"
            });
        }

        const result = await db.query(
            `SELECT
                id,
                username,
                password_hash,
                country,
                gender,
                role,
                is_banned
             FROM users
             WHERE username = $1`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: "Неверный логин или пароль"
            });
        }

        const user = result.rows[0];

        if (user.is_banned) {
            return res.status(403).json({
                error: "Пользователь заблокирован"
            });
        }

        const passwordCorrect = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordCorrect) {
            return res.status(401).json({
                error: "Неверный логин или пароль"
            });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                country: user.country,
                gender: user.gender,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Ошибка входа:", error);

        res.status(500).json({
            error: "Ошибка сервера"
        });
    }
});


// ======================================================
// ПРОВЕРКА БАЗЫ
// ======================================================

app.get("/api/health", async (req, res) => {
    try {
        const result = await db.query(
            "SELECT NOW() AS time"
        );

        res.json({
            server: "ok",
            database: "ok",
            time: result.rows[0].time
        });

    } catch (error) {
        console.error("Ошибка базы:", error);

        res.status(500).json({
            server: "ok",
            database: "error"
        });
    }
});


// ======================================================
// ОЧЕРЕДЬ ВИДЕОЧАТА
// ======================================================

const waiting = [];


// ======================================================
// ОТПРАВКА WEBSOCKET
// ======================================================

function send(ws, data) {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(JSON.stringify(data));
    }
}


// ======================================================
// УДАЛЕНИЕ ИЗ ОЧЕРЕДИ
// ======================================================

function removeWaiting(ws) {
    const index = waiting.indexOf(ws);

    if (index !== -1) {
        waiting.splice(index, 1);
    }
}


// ======================================================
// СОВПАДЕНИЕ ПОЛЬЗОВАТЕЛЕЙ
// ======================================================

function matches(user, partner) {

    const countryMatch =
        user.searchCountry === "any" ||
        user.searchCountry === partner.country;

    const genderMatch =
        user.searchGender === "any" ||
        user.searchGender === partner.gender;

    return countryMatch && genderMatch;
}


// ======================================================
// ПОИСК СОБЕСЕДНИКА
// ======================================================

function findPartner(ws) {

    removeWaiting(ws);

    for (let i = 0; i < waiting.length; i++) {

        const partner = waiting[i];

        if (
            matches(ws, partner) &&
            matches(partner, ws)
        ) {

            waiting.splice(i, 1);

            ws.partner = partner;
            partner.partner = ws;

            send(ws, {
                type: "matched",
                initiator: true,
                partner: {
                    country: partner.country,
                    gender: partner.gender
                }
            });

            send(partner, {
                type: "matched",
                initiator: false,
                partner: {
                    country: ws.country,
                    gender: ws.gender
                }
            });

            return;
        }
    }

    waiting.push(ws);

    send(ws, {
        type: "waiting"
    });
}


// ======================================================
// WEBSOCKET
// ======================================================

wss.on("connection", (ws) => {

    ws.country = "unknown";
    ws.gender = "none";

    ws.searchCountry = "any";
    ws.searchGender = "any";

    ws.partner = null;

    send(ws, {
        type: "connected"
    });


    ws.on("message", (message) => {

        try {

            const data = JSON.parse(message);


            // ==========================================
            // ПОИСК
            // ==========================================

            if (data.type === "find") {

                ws.country =
                    data.country || "unknown";

                ws.gender =
                    data.gender || "none";

                ws.searchCountry =
                    data.searchCountry || "any";

                ws.searchGender =
                    data.searchGender || "any";

                findPartner(ws);
            }


            // ==========================================
            // ОСТАНОВКА
            // ==========================================

            if (data.type === "stop") {

                const partner = ws.partner;

                if (partner) {

                    partner.partner = null;

                    send(partner, {
                        type: "partner_left"
                    });
                }

                ws.partner = null;

                removeWaiting(ws);
            }


            // ==========================================
            // СЛЕДУЮЩИЙ СОБЕСЕДНИК
            // ==========================================

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


            // ==========================================
            // WEBRTC
            // ==========================================

            if (
                data.type === "offer" ||
                data.type === "answer" ||
                data.type === "candidate"
            ) {

                if (ws.partner) {

                    send(
                        ws.partner,
                        data
                    );
                }
            }

        } catch (error) {

            console.error(
                "Ошибка сообщения:",
                error
            );
        }
    });


    // ==============================================
    // ОТКЛЮЧЕНИЕ
    // ==============================================

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


// ======================================================
// ЗАПУСК
// ======================================================

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "=============================="
        );

        console.log(
            "ВИДЕО-РУЛЕТКА ЗАПУЩЕНА"
        );

        console.log(
            "=============================="
        );

        console.log(
            "Порт:",
            PORT
        );

        console.log(
            "PostgreSQL: подключён"
        );
    }
);
