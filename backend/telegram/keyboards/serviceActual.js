// backend/telegram/keyboards/serviceActual.js

function buildSvcActualKeyboard(serviceId, opts = {}) {
  const id = Number(serviceId);
  const safeId = Number.isFinite(id) ? id : 0;

  return {
    inline_keyboard: [
      [
        { text: "✅ Да, актуален", callback_data: `svc_actual:${safeId}:yes` },
        { text: "❌ Нет, снять", callback_data: `svc_actual:${safeId}:no` },
      ],
      [
        // На всякий случай — “обновить” (переотобразить)
        { text: "🔄 Проверить", callback_data: `svc_actual:${safeId}:ping` },
      ],
    ],
  };
}

function buildSvcActualDoneKeyboard(serviceId, kind = "yes") {
  const id = Number(serviceId);
  const safeId = Number.isFinite(id) ? id : 0;

  if (kind === "no") {
    return {
      inline_keyboard: [[{ text: "❌ Снято (неактуально)", callback_data: `noop:${safeId}` }]],
    };
  }
  return {
    inline_keyboard: [[{ text: "✅ Подтверждено (актуально)", callback_data: `noop:${safeId}` }]],
  };
}

module.exports = {
  buildSvcActualKeyboard,
  buildSvcActualDoneKeyboard,
};
