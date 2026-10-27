const pool = require("../db");
const { ensureTelegramOperationsSchema } = require("../services/telegramOperationsService");
const { tgSendToAdmins } = require("../utils/telegram");

async function runTelegramSupportSlaJob(db = pool) {
  await ensureTelegramOperationsSchema(db);
  const result = await db.query(`
    WITH due AS (
      SELECT t.id,t.category,t.priority,t.actor_role,t.assigned_to,t.due_at
      FROM telegram_support_tickets t
      WHERE t.status IN ('open','in_progress') AND t.due_at<NOW()
        AND NOT EXISTS (SELECT 1 FROM telegram_bot_events e WHERE e.event_type='support_sla_overdue' AND (e.metadata->>'ticket_id')::bigint=t.id)
      ORDER BY t.due_at LIMIT 50
    ), logged AS (
      INSERT INTO telegram_bot_events(event_type,metadata)
      SELECT 'support_sla_overdue',jsonb_build_object('ticket_id',id,'priority',priority) FROM due
      RETURNING (metadata->>'ticket_id')::bigint ticket_id
    ) SELECT due.* FROM due JOIN logged ON logged.ticket_id=due.id
  `);
  for (const ticket of result.rows) {
    await tgSendToAdmins(`🚨 <b>Просрочено SLA обращения #${ticket.id}</b>\nТема: ${ticket.category}\nПриоритет: ${ticket.priority}\nРоль: ${ticket.actor_role}\nОтветственный: ${ticket.assigned_to || "не назначен"}`, { parse_mode: "HTML" });
  }
  return { overdue_alerts: result.rowCount || 0 };
}

module.exports = { runTelegramSupportSlaJob };
