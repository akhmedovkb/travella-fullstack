// backend/ai/core/aiEmployeeRegistry.js

const { getAiConfig } = require("./aiConfig");

const AI_EMPLOYEES = [
  {
    id: "video_operator",
    name: "Travella Video Operator",
    department: "Marketing",
    version: "1.1.0",
    status: "beta",
    mission:
      "Получает задачу обычным языком, находит отказной тур в базе Travella, анализирует оффер и готовит сценарий/видео.",
    capabilities: [
      "Поиск реального отказного тура по R-коду",
      "Анализ оффера и срочности",
      "Хук для первых 3 секунд",
      "Текст для AI-аватара",
      "Подготовка к HeyGen video generation",
    ],
  },
];

function listAiEmployees() {
  const config = getAiConfig();
  return AI_EMPLOYEES.map((employee) => ({
    ...employee,
    enabled: employee.id === "video_operator" ? Boolean(config.video.enabled) : false,
    ready:
      employee.id === "video_operator"
        ? Boolean(config.video.enabled && config.video.heygen.ready)
        : false,
  }));
}

function getAiEmployee(id) {
  return listAiEmployees().find((employee) => employee.id === id) || null;
}

module.exports = { AI_EMPLOYEES, listAiEmployees, getAiEmployee };
