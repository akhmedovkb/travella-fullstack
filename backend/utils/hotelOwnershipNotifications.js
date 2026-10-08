const pool = require('../db');
const { tgSend, tgSendToAdmins } = require('./telegram');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function siteUrl(path) {
  const base = String(process.env.SITE_PUBLIC_URL || 'https://travella.uz').replace(/\/+$/, '');
  return `${base}${path}`;
}

function buildHotelOwnershipReviewedText(data, decision, reason = '') {
  const approved = decision === 'approve';
  const lines = [
    approved ? '✅ <b>Владение отелем подтверждено</b>' : '❌ <b>Заявка на владение отелем отклонена</b>',
    '',
    `<b>Отель:</b> ${esc(data.hotel_name || `#${data.hotel_id}`)}`,
    `<b>Карточка:</b> #${Number(data.hotel_id)}`,
  ];
  if (approved) {
    lines.push('', 'Отель назначен вашей организации и доступен в разделе «Мои отели».');
  } else {
    if (reason) lines.push('', `<b>Причина:</b> ${esc(reason)}`);
    lines.push('', 'Исправьте данные и отправьте заявку повторно из кабинета.');
  }
  return lines.join('\n');
}

function buildHotelOwnershipSubmittedText(data, { resubmitted = false, note = '' } = {}) {
  const lines = [
    resubmitted
      ? '🔁 <b>Заявка на владение отелем отправлена повторно</b>'
      : '🏨 <b>Новая заявка «Это мой отель»</b>',
    '',
    `<b>Отель:</b> ${esc(data.hotel_name || `#${data.hotel_id}`)}`,
    `<b>Город:</b> ${esc(data.hotel_city || 'не указан')}`,
    `<b>Адрес:</b> ${esc(data.hotel_address || 'не указан')}`,
    `<b>Карточка:</b> #${Number(data.hotel_id)}`,
    '',
    `<b>Поставщик:</b> ${esc(data.provider_name || `#${data.provider_id}`)}`,
    `<b>ID поставщика:</b> #${Number(data.provider_id)}`,
    `<b>Телефон:</b> ${esc(data.provider_phone || 'не указан')}`,
    `<b>Email:</b> ${esc(data.provider_email || 'не указан')}`,
  ];
  if (note) lines.push(`<b>Связь/комментарий:</b> ${esc(note)}`);
  lines.push('', 'Проверьте связь поставщика с отелем и примите решение.');
  return lines.join('\n');
}

async function notifyHotelOwnershipSubmitted({ hotelId, providerId, note = '', resubmitted = false, db = pool }) {
  const { rows } = await db.query(
    `SELECT h.id AS hotel_id,h.name AS hotel_name,COALESCE(h.city,h.location) AS hotel_city,
            h.address AS hotel_address,p.id AS provider_id,p.name AS provider_name,
            p.phone AS provider_phone,p.email AS provider_email
       FROM hotels h
       JOIN providers p ON p.id=$2
      WHERE h.id=$1
      LIMIT 1`,
    [hotelId, providerId]
  );
  const data = rows[0];
  if (!data) return { ok: false, reason: 'hotel_or_provider_missing' };
  return tgSendToAdmins(buildHotelOwnershipSubmittedText(data, { resubmitted, note }), {
    reply_markup: {
      inline_keyboard: [[{
        text: 'Проверить заявку',
        url: siteUrl(`/admin/hotels/${hotelId}/offers`),
      }]],
    },
  });
}

async function notifyHotelOwnershipReviewed({ hotelId, providerId, decision, reason = '', db = pool }) {
  const { rows } = await db.query(
    `SELECT h.id AS hotel_id,h.name AS hotel_name,p.id AS provider_id,
            p.telegram_web_chat_id,p.telegram_chat_id,p.tg_chat_id
       FROM hotels h
       JOIN providers p ON p.id=$2
      WHERE h.id=$1
      LIMIT 1`,
    [hotelId, providerId]
  );
  const data = rows[0];
  if (!data) return { ok: false, reason: 'hotel_or_provider_missing' };

  const chatId = data.telegram_web_chat_id || data.telegram_chat_id || data.tg_chat_id;
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!chatId) return { ok: false, reason: 'provider_main_chat_missing' };
  if (!token) return { ok: false, reason: 'main_bot_token_missing' };

  const ok = await tgSend(chatId, buildHotelOwnershipReviewedText(data, decision, reason), {
    reply_markup: {
      inline_keyboard: [[{
        text: decision === 'approve' ? 'Открыть «Мои отели»' : 'Открыть заявку',
        url: siteUrl(decision === 'approve' ? '/dashboard/hotels' : `/provider/hotels/${hotelId}/offer`),
      }]],
    },
  }, token);
  return { ok, chat_id: String(chatId), bot: 'main' };
}

module.exports = {
  buildHotelOwnershipReviewedText,
  buildHotelOwnershipSubmittedText,
  notifyHotelOwnershipReviewed,
  notifyHotelOwnershipSubmitted,
};
