const { Pool } = require("pg");

const pool = new Pool(
    process.env.DATABASE_URL
        ? {
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        }
        : {
            host: "localhost",
            port: 5432,
            database: "videochat",
            user: "u0_a849",
            password: ""
        }
);

module.exports = pool;
