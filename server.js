const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const db = require("./db");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ======================================================
// СЕРВЕРНЫЕ СЕССИИ
// ======================================================

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30;

function getClientIp(req) {

    const forwardedFor =
        req.headers["x-forwarded-for"];

    if (forwardedFor) {
        return forwardedFor
            .split(",")[0]
            .trim();
    }

    return (
        req.headers["cf-connecting-ip"] ||
        req.socket.remoteAddress ||
        "unknown"
    );
}


function createSessionToken() {
    return crypto.randomBytes(32).toString("hex");
}

function setSessionCookie(res, token, req) {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const isHttps =
        forwardedProto === "https" ||
        req.protocol === "https";

    const secure = isHttps ? "; Secure" : "";

    res.setHeader(
        "Set-Cookie",
        `session=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(
            SESSION_DURATION_MS / 1000
        )}; SameSite=Lax${secure}`
    );
}

function clearSessionCookie(res, req) {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const isHttps =
        forwardedProto === "https" ||
        req.protocol === "https";

    const secure = isHttps ? "; Secure" : "";

    res.setHeader(
        "Set-Cookie",
        `session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`
    );
}

function getSessionToken(req) {
    const cookieHeader = req.headers.cookie;

    if (!cookieHeader) {
        return null;
    }

    const cookies = cookieHeader.split(";");

    for (const cookie of cookies) {
        const parts = cookie.trim().split("=");

        if (parts[0] === "session") {
            return parts.slice(1).join("=") || null;
        }
    }

    return null;
}

async function getAuthenticatedUser(req) {

    const token = getSessionToken(req);

    if (!token) {
        return null;
    }

    const result = await db.query(
        `SELECT
            u.id,
            u.username,
            u.country,
            u.gender,
            u.role,
            u.is_banned
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = $1
           AND s.expires_at > NOW()`,
        [token]
    );

    if (result.rows.length === 0) {
        return null;
    }

    const user = result.rows[0];

    if (user.is_banned) {
        await db.query(
            "DELETE FROM sessions WHERE token = $1",
            [token]
        );

        return null;
    }

    return user;
}



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

        const newUser = result.rows[0];

        const sessionToken = createSessionToken();

        const expiresAt = new Date(
            Date.now() + SESSION_DURATION_MS
        );

        await db.query(
            `INSERT INTO sessions
                (token, user_id, expires_at)
             VALUES
                ($1, $2, $3)`,
            [
                sessionToken,
                newUser.id,
                expiresAt
            ]
        );

        setSessionCookie(
            res,
            sessionToken,
            req
        );

        res.status(201).json({
            success: true,
            user: newUser
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

        const sessionToken = createSessionToken();

        const expiresAt = new Date(
            Date.now() + SESSION_DURATION_MS
        );

        await db.query(
            `INSERT INTO sessions
                (token, user_id, expires_at)
             VALUES
                ($1, $2, $3)`,
            [
                sessionToken,
                user.id,
                expiresAt
            ]
        );

        setSessionCookie(
            res,
            sessionToken,
            req
        );

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
// ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ
// ======================================================

app.get("/api/me", async (req, res) => {

    try {

        const user = await getAuthenticatedUser(req);

        if (!user) {
            return res.status(401).json({
                authenticated: false
            });
        }

        res.json({
            authenticated: true,
            user: {
                id: user.id,
                username: user.username,
                country: user.country,
                gender: user.gender,
                role: user.role
            }
        });

    } catch (error) {

        console.error(
            "Ошибка проверки сессии:",
            error
        );

        res.status(500).json({
            error: "Ошибка сервера"
        });
    }
});


// ======================================================
// ВЫХОД
// ======================================================

app.post("/api/logout", async (req, res) => {

    try {

        const token = getSessionToken(req);

        if (token) {
            await db.query(
                "DELETE FROM sessions WHERE token = $1",
                [token]
            );
        }

        clearSessionCookie(res, req);

        res.json({
            success: true
        });

    } catch (error) {

        console.error(
            "Ошибка выхода:",
            error
        );

        res.status(500).json({
            error: "Ошибка сервера"
        });
    }
});


// ======================================================
// ПРОВЕРКА БАЗЫ


// ======================================================

// ======================================================
// ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ
// ======================================================

app.put("/api/profile", async (req, res) => {

    try {

        const user = await getAuthenticatedUser(req);

        if (!user) {
            return res.status(401).json({
                error: "Необходима авторизация"
            });
        }

        const country =
            req.body.country || "unknown";

        const gender =
            req.body.gender || "none";

        const result = await db.query(
            `UPDATE users
             SET country = $1,
                 gender = $2
             WHERE id = $3
             RETURNING
                 id,
                 username,
                 country,
                 gender,
                 role`,
            [
                country,
                gender,
                user.id
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Пользователь не найден"
            });
        }

        res.json({
            success: true,
            user: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Ошибка обновления профиля:",
            error
        );

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

wss.on("connection", async (ws, request) => {

    try {
        ws.user = await getAuthenticatedUser(request);
    } catch (error) {
        console.error(
            "Ошибка проверки WebSocket-сессии:",
            error
        );

        ws.user = null;
    }

    if (ws.user) {
        ws.country = ws.user.country || "unknown";
        ws.gender = ws.user.gender || "none";
    } else {
        ws.country = "unknown";
        ws.gender = "none";
    }

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
