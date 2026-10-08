const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildHotelOwnershipReviewedText,
  buildHotelOwnershipSubmittedText,
} = require('../utils/hotelOwnershipNotifications');

test('builds ownership approval notification', () => {
  const text = buildHotelOwnershipReviewedText({ hotel_id: 277, hotel_name: 'JAZ & Bay' }, 'approve');
  assert.match(text, /Владение отелем подтверждено/);
  assert.match(text, /JAZ &amp; Bay/);
  assert.match(text, /Мои отели/);
});

test('builds ownership rejection notification with escaped reason', () => {
  const text = buildHotelOwnershipReviewedText({ hotel_id: 277, hotel_name: 'JAZ Bay' }, 'reject', 'Нет документа <PDF>');
  assert.match(text, /отклонена/);
  assert.match(text, /Нет документа &lt;PDF&gt;/);
  assert.match(text, /повторно/);
});

test('builds an admin notification for a new ownership claim', () => {
  const text = buildHotelOwnershipSubmittedText({
    hotel_id: 69,
    hotel_name: 'Art & Air',
    hotel_city: 'Tashkent',
    provider_id: 1584,
    provider_name: 'Hotels <Chain>',
  }, { note: 'Call +998 <test>' });
  assert.match(text, /Новая заявка/);
  assert.match(text, /Art &amp; Air/);
  assert.match(text, /Hotels &lt;Chain&gt;/);
  assert.match(text, /Call \+998 &lt;test&gt;/);
});

test('labels a resubmitted ownership claim', () => {
  const text = buildHotelOwnershipSubmittedText({
    hotel_id: 69,
    hotel_name: 'Art Air',
    provider_id: 1584,
    provider_name: 'Hotels Chain',
  }, { resubmitted: true });
  assert.match(text, /отправлена повторно/);
});
