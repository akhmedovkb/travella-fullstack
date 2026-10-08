const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHotelIdentityPart, areLikelySameHotel } = require('../utils/hotelIdentity');

test('normalizes punctuation, case and a trailing star rating', () => {
  assert.equal(normalizeHotelIdentityPart('  JAZ Neo Sharks Bay 4* ', { stripRating: true }), 'jazneosharksbay');
  assert.equal(normalizeHotelIdentityPart('Jaz-Neo Sharks Bay'), 'jazneosharksbay');
});

test('recognizes the same hotel in the same city', () => {
  assert.equal(areLikelySameHotel(
    { name: 'JAZ Neo Sharks Bay 4*', city: 'Sharm el-Sheikh', country: 'Egypt' },
    { name: 'Jaz Neo Sharks Bay', city: 'Sharm el Sheikh', country: 'Egypt' }
  ), true);
});

test('does not merge hotels with the same name in different cities', () => {
  assert.equal(areLikelySameHotel(
    { name: 'Grand Hotel', city: 'Tashkent', country: 'Uzbekistan' },
    { name: 'Grand Hotel', city: 'Samarkand', country: 'Uzbekistan' }
  ), false);
});

test('uses an exact normalized address when a city spelling differs', () => {
  assert.equal(areLikelySameHotel(
    { name: 'Art Air', city: 'Tashkent', address: 'ул. Хакикат, 25' },
    { name: 'ART AIR', city: 'Ташкент', address: 'ул Хакикат 25' }
  ), true);
});
