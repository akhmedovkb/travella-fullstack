// backend/ai/core/taskRouter.js

function extractServiceCode(command) {
  const text = String(command || "");
  const match = text.match(/\b([RAHE])\s*(\d{1,8})\b/i);
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2]}`;
}

function inferServiceCategoryFilters(command, serviceCode = "") {
  const text = String(command || "").toLowerCase();
  const prefix = String(serviceCode || "").slice(0, 1).toUpperCase();
  if (prefix === "A" || /авиа|авиабилет|билет\s+на\s+самол[её]т|перел[её]т|flight/i.test(text)) {
    return ["refused_flight"];
  }
  if (prefix === "H" || /отел|гостиниц|hotel/i.test(text)) {
    return ["refused_hotel"];
  }
  if (prefix === "E" || /мероприят|событи|концерт|ивент|event/i.test(text)) {
    return ["refused_event_ticket", "refused_ticket"];
  }
  if (/тур|пакет|направлен|tour/i.test(text)) {
    return ["refused_tour", "author_tour"];
  }
  return [];
}

function routeAiTask(command) {
  const text = String(command || "").trim();
  const lower = text.toLowerCase();
  const serviceCode = extractServiceCode(text);
  const categoryFilters = inferServiceCategoryFilters(text, serviceCode);

  let employeeId = "video_operator";
  let action = "prepare_script";

  if (/видео|video|reels|рилс|heygen|аватар/i.test(lower)) action = "prepare_video";
  if (/сценар|script|текст|caption|кэпшн/i.test(lower)) action = "prepare_script";
  if (/instagram|инстаграм|reels|рилс/i.test(lower)) action = "prepare_video";

  const scriptMode = /короч|25\s*сек|short/i.test(lower)
    ? "short"
    : /агрессив|ж[её]стч|продающ|стример|live/i.test(lower)
      ? "aggressive"
      : /друг(ой|ие|ая)|передел|reroll|hook|хук/i.test(lower)
        ? "reroll"
        : "default";

  return {
    employeeId,
    action,
    serviceCode,
    categoryFilters,
    scriptMode,
    variantSalt: scriptMode === "default" ? "" : text,
    confidence: serviceCode ? 0.92 : 0.55,
    source: "chat_command",
    rawCommand: text,
  };
}

module.exports = {
  extractRefusedCode: extractServiceCode,
  extractServiceCode,
  inferServiceCategoryFilters,
  routeAiTask,
};
