const pool = require('../db');
const { tgSendToAdmins } = require('./telegram');

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

function buildHotelCreatedByProviderText(data) {
  const lines = [
    '🏨 <b>Новая карточка отеля ожидает проверки</b>',
    '',
    `<b>Отель:</b> ${esc(data.hotel_name || `#${data.hotel_id}`)}`,
    `<b>Страна:</b> ${esc(data.hotel_country || 'не указана')}`,
    `<b>Город:</b> ${esc(data.hotel_city || 'не указан')}`,
    `<b>Адрес отеля:</b> ${esc(data.hotel_address || 'не указан')}`,
    `<b>Контакт отеля:</b> ${esc(data.hotel_contact || 'не указан')}`,
    `<b>Карточка:</b> #${Number(data.hotel_id)}`,
    '',
    '<b>Кто создал</b>',
    `<b>Поставщик:</b> ${esc(data.provider_name || `#${data.provider_id}`)}`,
    `<b>ID поставщика:</b> #${Number(data.provider_id)}`,
    `<b>Тип:</b> ${esc(data.provider_type || 'не указан')}`,
    `<b>Телефон:</b> ${esc(data.provider_phone || 'не указан')}`,
    `<b>Email:</b> ${esc(data.provider_email || 'не указан')}`,
    `<b>Адрес поставщика:</b> ${esc(data.provider_address || 'не указан')}`,
    '',
    'Проверьте карточку и принадлежность отеля поставщику.',
  ];
  return lines.join('\n');
}

async function notifyHotelCreatedByProvider({ hotelId, providerId, db = pool }) {
  const { rows } = await db.query(
    `SELECT h.id AS hotel_id,h.name AS hotel_name,h.country AS hotel_country,
            COALESCE(h.city,h.location) AS hotel_city,h.address AS hotel_address,
            h.contact AS hotel_contact,
            p.id AS provider_id,p.name AS provider_name,p.type AS provider_type,
            p.phone AS provider_phone,p.email AS provider_email,p.address AS provider_address
       FROM hotels h
       JOIN providers p ON p.id=$2
      WHERE h.id=$1
      LIMIT 1`,
    [hotelId, providerId]
  );
  const data = rows[0];
  if (!data) return { ok: false, reason: 'hotel_or_provider_missing' };

  return tgSendToAdmins(buildHotelCreatedByProviderText(data), {
    reply_markup: {
      inline_keyboard: [[{
        text: 'Проверить и назначить владельца',
        url: siteUrl(`/admin/hotels/${hotelId}/offers`),
      }]],
    },
  });
}

module.exports = {
  buildHotelCreatedByProviderText,
  notifyHotelCreatedByProvider,
};
