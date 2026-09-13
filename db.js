const { Pool } = require("pg");

const pool = new Pool({
    host: "localhost",
    port: 5432,
    database: "videochat",
    user: "u0_a849",
    password: "",
});

module.exports = pool;
