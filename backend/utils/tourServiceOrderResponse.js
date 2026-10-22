const pool = require("../db");
const { tgSend } = require("./telegram");

const chatFields = ["telegram_web_chat_id", "telegram_chat_id", "tg_chat_id", "telegram_refused_chat_id"];

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

module.exports = { actorMatchesProfile, profileChatId, respondToSupplierServiceOrder };
