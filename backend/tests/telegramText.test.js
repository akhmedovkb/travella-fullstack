const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeTelegramText, sanitizeTelegramMethodArgs } = require('../utils/telegramText');

test('keeps valid Unicode and emoji intact', () => {
  assert.equal(sanitizeTelegramText('Отель \ud83c\udfe8\nТашкент'), 'Отель \ud83c\udfe8\nТашкент');
});

test('replaces unpaired UTF-16 surrogates', () => {
  assert.equal(sanitizeTelegramText(`до\ud83d после\udc00`), 'до\ufffd после\ufffd');
});

test('cleans text, caption and inline keyboard labels', () => {
  const args = sanitizeTelegramMethodArgs('ctx.editMessageText', [
    `Цена\ud83d`,
    { caption: `Фото\udc00`, reply_markup: { inline_keyboard: [[{ text: `Открыть\ud83d`, callback_data: 'open:1' }]] } },
  ]);
  assert.equal(args[0], 'Цена\ufffd');
  assert.equal(args[1].caption, 'Фото\ufffd');
  assert.equal(args[1].reply_markup.inline_keyboard[0][0].text, 'Открыть\ufffd');
});

test('replaces forbidden control bytes but preserves tab and newline', () => {
  assert.equal(sanitizeTelegramText('a\u0000b\tc\nd'), 'a b\tc\nd');
});
