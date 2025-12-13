const { tgSend } = require("../utils/telegram");

// PATCH /api/leads/:id/decision
exports.decideLead = async (req, res) => {
  const id = Number(req.params.id);
  const { decision } = req.body || {};

  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false, error: "bad_id" });
  }

  if (!["approved_provider", "approved_client", "rejected"].includes(decision)) {
    return res.status(400).json({ ok: false, error: "bad_decision" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Забираем лид
    const leadRes = await client.query(
      `SELECT *
         FROM leads
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );

    if (leadRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "lead_not_found" });
    }

    const lead = leadRes.rows[0];

    if (lead.decision) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "already_decided" });
    }

    const phone = lead.phone;
    const name = lead.name || "Telegram user";
    const chatId = lead.telegram_chat_id;
    const username = lead.telegram_username;

    let createdEntity = null;

    // ===== APPROVED CLIENT =====
    if (decision === "approved_client") {
      const exists = await client.query(
        `SELECT id FROM clients
          WHERE regexp_replace(phone,'\\D','','g') = regexp_replace($1,'\\D','','g')
          LIMIT 1`,
        [phone]
      );

      if (exists.rowCount === 0) {
        const email = `tg_${Date.now()}@telegram.local`;

        const ins = await client.query(
          `
          INSERT INTO clients (
            name,
            phone,
            email,
            password_hash,
            telegram_chat_id,
            telegram
          )
          VALUES ($1,$2,$3,$4,$5,$6)
          RETURNING id
          `,
          [
            name,
            phone,
            email,
            process.env.TELEGRAM_DUMMY_PASSWORD_HASH ||
              "$2b$10$N9qo8uLOickgx2ZMRZo5i.Ul5cW93vGN9VOGQsv5nPVnrwJknhkAu",
            chatId,
            username || null,
          ]
        );

        createdEntity = { role: "client", id: ins.rows[0].id };
      }
    }

    // ===== APPROVED PROVIDER =====
    if (decision === "approved_provider") {
      const exists = await client.query(
        `SELECT id FROM providers
          WHERE regexp_replace(phone,'\\D','','g') = regexp_replace($1,'\\D','','g')
          LIMIT 1`,
        [phone]
      );

      if (exists.rowCount === 0) {
        const email = `tg_${Date.now()}@telegram.local`;

        const ins = await client.query(
          `
          INSERT INTO providers (
            name,
            phone,
            email,
            password,
            telegram_chat_id,
            social,
            type,
            created_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,'provider',NOW())
          RETURNING id
          `,
          [
            name,
            phone,
            email,
            "telegram",
            chatId,
            username ? `@${username}` : null,
          ]
        );

        createdEntity = { role: "provider", id: ins.rows[0].id };
      }
    }

    // ===== UPDATE LEAD =====
    await client.query(
      `
      UPDATE leads
         SET decision   = $2,
             decided_at = NOW(),
             status     = 'closed'
       WHERE id = $1
      `,
      [id, decision]
    );

    await client.query("COMMIT");

    // ===== TELEGRAM NOTIFY =====
    if (chatId) {
      if (decision === "approved_provider") {
        await tgSend(
          chatId,
          `✅ Ваша заявка одобрена!\n\nВы зарегистрированы как поставщик Travella.\n\n👉 https://travella.uz/dashboard`
        );
      }
      if (decision === "approved_client") {
        await tgSend(
          chatId,
          `✅ Ваша заявка одобрена!\n\nТеперь вы можете пользоваться сервисами Travella.\n👉 https://travella.uz`
        );
      }
      if (decision === "rejected") {
        await tgSend(
          chatId,
          `❌ К сожалению, ваша заявка была отклонена.\n\nЕсли вы считаете это ошибкой — свяжитесь с поддержкой Travella.`
        );
      }
    }

    return res.json({
      ok: true,
      decision,
      created: createdEntity,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("decideLead error:", e);
    return res.status(500).json({ ok: false, error: "decide_failed" });
  } finally {
    client.release();
  }
};
