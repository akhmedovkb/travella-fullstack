function sanitizeTelegramText(value) {
  const input = String(value ?? '');
  let output = '';

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += input[index] + input[index + 1];
        index += 1;
      } else {
        output += '\ufffd';
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      output += '\ufffd';
      continue;
    }
    // Telegram accepts tabs/newlines, but rejects several raw control bytes.
    if ((code >= 0x00 && code <= 0x08) || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) {
      output += ' ';
      continue;
    }
    output += input[index];
  }

  return output;
}

function sanitizeTelegramMarkup(value) {
  if (typeof value === 'string') return sanitizeTelegramText(value);
  if (Array.isArray(value)) return value.map(sanitizeTelegramMarkup);
  if (!value || typeof value !== 'object') return value;

  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = sanitizeTelegramMarkup(item);
  return result;
}

function sanitizeTelegramMethodArgs(name, args) {
  const next = [...args];
  const textFirst = new Set(['ctx.reply', 'ctx.editMessageText', 'ctx.editMessageCaption', 'ctx.answerCbQuery']);
  if (textFirst.has(name) && typeof next[0] === 'string') next[0] = sanitizeTelegramText(next[0]);

  for (let index = 0; index < next.length; index += 1) {
    const item = next[index];
    if (!item || typeof item !== 'object' || Buffer.isBuffer(item)) continue;
    if (typeof item.caption === 'string') item.caption = sanitizeTelegramText(item.caption);
    if (item.reply_markup) item.reply_markup = sanitizeTelegramMarkup(item.reply_markup);
    if (name === 'ctx.editMessageReplyMarkup' && index === 0) next[index] = sanitizeTelegramMarkup(item);
  }
  return next;
}

module.exports = { sanitizeTelegramText, sanitizeTelegramMarkup, sanitizeTelegramMethodArgs };
