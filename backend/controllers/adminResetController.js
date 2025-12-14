// backend/controllers/adminResetController.js
const pool = require("../db");

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

async function resetClient(req, res) {
  try {
    const { phone, id, alsoResetLeads = true } = req.body || {};

    if (!phone && !id) {
      return res.status(400).json({ ok: false, error: "phone_or_id_required" });
    }

    let client = null;

    if (id) {
      const q = await pool.query(
        `SELECT id, name, phone, telegram_chat_id, telegram
           FROM clients
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      client = q.rows[0] || null;
    } else {
      const norm = normalizePhone(phone);
      const q = await pool.query(
        `SELECT id, name, phone, telegram_chat_id, telegram
           FROM clients
          WHERE regexp_replace(phone,'\\D','','g') = $1
          LIMIT 1`,
        [norm]
      );
      client = q.rows[0] || null;
    }

    if (!client) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }

    // Сбрасываем Telegram-привязку клиента
    await pool.query(
      `UPDATE clients
          SET telegram_chat_id = NULL,
              telegram = NULL
        WHERE id = $1`,
      [client.id]
    );

    // (опционально) сбрасываем телеграм-лиды клиента
    if (alsoResetLeads) {
      const norm = normalizePhone(client.phone);
      if (norm) {
        // ✅ ВАЖНО: обнуляем telegram_* в leads тоже, чтобы кнопка Reset исчезала
        await pool.query(
          `UPDATE leads
              SET decision = NULL,
                  decided_at = NULL,
                  status = 'new',
                  telegram_chat_id = NULL,
                  telegram_username = NULL,
                  telegram_first_name = NULL
            WHERE regexp_replace(phone,'\\D','','g') = $1
              AND (source = 'telegram_client' OR requested_role = 'client')`,
          [norm]
        );
      }
    }

    return res.json({
      ok: true,
      reset: "client",
      clientId: client.id,
      alsoResetLeads,
    });
  } catch (e) {
    console.error("resetClient error:", e);
    return res.status(500).json({ ok: false, error: "reset_failed" });
  }
}

async function resetProvider(req, res) {
  try {
    const { phone, id, alsoResetLeads = true } = req.body || {};

    if (!phone && !id) {
      return res.status(400).json({ ok: false, error: "phone_or_id_required" });
    }

    let provider = null;

    if (id) {
      const q = await pool.query(
        `SELECT id, name, phone, type, telegram_chat_id, social
           FROM providers
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      provider = q.rows[0] || null;
    } else {
      const norm = normalizePhone(phone);
      const q = await pool.query(
        `SELECT id, name, phone, type, telegram_chat_id, social
           FROM providers
          WHERE regexp_replace(phone,'\\D','','g') = $1
          LIMIT 1`,
        [norm]
      );
      provider = q.rows[0] || null;
    }

    if (!provider) {
      return res.status(404).json({ ok: false, error: "provider_not_found" });
    }

    // Сбрасываем Telegram-привязку поставщика
    await pool.query(
      `UPDATE providers
          SET telegram_chat_id = NULL,
              social = NULL
        WHERE id = $1`,
      [provider.id]
    );

    // (опционально) сбрасываем телеграм-лиды поставщика
    if (alsoResetLeads) {
      const norm = normalizePhone(provider.phone);
      if (norm) {
        // ✅ ВАЖНО: обнуляем telegram_* в leads тоже, чтобы кнопка Reset исчезала
        await pool.query(
          `UPDATE leads
              SET decision = NULL,
                  decided_at = NULL,
                  status = 'new',
                  telegram_chat_id = NULL,
                  telegram_username = NULL,
                  telegram_first_name = NULL
            WHERE regexp_replace(phone,'\\D','','g') = $1
              AND (source = 'telegram_provider' OR requested_role IN ('agent','provider'))`,
          [norm]
        );
      }
    }

    return res.json({
      ok: true,
      reset: "provider",
      providerId: provider.id,
      alsoResetLeads,
    });
  } catch (e) {
    console.error("resetProvider error:", e);
    return res.status(500).json({ ok: false, error: "reset_failed" });
  }
}

module.exports = {
  resetClient,
  resetProvider,
};
