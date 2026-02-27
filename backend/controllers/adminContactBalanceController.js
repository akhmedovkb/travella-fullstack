// backend/controllers/adminContactBalanceController.js
const pool = require("../db");

/**
 * Мы делаем контроллер "устойчивым":
 * - Достаём список колонок таблиц через information_schema (кэшируем)
 * - Строим запросы только по реально существующим колонкам
 * - Баланс считаем так:
 *    1) если есть clients.contact_balance — берём его
 *    2) иначе считаем суммой по contact_balance_ledger (если есть)
 */

const _cache = {
  columns: new Map(), // key: "schema.table" -> Set(columns)
};

async function getColumns(table, schema = "public") {
  const key = `${schema}.${table}`;
  if (_cache.columns.has(key)) return _cache.columns.get(key);

  const { rows } = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
  `,
    [schema, table]
  );

  const set = new Set(rows.map((r) => r.column_name));
  _cache.columns.set(key, set);
  return set;
}

function pickFirst(cols, candidates) {
  for (const c of candidates) if (cols.has(c)) return c;
  return null;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

async function findClientByQuery(qRaw) {
  const q = String(qRaw || "").trim();
  if (q.length < 2) return [];

  const cols = await getColumns("clients");

  const colId = pickFirst(cols, ["id"]);
  if (!colId) return [];

  const colPhone = pickFirst(cols, ["phone", "phone_number", "tel"]);
  const colEmail = pickFirst(cols, ["email", "mail"]);
  const colName = pickFirst(cols, ["full_name", "name"]);
  const colUsername = pickFirst(cols, ["username", "tg_username", "telegram_username"]);
  const colTg = pickFirst(cols, ["telegram_chat_id", "telegram_id", "tg_id", "chat_id"]);

  // Собираем условия по тем колонкам, которые реально есть
  const where = [];
  const params = [];
  let p = 1;

  // Если q — число, пробуем по ID и tg id
  const asNum = Number(q);
  const isNum = Number.isFinite(asNum) && String(asNum) === q;

  if (isNum) {
    where.push(`${colId} = $${p++}`);
    params.push(asNum);
    if (colTg) {
      where.push(`${colTg} = $${p++}`);
      params.push(asNum);
    }
  }

  const like = `%${q}%`;
  if (colPhone) {
    where.push(`${colPhone} ILIKE $${p++}`);
    params.push(like);
  }
  if (colEmail) {
    where.push(`${colEmail} ILIKE $${p++}`);
    params.push(like);
  }
  if (colName) {
    where.push(`${colName} ILIKE $${p++}`);
    params.push(like);
  }
  if (colUsername) {
    where.push(`${colUsername} ILIKE $${p++}`);
    params.push(like);
  }

  if (!where.length) return [];

  // select только существующие колонки
  const select = [
    `${colId} AS id`,
    colName ? `${colName} AS full_name` : `NULL AS full_name`,
    colPhone ? `${colPhone} AS phone` : `NULL AS phone`,
    colEmail ? `${colEmail} AS email` : `NULL AS email`,
    colTg ? `${colTg} AS telegram_chat_id` : `NULL AS telegram_chat_id`,
    colUsername ? `${colUsername} AS username` : `NULL AS username`,
  ];

  const sql = `
    SELECT ${select.join(", ")}
    FROM clients
    WHERE (${where.join(" OR ")})
    ORDER BY id DESC
    LIMIT 25
  `;

  const { rows } = await pool.query(sql, params);
  return rows || [];
}

async function getClientBalanceAndLedger(clientId) {
  const colsClients = await getColumns("clients");
  const colsLedger = await getColumns("contact_balance_ledger").catch(() => new Set());

  const hasContactBalance = colsClients.has("contact_balance");
  const hasLedger = colsLedger.size > 0;

  // 1) баланс
  let balance = 0;

  if (hasContactBalance) {
    const r = await pool.query(`SELECT COALESCE(contact_balance,0) AS bal FROM clients WHERE id=$1`, [
      clientId,
    ]);
    balance = toNum(r.rows?.[0]?.bal);
  } else if (hasLedger) {
    // считаем суммой amount
    const r = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS bal
         FROM contact_balance_ledger
        WHERE client_id = $1`,
      [clientId]
    );
    balance = toNum(r.rows?.[0]?.bal);
  } else {
    balance = 0;
  }

  // 2) ledger
  let ledger = [];
  if (hasLedger) {
    // Выбираем набор колонок "гибко"
    const c = colsLedger;
    const sel = [
      c.has("id") ? "id" : "NULL AS id",
      c.has("created_at") ? "created_at" : "now() AS created_at",
      c.has("amount") ? "amount" : "0 AS amount",
      c.has("reason") ? "reason" : "NULL AS reason",
      c.has("service_id") ? "service_id" : "NULL AS service_id",
      c.has("source") ? "source" : "NULL AS source",
      c.has("note") ? "note" : (c.has("comment") ? "comment AS note" : "NULL AS note"),
      c.has("meta") ? "meta" : "NULL AS meta",
    ];

    const limitNum = 100;
    
    const r = await pool.query(
      `
      SELECT
        id,
        client_id,
        amount,
        reason,
        service_id,
        source,
        meta,
        created_at
      FROM contact_balance_ledger
      WHERE client_id = $1
    
      UNION ALL
    
      SELECT
        id,
        client_id,
        amount,
        reason,
        CASE
          WHEN ref_type = 'service_unlock' THEN ref_id
          ELSE NULL
        END AS service_id,
        'legacy'::text AS source,
        meta,
        created_at
      FROM client_balance_ledger
      WHERE client_id = $1
    
      ORDER BY created_at DESC, id DESC
      LIMIT $2
      `,
      [clientId, limitNum]
    );
    
    ledger = r.rows || [];
  } else {
    ledger = [];
  }

  return { balance, ledger };
}

async function adjustClientBalanceTx(clientId, amount, reason, note) {
  const colsClients = await getColumns("clients");
  const colsLedger = await getColumns("contact_balance_ledger").catch(() => new Set());
  const hasContactBalance = colsClients.has("contact_balance");
  const hasLedger = colsLedger.size > 0;

  if (!hasLedger) {
    throw new Error("contact_balance_ledger table not found (required)");
  }

  const a = toNum(amount);
  if (!a) throw new Error("amount_invalid");

  const rReason = String(reason || "admin_adjust").slice(0, 64);
  const rNote = String(note || "").slice(0, 500);

  await pool.query("BEGIN");
  try {
    // lock клиента
    await pool.query(`SELECT id FROM clients WHERE id = $1 FOR UPDATE`, [clientId]);

    // ledger insert (минимальный набор)
    // используем только реально существующие колонки
    const c = colsLedger;

    const cols = ["client_id", "amount"];
    const vals = ["$1", "$2"];
    const params = [clientId, a];
    let p = 3;

    if (c.has("reason")) {
      cols.push("reason");
      vals.push(`$${p++}`);
      params.push(rReason);
    }
    if (c.has("note")) {
      cols.push("note");
      vals.push(`$${p++}`);
      params.push(rNote);
    } else if (c.has("comment")) {
      cols.push("comment");
      vals.push(`$${p++}`);
      params.push(rNote);
    }
    if (c.has("source")) {
      cols.push("source");
      vals.push(`$${p++}`);
      params.push("admin");
    }
    if (c.has("meta")) {
      cols.push("meta");
      vals.push(`$${p++}`);
      params.push({ by: "admin", reason: rReason });
    }

    await pool.query(`INSERT INTO contact_balance_ledger (${cols.join(",")}) VALUES (${vals.join(",")})`, params);

    // при наличии clients.contact_balance — обновляем его тоже (чтобы бот/веб быстро читали)
    if (hasContactBalance) {
      await pool.query(
        `UPDATE clients
            SET contact_balance = COALESCE(contact_balance,0) + $2
          WHERE id = $1`,
        [clientId, a]
      );
    }

    await pool.query("COMMIT");
  } catch (e) {
    await pool.query("ROLLBACK");
    throw e;
  }
}

/* ===================== Handlers ===================== */

async function adminClientSearch(req, res) {
  try {
    const q = req.query?.q || "";
    const items = await findClientByQuery(q);
    res.json({ items });
  } catch (e) {
    console.error("[adminClientSearch]", e?.message || e);
    res.status(500).json({ error: "server_error" });
  }
}

async function adminGetClientContactBalance(req, res) {
  try {
    const clientId = Number(req.params?.id || 0);
    if (!clientId) return res.status(400).json({ error: "bad_client_id" });

    const { balance, ledger } = await getClientBalanceAndLedger(clientId);
    res.json({ balance, ledger });
  } catch (e) {
    console.error("[adminGetClientContactBalance]", e?.message || e);
    res.status(500).json({ error: "server_error" });
  }
}

async function adminAdjustClientContactBalance(req, res) {
  try {
    const clientId = Number(req.params?.id || 0);
    if (!clientId) return res.status(400).json({ error: "bad_client_id" });

    const amount = toNum(req.body?.amount);
    const reason = String(req.body?.reason || "admin_adjust");
    const note = String(req.body?.note || "");

    if (!amount) return res.status(400).json({ error: "amount_required" });

    await adjustClientBalanceTx(clientId, amount, reason, note);

    const { balance } = await getClientBalanceAndLedger(clientId);
    res.json({ ok: true, balance });
  } catch (e) {
    const msg = String(e?.message || e);
    console.error("[adminAdjustClientContactBalance]", msg);

    if (msg === "amount_invalid") {
      return res.status(400).json({ error: "amount_invalid" });
    }
    if (msg.includes("contact_balance_ledger table not found")) {
      return res.status(500).json({ error: "ledger_table_missing" });
    }

    res.status(500).json({ error: "server_error" });
  }
}

module.exports = {
  adminClientSearch,
  adminGetClientContactBalance,
  adminAdjustClientContactBalance,
};
