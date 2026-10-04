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

function periodText(offer) {
  return `${offer.valid_from || 'без даты'} → ${offer.valid_to || 'без даты'}`;
}

function resolveHotelProviderTelegram(offer, env = process.env) {
  const chatId = offer.telegram_web_chat_id || offer.telegram_chat_id || offer.tg_chat_id;
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();

  if (!chatId) return { ok: false, reason: 'provider_main_chat_missing' };
  if (!token) return { ok: false, reason: 'main_bot_token_missing' };

  return { ok: true, chatId: String(chatId), token };
}

function buildAdminText(offer) {
  return [
    '🏨 <b>Новое предложение отеля на модерации</b>',
    '',
    `<b>Отель:</b> ${esc(offer.hotel_name || `#${offer.hotel_id}`)}`,
    `<b>Поставщик:</b> ${esc(offer.provider_name || `#${offer.provider_id}`)}`,
    `<b>Период:</b> ${esc(periodText(offer))}`,
    `<b>Тарифов:</b> ${Number(offer.rate_count || 0)}`,
    `<b>Предложение:</b> #${Number(offer.id)}`,
  ].join('\n');
}

function buildProviderText(offer, decision, reason = '') {
  const approved = decision === 'approve';
  const lines = [
    approved ? '✅ <b>Предложение отеля опубликовано</b>' : '❌ <b>Предложение отеля отклонено</b>',
    '',
    `<b>Отель:</b> ${esc(offer.hotel_name || `#${offer.hotel_id}`)}`,
    `<b>Период:</b> ${esc(periodText(offer))}`,
    `<b>Предложение:</b> #${Number(offer.id)}`,
  ];
  if (!approved && reason) lines.push('', `<b>Причина:</b> ${esc(reason)}`);
  if (!approved) lines.push('', 'Исправьте предложение в кабинете и отправьте его повторно.');
  return lines.join('\n');
}

async function getOfferNotificationData(offerId, db = pool) {
  const { rows } = await db.query(
    `SELECT o.id,o.hotel_id,o.provider_id,o.valid_from::text,o.valid_to::text,
            h.name AS hotel_name,p.name AS provider_name,
            p.telegram_web_chat_id,p.telegram_chat_id,p.tg_chat_id,
            COUNT(r.id)::int AS rate_count
       FROM hotel_offers o
       JOIN hotels h ON h.id=o.hotel_id
       JOIN providers p ON p.id=o.provider_id
       LEFT JOIN hotel_offer_rates r ON r.offer_id=o.id
      WHERE o.id=$1
      GROUP BY o.id,h.name,p.id
      LIMIT 1`,
    [offerId]
  );
  return rows[0] || null;
}

async function notifyHotelOfferSubmitted(offerId, options = {}) {
  const offer = await getOfferNotificationData(offerId, options.db || pool);
  if (!offer) return { ok: false, reason: 'offer_not_found' };
  return tgSendToAdmins(buildAdminText(offer), {
    reply_markup: {
      inline_keyboard: [[{
        text: 'Проверить предложение',
        url: siteUrl(`/admin/hotels/${offer.hotel_id}/offers`),
      }]],
    },
  });
}

async function notifyHotelOfferReviewed(offerId, decision, reason = '', options = {}) {
  const offer = await getOfferNotificationData(offerId, options.db || pool);
  if (!offer) return { ok: false, reason: 'offer_not_found' };

  const destination = resolveHotelProviderTelegram(offer);
  if (!destination.ok) return destination;

  const ok = await tgSend(destination.chatId, buildProviderText(offer, decision, reason), {
    reply_markup: {
      inline_keyboard: [[{
        text: decision === 'approve' ? 'Открыть предложение' : 'Исправить предложение',
        url: siteUrl(`/provider/hotels/${offer.hotel_id}/offer`),
      }]],
    },
  }, destination.token);
  return { ok, chat_id: destination.chatId, bot: 'main' };
}

module.exports = {
  buildAdminText,
  buildProviderText,
  resolveHotelProviderTelegram,
  notifyHotelOfferSubmitted,
  notifyHotelOfferReviewed,
};
