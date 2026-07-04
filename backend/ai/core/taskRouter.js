// backend/ai/core/taskRouter.js

function extractRefusedCode(command) {
  const match = String(command || "").match(/\bR\s*(\d{1,8})\b/i);
  if (!match) return null;
  return `R${match[1]}`.toUpperCase();
}

function routeAiTask(command) {
  const text = String(command || "").trim();
  const lower = text.toLowerCase();
  const code = extractRefusedCode(text);

  const wantsVideo = /видео|video|reels|рилс|ролик/.test(lower);
  const wantsScript = /сценар|script|текст|хук|hook/.test(lower);

  return {
    employeeId: "video_operator",
    action: wantsVideo ? "prepare_video" : wantsScript ? "create_script" : "create_script",
    serviceCode: code,
    confidence: code ? 0.92 : 0.55,
  };
}

module.exports = { routeAiTask, extractRefusedCode };
