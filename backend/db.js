// backend/db.js
require("dotenv").config();

const { Pool } = require("pg");

function shouldUseSSL() {
  const url = String(process.env.DATABASE_URL || "");
  if (!url) return false;

  // explicit overrides (highest priority)
  const forced = String(process.env.DATABASE_SSL || "").toLowerCase();
  if (forced === "1" || forced === "true" || forced === "yes") return true;
  if (forced === "0" || forced === "false" || forced === "no") return false;

  const sslMode = String(process.env.PGSSLMODE || "").toLowerCase();
  if (sslMode === "disable") return false;
  if (sslMode === "require" || sslMode === "verify-full" || sslMode === "verify-ca") return true;

  // heuristic: local hosts -> NO SSL
  try {
    const u = new URL(url);
    const host = String(u.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  } catch {}

  // heuristic: common cloud providers -> SSL
  return /railway|rlwy|render|neon|supabase|heroku|amazonaws|aws|azure|gcp|digitalocean/i.test(url);
}

const connectTimeout = Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000);
const stmtTimeout = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15000);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: shouldUseSSL() ? { rejectUnauthorized: false } : false,

  // ✅ чтобы не висло на connect
  connectionTimeoutMillis: connectTimeout,

  // ✅ statement_timeout на уровне сессии (работает через libpq options)
  options: `-c statement_timeout=${stmtTimeout}`,
});

module.exports = pool;
