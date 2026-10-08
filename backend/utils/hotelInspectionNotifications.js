const pool = require('../db');
const { tgSend, tgSendToAdmins } = require('./telegram');

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function siteUrl(path) {
  return `${String(process.env.SITE_PUBLIC_URL || 'https://travella.uz').replace(/\/+$/, '')}${path}`;
}

function buildInspectionSubmittedText(data, resubmitted = false) {
  return [
    resubmitted ? '🔄 <b>Инспекция отеля отправлена повторно</b>' : '🏨 <b>Новая инспекция отеля на модерации</b>',
    '',
    `<b>Отель:</b> ${esc(data.hotel_name || `#${data.hotel_id}`)}`,
    `<b>Автор:</b> ${esc(data.author_name || `#${data.author_provider_id || data.author_client_id}`)}`,
    `<b>Инспекция:</b> #${Number(data.id)}`,
  ].join('\n');
}

function buildInspectionReviewedText(data, status, reason = '') {
  const approved = status === 'approved';
  const lines = [
    approved ? '✅ <b>Инспекция отеля опубликована</b>' : '❌ <b>Инспекция отеля отклонена</b>',
    '',
    `<b>Отель:</b> ${esc(data.hotel_name || `#${data.hotel_id}`)}`,
    `<b>Инспекция:</b> #${Number(data.id)}`,
  ];
  if (!approved && reason) lines.push('', `<b>Причина:</b> ${esc(reason)}`);
  if (!approved) lines.push('', 'Исправьте инспекцию в разделе «Мои инспекции» и отправьте её повторно.');
  return lines.join('\n');
}

async function getInspectionNotificationData(inspectionId, db = pool) {
  const { rows } = await db.query(
    `SELECT i.id,i.hotel_id,i.author_name,i.author_provider_id,i.author_client_id,h.name AS hotel_name,
            p.telegram_web_chat_id,p.telegram_chat_id,p.tg_chat_id
       FROM inspections i
       JOIN hotels h ON h.id=i.hotel_id
       LEFT JOIN providers p ON p.id=i.author_provider_id
      WHERE i.id=$1 LIMIT 1`,
    [inspectionId]
  );
  return rows[0] || null;
}

async function notifyInspectionSubmitted(inspectionId, { resubmitted = false, db = pool } = {}) {
  const data = await getInspectionNotificationData(inspectionId, db);
  if (!data) return { ok: false, reason: 'inspection_not_found' };
  return tgSendToAdmins(buildInspectionSubmittedText(data, resubmitted), {
    reply_markup: { inline_keyboard: [[{ text: 'Проверить инспекцию', url: siteUrl('/admin/hotels/inspections') }]] },
  });
}

async function notifyInspectionReviewed(inspectionId, status, reason = '', { db = pool } = {}) {
  const data = await getInspectionNotificationData(inspectionId, db);
  if (!data) return { ok: false, reason: 'inspection_not_found' };
  const chatId = data.telegram_web_chat_id || data.telegram_chat_id || data.tg_chat_id;
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!chatId) return { ok: false, reason: 'author_provider_chat_missing' };
  if (!token) return { ok: false, reason: 'main_bot_token_missing' };
  const ok = await tgSend(chatId, buildInspectionReviewedText(data, status, reason), {
    reply_markup: { inline_keyboard: [[{
      text: status === 'approved' ? 'Открыть инспекции' : 'Исправить инспекцию',
      url: siteUrl(`/hotels/inspections?mine=1${status === 'approved' ? '' : `&edit=${inspectionId}`}`),
    }]] },
  }, token);
  return { ok, chat_id: String(chatId), bot: 'main' };
}

module.exports = {
  buildInspectionSubmittedText,
  buildInspectionReviewedText,
  notifyInspectionSubmitted,
  notifyInspectionReviewed,
};
