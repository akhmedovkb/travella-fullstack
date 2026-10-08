const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInspectionSubmittedText, buildInspectionReviewedText } = require('../utils/hotelInspectionNotifications');

test('builds inspection resubmission notification for admins', () => {
  const text = buildInspectionSubmittedText({ id: 7, hotel_id: 2, hotel_name: 'Art & Air', author_name: 'Agency' }, true);
  assert.match(text, /отправлена повторно/);
  assert.match(text, /Art &amp; Air/);
  assert.match(text, /Инспекция:<\/b> #7/);
});

test('builds inspection rejection notification for provider', () => {
  const text = buildInspectionReviewedText({ id: 7, hotel_id: 2, hotel_name: 'Art Air' }, 'rejected', 'Добавьте фото <лобби>');
  assert.match(text, /отклонена/);
  assert.match(text, /Добавьте фото &lt;лобби&gt;/);
  assert.match(text, /Мои инспекции/);
});
