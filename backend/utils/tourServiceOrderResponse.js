const pool = require("../db");
const { tgSend } = require("./telegram");

const chatFields = ["telegram_web_chat_id", "telegram_chat_id", "tg_chat_id", "telegram_refused_chat_id"];
let supplierReplyTableReady = null;

function profileChatId(profile = {}) {
  return chatFields.map((field) => profile[field]).find(Boolean) || null;
}

function actorMatchesProfile(actorTelegramId, profile = {}) {
  const actor = String(actorTelegramId || "").trim();
  return Boolean(actor) && chatFields.some((field) => String(profile[field] || "").trim() === actor);
}

async function respondToSupplierServiceOrder({ actorTelegramId, bookingId, decision }) {
  const normalizedDecision = decision === "accepted" ? "accepted" : decision === "declined" ? "declined" : null;
  if (!normalizedDecision || !Number.isInteger(Number(bookingId)) || Number(bookingId) <= 0) {
    return { ok: false, code: "invalid" };
  }
  const found = await pool.query(
    `SELECT ops.package_id,ops.booking_id,ops.service_order_status,
            tp.title,tp.booking_reference,s.title AS service_title,
            to_jsonb(supplier) AS supplier_profile,to_jsonb(agency) AS agency_profile
       FROM tour_package_component_ops ops
       JOIN bookings b ON b.id=ops.booking_id
       JOIN tour_packages tp ON tp.id=ops.package_id AND b.group_id=tp.id
       LEFT JOIN services s ON s.id=b.service_id
       LEFT JOIN providers supplier ON supplier.id=b.provider_id
       JOIN providers agency ON agency.id=tp.owner_provider_id
      WHERE ops.booking_id=$1 AND ops.service_order_sent_at IS NOT NULL
      LIMIT 1`,
    [Number(bookingId)]
  );
  if (!found.rowCount) return { ok: false, code: "not_found" };
  const item = found.rows[0];
  if (!actorMatchesProfile(actorTelegramId, item.supplier_profile || {})) return { ok: false, code: "forbidden" };
  if (item.service_order_status !== "sent") {
    return { ok: false, code: "already_responded", service_order_status: item.service_order_status };
  }
  const updated = await pool.query(
    `UPDATE tour_package_component_ops SET
       service_order_status=$2,service_order_responded_at=NOW(),updated_at=NOW()
     WHERE booking_id=$1 AND service_order_status='sent'
     RETURNING service_order_status,service_order_responded_at`,
    [Number(bookingId), normalizedDecision]
  );
  if (!updated.rowCount) return { ok: false, code: "already_responded" };
  await pool.query(
    `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type,actor_telegram_id)
     VALUES($1::uuid,$2,$3,'supplier',$4)`,
    [item.package_id, Number(bookingId), normalizedDecision, String(actorTelegramId)]
  );
  await pool.query(
    `UPDATE tour_package_tasks SET completed=TRUE,completed_at=NOW(),updated_at=NOW()
     WHERE package_id=$1::uuid AND booking_id=$2
       AND task_type='follow_up_supplier_order' AND completed=FALSE`,
    [item.package_id, Number(bookingId)]
  );
  if (normalizedDecision === "declined") {
    await pool.query(
      `INSERT INTO tour_package_tasks(package_id,title,task_type,booking_id,due_at,priority)
       SELECT $1::uuid,$2,'replace_declined_supplier',$3,CURRENT_DATE,'high'
       WHERE NOT EXISTS (
         SELECT 1 FROM tour_package_tasks
         WHERE package_id=$1::uuid AND booking_id=$3
           AND task_type='replace_declined_supplier' AND completed=FALSE
       )`,
      [item.package_id, `Replace supplier: ${item.service_title || `#${bookingId}`}`, Number(bookingId)]
    );
  } else {
    await pool.query(
      `UPDATE tour_package_tasks SET completed=TRUE,completed_at=NOW(),updated_at=NOW()
       WHERE package_id=$1::uuid AND booking_id=$2
         AND task_type='replace_declined_supplier' AND completed=FALSE`,
      [item.package_id, Number(bookingId)]
    );
  }
  const agencyChatId = profileChatId(item.agency_profile || {});
  if (agencyChatId) {
    const symbol = normalizedDecision === "accepted" ? "✅" : "❌";
    const action = normalizedDecision === "accepted" ? "принял" : "отклонил";
    await tgSend(agencyChatId, [
      `${symbol} <b>Поставщик ${action} заказ</b>`,
      `Тур: <b>${String(item.title || "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</b>`,
      item.booking_reference ? `Номер тура: ${item.booking_reference}` : "",
      `Услуга: ${String(item.service_title || "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}`,
    ].filter(Boolean).join("\n"));
  }
  return { ok: true, ...updated.rows[0] };
}

async function ensureSupplierReplyTable() {
  if (!supplierReplyTableReady) supplierReplyTableReady = pool.query(`
    CREATE TABLE IF NOT EXISTS tour_package_supplier_reply_pending (
      actor_telegram_id TEXT PRIMARY KEY,
      booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch((error) => {
    supplierReplyTableReady = null;
    throw error;
  });
  await supplierReplyTableReady;
}

async function beginSupplierServiceOrderReply({ actorTelegramId, bookingId }) {
  const actor = String(actorTelegramId || "").trim();
  const id = Number(bookingId);
  if (!actor || !Number.isInteger(id) || id <= 0) return { ok: false, code: "invalid" };
  await ensureSupplierReplyTable();
  const found = await pool.query(
    `SELECT b.id,tp.title,s.title AS service_title,to_jsonb(supplier) AS supplier_profile
       FROM bookings b
       JOIN tour_packages tp ON tp.id=b.group_id
       JOIN tour_package_component_ops ops ON ops.package_id=tp.id AND ops.booking_id=b.id
       LEFT JOIN services s ON s.id=b.service_id
       LEFT JOIN providers supplier ON supplier.id=b.provider_id
      WHERE b.id=$1 AND ops.service_order_status IN ('sent','accepted')
      LIMIT 1`,
    [id]
  );
  if (!found.rowCount) return { ok: false, code: "not_found" };
  const item = found.rows[0];
  if (!actorMatchesProfile(actor, item.supplier_profile || {})) return { ok: false, code: "forbidden" };
  await pool.query(
    `INSERT INTO tour_package_supplier_reply_pending(actor_telegram_id,booking_id,expires_at,created_at)
     VALUES($1,$2,NOW() + INTERVAL '30 minutes',NOW())
     ON CONFLICT(actor_telegram_id) DO UPDATE SET booking_id=EXCLUDED.booking_id,expires_at=EXCLUDED.expires_at,created_at=NOW()`,
    [actor, id]
  );
  return { ok: true, booking_id: id, tour_title: item.title, service_title: item.service_title };
}

async function consumeSupplierServiceOrderReply({ actorTelegramId, text }) {
  const actor = String(actorTelegramId || "").trim();
  const message = String(text || "").trim().slice(0, 1000);
  if (!actor || !message || message.startsWith("/")) return { ok: false, code: "not_pending" };
  await ensureSupplierReplyTable();
  const pending = await pool.query(
    `SELECT b.id AS booking_id,tp.id AS package_id,tp.title,tp.booking_reference,
            s.title AS service_title,to_jsonb(supplier) AS supplier_profile,to_jsonb(agency) AS agency_profile
       FROM tour_package_supplier_reply_pending pending
       JOIN bookings b ON b.id=pending.booking_id
       JOIN tour_packages tp ON tp.id=b.group_id
       JOIN tour_package_component_ops ops ON ops.package_id=tp.id AND ops.booking_id=b.id
       LEFT JOIN services s ON s.id=b.service_id
       JOIN providers supplier ON supplier.id=b.provider_id
       JOIN providers agency ON agency.id=tp.owner_provider_id
      WHERE pending.actor_telegram_id=$1 AND pending.expires_at>NOW()
      LIMIT 1`,
    [actor]
  );
  if (!pending.rowCount) return { ok: false, code: "not_pending" };
  const item = pending.rows[0];
  if (!actorMatchesProfile(actor, item.supplier_profile || {})) return { ok: false, code: "forbidden" };
  const consumed = await pool.query(
    `DELETE FROM tour_package_supplier_reply_pending
      WHERE actor_telegram_id=$1 AND booking_id=$2 AND expires_at>NOW()
      RETURNING actor_telegram_id`,
    [actor, item.booking_id]
  );
  if (!consumed.rowCount) return { ok: false, code: "not_pending" };
  const event = await pool.query(
    `INSERT INTO tour_package_component_events(package_id,booking_id,event_type,actor_type,actor_telegram_id,metadata)
     VALUES($1::uuid,$2,'message_received','supplier',$3,jsonb_build_object('message',$4::text))
     RETURNING id,event_type,actor_type,created_at,metadata`,
    [item.package_id, item.booking_id, actor, message]
  );
  const agencyChatId = profileChatId(item.agency_profile || {});
  if (agencyChatId) {
    const safe = (value) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    await tgSend(agencyChatId, [
      "💬 <b>Ответ поставщика по заказу</b>",
      `Тур: <b>${safe(item.title || "—")}</b>`,
      item.booking_reference ? `Номер тура: ${safe(item.booking_reference)}` : "",
      `Услуга: <b>${safe(item.service_title || "—")}</b>`,
      "",
      safe(message),
    ].filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== "")).join("\n"));
  }
  return { ok: true, booking_id: item.booking_id, service_order_event: event.rows[0] };
}

module.exports = { actorMatchesProfile, profileChatId, respondToSupplierServiceOrder, beginSupplierServiceOrderReply, consumeSupplierServiceOrderReply };
