const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHotelCreatedByProviderText } = require('../utils/hotelCreationNotifications');

test('builds an escaped admin notification for a provider-created hotel', () => {
  const text = buildHotelCreatedByProviderText({
    hotel_id: 42,
    hotel_name: 'Art & Air <Hotel>',
    hotel_city: 'Tashkent',
    provider_id: 9,
    provider_name: 'Hotels Chain',
    provider_type: 'hotel',
    provider_phone: '+998901234567',
    provider_email: 'hotel@example.com',
    provider_address: 'Tashkent',
    hotel_country: 'Uzbekistan',
    hotel_address: 'Hotel street 1',
    hotel_contact: '+998909999999',
  });

  assert.match(text, /Новая карточка отеля ожидает проверки/);
  assert.match(text, /Art &amp; Air &lt;Hotel&gt;/);
  assert.match(text, /Tashkent/);
  assert.match(text, /Hotels Chain/);
  assert.match(text, /ID поставщика:<\/b> #9/);
  assert.match(text, /\+998901234567/);
  assert.match(text, /hotel@example\.com/);
  assert.match(text, /Hotel street 1/);
  assert.match(text, /Карточка:<\/b> #42/);
});
