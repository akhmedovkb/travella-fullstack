// backend/controllers/adminResetController.js
const pool = require("../db");

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

async function loadLeadById(leadId) {
  if (!leadId) return null;
  const q = await pool.query(
    `SELECT id, phone, telegram_chat_id, source, requested_role
       FROM leads
      WHERE id = $1
      LIMIT 1`,
    [leadId]
  );
  return q.rows[0] || null;
}

function isClientLeadMeta(lead) {
  const src = String(lead?.source || "").toLowerCase();
  const rr = String(lead?.requested_role || "").toLowerCase();
  return rr === "client" || src === "telegram_client";
}

function isProviderLeadMeta(lead) {
  const src = String(lead?.source || "").toLowerCase();
  const rr = String(lead?.requested_role || "").toLowerCase();
  return rr === "agent" || rr === "provider" || src === "telegram_provider";
}

async function resetClient(req, res) {
  try {
    const {
      phone,
      id,
      leadId,
      telegramChatId,
      alsoResetLeads = true,
    } = req.body || {};

    if (!phone && !id && !leadId && !telegramChatId) {
      return res.status(400).json({
        ok: false,
        error: "phone_or_id_or_leadId_or_telegramChatId_required",
      });
    }

    // 1) если дали leadId — доберём телефон/chat_id из leads
    const lead = leadId ? await loadLeadById(leadId) : null;

    const normPhone =
      normalizePhone(phone) || normalizePhone(lead?.phone) || null;

    const tgChat =
      (telegramChatId !== undefined && telegramChatId !== null
        ? String(telegramChatId)
        : lead?.telegram_chat_id !== null && lead?.telegram_chat_id !== undefined
        ? String(lead.telegram_chat_id)
        : null) || null;

    // 2) ищем клиента: id -> tgChat -> phone
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
    } else if (tgChat) {
      const q = await pool.query(
        `SELECT id, name, phone, telegram_chat_id, telegram
           FROM clients
          WHERE telegram_chat_id = $1
          LIMIT 1`,
        [tgChat]
      );
      client = q.rows[0] || null;
    } else if (normPhone) {
      const q = await pool.query(
        `SELECT id, name, phone, telegram_chat_id, telegram
           FROM clients
          WHERE regexp_replace(phone,'\\D','','g') = $1
          LIMIT 1`,
        [normPhone]
      );
      client = q.rows[0] || null;
    }

    let clientFound = !!client;

    // 3) если нашли — сбрасываем привязку в clients
    if (client) {
      await pool.query(
        `UPDATE clients
            SET telegram_chat_id = NULL,
                telegram = NULL
          WHERE id = $1`,
        [client.id]
      );
    }

    // ✅ cross-reset: если сбрасываем клиента по tgChat — убираем возможную привязку провайдера
    // (иначе бот может находить пользователя в providers/clients "не тем" путём)
    if (tgChat) {
      await pool.query(
        `UPDATE providers
            SET telegram_chat_id = NULL,
                social = NULL
          WHERE telegram_chat_id = $1`,
        [tgChat]
      );
    }

    // 4) (опционально) сбрасываем telegram_* в leads (даже если client не найден)
    let leadsReset = 0;

    if (alsoResetLeads) {
      // ограничим апдейт только "клиентскими" лидами, если это явно leadId
      const mustBeClientLead = leadId ? isClientLeadMeta(lead) : null;

      const whereParts = [];
      const params = [];
      let p = 1;

      if (normPhone) {
        whereParts.push(`regexp_replace(phone,'\\D','','g') = $${p++}`);
        params.push(normPhone);
      }
      if (tgChat) {
        whereParts.push(`telegram_chat_id = $${p++}`);
        params.push(tgChat);
      }

      // если вообще нечем матчить — не трогаем leads
      if (whereParts.length) {
        const roleGuard =
          mustBeClientLead === true
            ? `AND (source = 'telegram_client' OR requested_role = 'client')`
            : `AND (source = 'telegram_client' OR requested_role = 'client')`;

        const upd = await pool.query(
          `UPDATE leads
              SET decision = NULL,
                  decided_at = NULL,
                  status = 'new',
                  telegram_chat_id = NULL,
                  telegram_username = NULL,
                  telegram_first_name = NULL
            WHERE (${whereParts.join(" OR ")})
            ${roleGuard}`,
          params
        );
        leadsReset = upd.rowCount || 0;
      }
    }

    // Если ничего не нашли и leads не обновили — тогда 404 (как раньше)
    if (!clientFound && leadsReset === 0) {
      return res.json({
        ok: true,
        reset: "client",
        clientFound: false,
        clientId: null,
        alsoResetLeads,
        leadsReset,
        note: "client_not_found_but_ok",
      });
    }

    return res.json({
      ok: true,
      reset: "client",
      clientFound,
      clientId: client?.id || null,
      alsoResetLeads,
      leadsReset,
    });
  } catch (e) {
    console.error("resetClient error:", e);
    return res.status(500).json({ ok: false, error: "reset_failed" });
  }
}

async function resetProvider(req, res) {
  try {
    const {
      phone,
      id,
      leadId,
      telegramChatId,
      alsoResetLeads = true,
    } = req.body || {};

    if (!phone && !id && !leadId && !telegramChatId) {
      return res.status(400).json({
        ok: false,
        error: "phone_or_id_or_leadId_or_telegramChatId_required",
      });
    }

    // 1) если дали leadId — доберём телефон/chat_id из leads
    const lead = leadId ? await loadLeadById(leadId) : null;

    const normPhone =
      normalizePhone(phone) || normalizePhone(lead?.phone) || null;

    const tgChat =
      (telegramChatId !== undefined && telegramChatId !== null
        ? String(telegramChatId)
        : lead?.telegram_chat_id !== null && lead?.telegram_chat_id !== undefined
        ? String(lead.telegram_chat_id)
        : null) || null;

    // 2) ищем провайдера: id -> tgChat -> phone
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
    } else if (tgChat) {
      const q = await pool.query(
        `SELECT id, name, phone, type, telegram_chat_id, social
           FROM providers
          WHERE telegram_chat_id = $1
          LIMIT 1`,
        [tgChat]
      );
      provider = q.rows[0] || null;
    } else if (normPhone) {
      const q = await pool.query(
        `SELECT id, name, phone, type, telegram_chat_id, social
           FROM providers
          WHERE regexp_replace(phone,'\\D','','g') = $1
          LIMIT 1`,
        [normPhone]
      );
      provider = q.rows[0] || null;
    }

    let providerFound = !!provider;

    // 3) если нашли — сбрасываем привязку в providers
    if (provider) {
      await pool.query(
        `UPDATE providers
            SET telegram_chat_id = NULL,
                social = NULL
          WHERE id = $1`,
        [provider.id]
      );
    }

    // ✅ cross-reset: если сбрасываем провайдера по tgChat — убираем возможную "клиентскую" привязку
    // (иначе бот может продолжать находить пользователя в clients и отвечать как клиент)
    if (tgChat) {
      await pool.query(
        `UPDATE clients
            SET telegram_chat_id = NULL,
                telegram = NULL
          WHERE telegram_chat_id = $1`,
        [tgChat]
      );
    }

    // 4) (опционально) сбрасываем telegram_* в leads (даже если provider не найден)
    let leadsReset = 0;

    if (alsoResetLeads) {
      const mustBeProviderLead = leadId ? isProviderLeadMeta(lead) : null;

      const whereParts = [];
      const params = [];
      let p = 1;

      if (normPhone) {
        whereParts.push(`regexp_replace(phone,'\\D','','g') = $${p++}`);
        params.push(normPhone);
      }
      if (tgChat) {
        whereParts.push(`telegram_chat_id = $${p++}`);
        params.push(tgChat);
      }

      if (whereParts.length) {
        const roleGuard =
          mustBeProviderLead === true
            ? `AND (source = 'telegram_provider' OR requested_role IN ('agent','provider'))`
            : `AND (source = 'telegram_provider' OR requested_role IN ('agent','provider'))`;

        const upd = await pool.query(
          `UPDATE leads
              SET decision = NULL,
                  decided_at = NULL,
                  status = 'new',
                  telegram_chat_id = NULL,
                  telegram_username = NULL,
                  telegram_first_name = NULL
            WHERE (${whereParts.join(" OR ")})
            ${roleGuard}`,
          params
        );
        leadsReset = upd.rowCount || 0;
      }
    }

    // Если ничего не нашли и leads не обновили — тогда 404 (как раньше)
    if (!providerFound && leadsReset === 0) {
      return res.json({
        ok: true,
        reset: "provider",
        providerFound: false,
        providerId: null,
        alsoResetLeads,
        leadsReset,
        note: "provider_not_found_but_ok",
      });
    }
    return res.json({
      ok: true,
      reset: "provider",
      providerFound,
      providerId: provider?.id || null,
      alsoResetLeads,
      leadsReset,
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
