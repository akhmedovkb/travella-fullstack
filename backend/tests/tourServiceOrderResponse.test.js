const test = require("node:test");
const assert = require("node:assert/strict");
const { actorMatchesProfile, profileChatId, inferSupplierDocumentType, normalizeSupplierAttachment } = require("../utils/tourServiceOrderResponse");

test("matches a supplier against every supported Telegram chat field", () => {
  assert.equal(actorMatchesProfile(123, { telegram_chat_id: "123" }), true);
  assert.equal(actorMatchesProfile("456", { telegram_refused_chat_id: 456 }), true);
  assert.equal(actorMatchesProfile(789, { tg_chat_id: "123" }), false);
  assert.equal(actorMatchesProfile(null, { telegram_chat_id: "123" }), false);
});

test("selects the highest-priority Telegram chat field", () => {
  assert.equal(profileChatId({ telegram_web_chat_id: 10, telegram_chat_id: 20 }), 10);
  assert.equal(profileChatId({ tg_chat_id: 30 }), 30);
  assert.equal(profileChatId({}), null);
});

test("normalizes supplier documents without exposing unsafe file names", () => {
  assert.deepEqual(normalizeSupplierAttachment({
    kind: "document", file_id: "abc", file_unique_id: "unique", file_name: "invoice\r\n.pdf", mime_type: "application/pdf", file_size: 1200, caption: "Invoice",
  }), {
    kind: "document", file_id: "abc", file_unique_id: "unique", file_name: "invoice  .pdf", mime_type: "application/pdf", file_size: 1200, caption: "Invoice", document_type: "invoice", review_status: "pending",
  });
});

test("classifies common supplier operational documents", () => {
  assert.equal(inferSupplierDocumentType({ file_name: "booking-confirmation.pdf" }), "confirmation");
  assert.equal(inferSupplierDocumentType({ caption: "Счёт на оплату" }), "invoice");
  assert.equal(inferSupplierDocumentType({ file_name: "hotel-voucher.pdf" }), "voucher");
  assert.equal(inferSupplierDocumentType({ file_name: "route.jpg" }), "other");
});

test("rejects missing and oversized supplier attachments", () => {
  assert.equal(normalizeSupplierAttachment({ file_size: 100 }), null);
  assert.equal(normalizeSupplierAttachment({ file_id: "abc", file_size: 20 * 1024 * 1024 + 1 }), null);
});
