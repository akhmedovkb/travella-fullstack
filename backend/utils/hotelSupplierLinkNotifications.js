const pool = require('../db');
const { tgSend } = require('./telegram');

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

function supplierTypeLabel(type) {
  const labels = {
    agent: 'Турагент', tour_agent: 'Турагент', agency: 'Агентство',
    tour_operator: 'Туроператор', dmc: 'DMC', supplier: 'Поставщик', hotel: 'Отель',
  };
  return labels[String(type || '').toLowerCase()] || String(type || 'Поставщик');
}

function buildHotelSupplierLinkedText(data) {
  return [
    '🤝 <b>Новый поставщик добавил ваш отель</b>',
    '',
    `<b>Отель:</b> ${esc(data.hotel_name || `#${data.hotel_id}`)}`,
    `<b>Поставщик:</b> ${esc(data.supplier_name || `#${data.supplier_id}`)}`,
    `<b>Тип:</b> ${esc(supplierTypeLabel(data.supplier_type))}`,
    '',
    'Теперь вы можете выделить этому поставщику квоту номерного фонда.',
  ].join('\n');
}

async function notifyHotelOwnerSupplierLinked({ hotelId, supplierProviderId, db = pool }) {
  const { rows } = await db.query(
    `SELECT h.id AS hotel_id,h.name AS hotel_name,h.provider_id AS owner_id,
            owner.telegram_web_chat_id,owner.telegram_chat_id,owner.tg_chat_id,
            supplier.id AS supplier_id,supplier.name AS supplier_name,supplier.type AS supplier_type
       FROM hotels h
       JOIN providers owner ON owner.id=h.provider_id
       JOIN providers supplier ON supplier.id=$2
      WHERE h.id=$1
      LIMIT 1`,
    [hotelId, supplierProviderId]
  );
  const data = rows[0];
  if (!data) return { ok: false, reason: 'hotel_owner_or_supplier_missing' };
  if (Number(data.owner_id) === Number(data.supplier_id)) return { ok: false, reason: 'supplier_is_hotel_owner' };

  const chatId = data.telegram_web_chat_id || data.telegram_chat_id || data.tg_chat_id;
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!chatId) return { ok: false, reason: 'hotel_owner_main_chat_missing' };
  if (!token) return { ok: false, reason: 'main_bot_token_missing' };

  const ok = await tgSend(chatId, buildHotelSupplierLinkedText(data), {
    reply_markup: {
      inline_keyboard: [[{
        text: 'Управлять поставщиками и квотами',
        url: siteUrl(`/provider/hotels/${hotelId}/offer`),
      }]],
    },
  }, token);
  return { ok, chat_id: String(chatId), bot: 'main' };
}

module.exports = { buildHotelSupplierLinkedText, supplierTypeLabel, notifyHotelOwnerSupplierLinked };
