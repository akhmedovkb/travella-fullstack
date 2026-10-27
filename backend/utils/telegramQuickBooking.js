const ACTIVE_BOOKING_STATUSES = new Set(["pending", "quoted", "awaiting_payment", "confirmed"]);

function parseBookingDate(value) {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const local = text.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  const normalized = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : local
      ? `${local[3]}-${local[2]}-${local[1]}`
      : null;
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) return null;
  return normalized;
}

function parseGuestCount(value) {
  const count = Number(String(value || "").trim());
  return Number.isInteger(count) && count >= 1 && count <= 100 ? count : null;
}

function parseBookingAmount(value) {
  const normalized = String(value || "").replace(/[\s,]/g, "").trim();
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000 ? Math.round(amount) : null;
}

function telegramBookingStatusLabel(status) {
  const labels = {
    pending: "Ожидает ответа поставщика",
    quoted: "Ожидает подтверждения клиента",
    awaiting_payment: "Ожидает оплаты клиентом",
    confirmed: "Подтверждена",
    paid: "Оплачена",
    completed: "Завершена",
    rejected: "Отклонена",
    cancelled: "Отменена",
    cancelled_unpaid: "Отменена: истёк срок оплаты",
    expired: "Истекла",
  };
  return labels[String(status || "").toLowerCase()] || String(status || "Неизвестно");
}

function isActiveBookingStatus(status) {
  return ACTIVE_BOOKING_STATUSES.has(String(status || "").toLowerCase());
}

module.exports = {
  parseBookingDate,
  parseGuestCount,
  parseBookingAmount,
  telegramBookingStatusLabel,
  isActiveBookingStatus,
};
