// backend/controllers/financeModelController.js
import pool from "../db.js";

// Если у тебя другая система auth — подстрой getActor() под неё
function getActor(req) {
  // варианты:
  // - req.user from JWT middleware
  // - req.provider / req.client
  const user = req.user || null;
  return {
    user_id: user?.id || null,
    user_role: user?.role || "guest",
  };
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_models (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      user_role TEXT,
      name TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_finance_models_user
    ON finance_models(user_id, user_role);
  `);
}

export async function listFinanceModels(req, res) {
  try {
    await ensureTable();
    const actor = getActor(req);

    const r = await pool.query(
      `
      SELECT id, name, created_at, updated_at
      FROM finance_models
      WHERE (user_id = $1 AND user_role = $2)
         OR ($1 IS NULL AND user_role = 'guest')
      ORDER BY updated_at DESC
      LIMIT 50
      `,
      [actor.user_id, actor.user_role]
    );

    return res.json({ ok: true, items: r.rows });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

export async function getFinanceModel(req, res) {
  try {
    await ensureTable();
    const actor = getActor(req);
    const id = Number(req.params.id);

    const r = await pool.query(
      `
      SELECT id, name, data, created_at, updated_at
      FROM finance_models
      WHERE id = $1
        AND ((user_id = $2 AND user_role = $3) OR ($2 IS NULL AND user_role='guest'))
      LIMIT 1
      `,
      [id, actor.user_id, actor.user_role]
    );

    if (!r.rows.length) return res.status(404).json({ ok: false, message: "Not found" });

    return res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

export async function createFinanceModel(req, res) {
  try {
    await ensureTable();
    const actor = getActor(req);

    const { name, data } = req.body || {};
    if (!name || !data) return res.status(400).json({ ok: false, message: "name and data required" });

    const r = await pool.query(
      `
      INSERT INTO finance_models (user_id, user_role, name, data)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, created_at, updated_at
      `,
      [actor.user_id, actor.user_role, String(name), data]
    );

    return res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

export async function deleteFinanceModel(req, res) {
  try {
    await ensureTable();
    const actor = getActor(req);
    const id = Number(req.params.id);

    const r = await pool.query(
      `
      DELETE FROM finance_models
      WHERE id = $1
        AND ((user_id = $2 AND user_role = $3) OR ($2 IS NULL AND user_role='guest'))
      RETURNING id
      `,
      [id, actor.user_id, actor.user_role]
    );

    if (!r.rows.length) return res.status(404).json({ ok: false, message: "Not found" });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}
