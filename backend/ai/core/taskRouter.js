// backend/ai/core/taskRouter.js

function extractRefusedCode(command) {
  const text = String(command || "");
  const match = text.match(/\bR\s*(\d{1,8})\b/i);
  if (!match) return null;
  return `R${match[1]}`;
}

function routeAiTask(command) {
  const text = String(command || "").trim();
  const lower = text.toLowerCase();
  const serviceCode = extractRefusedCode(text);

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
    scriptMode,
    variantSalt: scriptMode === "default" ? "" : text,
    confidence: serviceCode ? 0.92 : 0.55,
    source: "chat_command",
    rawCommand: text,
  };
}

module.exports = {
  extractRefusedCode,
  routeAiTask,
};
