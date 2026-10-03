const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdminText,
  buildProviderText,
} = require('../utils/hotelOfferModerationNotifications');

const offer = {
  id: 42,
  hotel_id: 7,
  provider_id: 11,
  hotel_name: 'Art & Spa <Hotel>',
  provider_name: 'Direct Rooms',
  valid_from: '2026-11-01',
  valid_to: '2026-12-31',
  rate_count: 2,
};

test('builds safe admin hotel moderation notification', () => {
  const text = buildAdminText(offer);
  assert.match(text, /Новое предложение отеля/);
  assert.match(text, /Art &amp; Spa &lt;Hotel&gt;/);
  assert.match(text, /Тарифов:<\/b> 2/);
});

test('includes rejection reason in provider notification', () => {
  const text = buildProviderText(offer, 'reject', 'Исправьте <цену> & период');
  assert.match(text, /отклонено/);
  assert.match(text, /Исправьте &lt;цену&gt; &amp; период/);
  assert.match(text, /отправьте его повторно/);
});

test('builds approval notification without rejection copy', () => {
  const text = buildProviderText(offer, 'approve');
  assert.match(text, /опубликовано/);
  assert.doesNotMatch(text, /Причина/);
});
