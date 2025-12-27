// backend/telegram/keyboards/serviceActual.js

function buildSvcActualKeyboard(serviceId, opts = {}) {
  const id = Number(serviceId);

  return {
    inline_keyboard: [
      [
        { text: "✅ Да, актуален", callback_data: `svc_actual:${id}:yes` },
        { text: "⛔ Нет, снять", callback_data: `svc_actual:${id}:no` },
      ],
      [{ text: "🌿 Продлить на 7 дней", callback_data: `svc_actual:${id}:extend7` }],
    ],
  };
}

function buildSvcActualDoneKeyboard(statusText = "✅ Подтверждено") {
  return {
    inline_keyboard: [[{ text: statusText, callback_data: "noop" }]],
  };
}

module.exports = { buildSvcActualKeyboard, buildSvcActualDoneKeyboard };
