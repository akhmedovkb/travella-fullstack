const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // В проде (Railway/Cloud) нужны SSL-сокеты, локально — нет.
  ssl: process.env.DATABASE_URL && /postgres:\/\/|postgresql:\/\//i.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : false,
});

module.exports = pool;
