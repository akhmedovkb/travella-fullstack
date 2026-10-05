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

function allocationChanged(before, after) {
  return ['provider_id', 'pool_id', 'date_from', 'date_to', 'allotment']
    .some((key) => String(before?.[key] ?? '') !== String(after?.[key] ?? ''));
}

function describe(row) {
  return [
    `<b>Номер:</b> ${esc(row.room_type || `#${row.pool_id}`)}`,
    `<b>Период:</b> ${esc(row.date_from)} → ${esc(row.date_to)}`,
    `<b>Выделено:</b> ${Number(row.allotment || 0)}`,
  ].join('\n');
}

function buildAllocationChanges(beforeRows = [], afterRows = []) {
  const before = new Map(beforeRows.map((row) => [Number(row.id), row]));
  const after = new Map(afterRows.map((row) => [Number(row.id), row]));
  const changes = [];

  for (const row of afterRows) {
    const previous = before.get(Number(row.id));
    if (!previous) changes.push({ type: 'created', row });
    else if (allocationChanged(previous, row)) changes.push({ type: 'updated', row, previous });
  }
  for (const row of beforeRows) {
    if (!after.has(Number(row.id))) changes.push({ type: 'deleted', row });
  }
  return changes;
}

function buildMessage(hotelName, change) {
  const titles = {
    created: '✅ <b>Вам выделена квота отеля</b>',
    updated: '🔄 <b>Квота отеля изменена</b>',
    deleted: '❌ <b>Квота отеля отозвана</b>',
  };
  const lines = [titles[change.type], '', `<b>Отель:</b> ${esc(hotelName)}`, describe(change.row)];
  if (change.type === 'updated' && change.previous) {
    lines.push('', '<b>Было:</b>', describe(change.previous));
  }
  return lines.join('\n');
}

async function notifyHotelAllocationChanges({ hotelId, hotelName, beforeRows, afterRows }) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return { sent: 0, skipped: true, reason: 'main_bot_token_missing' };

  const changes = buildAllocationChanges(beforeRows, afterRows);
  let sent = 0;
  for (const change of changes) {
    const chatId = change.row.telegram_web_chat_id || change.row.telegram_chat_id || change.row.tg_chat_id;
    if (!chatId) continue;
    const ok = await tgSend(chatId, buildMessage(hotelName || `#${hotelId}`, change), {
      reply_markup: {
        inline_keyboard: [[{
          text: 'Открыть отель',
          url: siteUrl(`/provider/hotels/${hotelId}/offer`),
        }]],
      },
    }, token);
    if (ok) sent += 1;
  }
  return { sent, changes: changes.length };
}

module.exports = { buildAllocationChanges, buildMessage, notifyHotelAllocationChanges };
