const test = require('node:test');
const assert = require('node:assert/strict');
const { buildHotelSupplierLinkedText, supplierTypeLabel } = require('../utils/hotelSupplierLinkNotifications');

test('labels common hotel supplier types for owners', () => {
  assert.equal(supplierTypeLabel('agent'), 'Турагент');
  assert.equal(supplierTypeLabel('tour_operator'), 'Туроператор');
  assert.equal(supplierTypeLabel('dmc'), 'DMC');
});

test('builds safe notification for the hotel owner', () => {
  const text = buildHotelSupplierLinkedText({
    hotel_id: 24,
    hotel_name: 'Art & Air',
    supplier_id: 1587,
    supplier_name: '<Travel Partner>',
    supplier_type: 'agency',
  });
  assert.match(text, /Новый поставщик добавил ваш отель/);
  assert.match(text, /Art &amp; Air/);
  assert.match(text, /&lt;Travel Partner&gt;/);
  assert.match(text, /Агентство/);
  assert.match(text, /выделить.*квоту/);
});
