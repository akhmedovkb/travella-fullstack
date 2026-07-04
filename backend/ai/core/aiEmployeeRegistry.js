// backend/ai/core/aiEmployeeRegistry.js

const { getAiConfig } = require("./aiConfig");

const AI_EMPLOYEES = [
  {
    id: "video_operator",
    name: "Travella Video Operator",
    department: "Marketing",
    version: "1.0.0",
    status: "beta",
    mission:
      "Получает данные отказного тура, пишет короткий продающий сценарий и запускает AI-аватар HeyGen для создания вертикального видео.",
    capabilities: [
      "Сценарий для отказного тура",
      "Хук для первых 3 секунд",
      "Вертикальный формат 9:16",
      "Подготовка текста для AI-аватара",
      "Запуск HeyGen video generation",
    ],
  },
];

function listAiEmployees() {
  const config = getAiConfig();
  return AI_EMPLOYEES.map((employee) => ({
    ...employee,
    enabled: employee.id === "video_operator" ? Boolean(config.video.enabled) : false,
    ready: employee.id === "video_operator" ? Boolean(config.video.enabled && config.video.heygen.ready) : false,
  }));
}

function getAiEmployee(id) {
  return listAiEmployees().find((employee) => employee.id === id) || null;
}

module.exports = {
  listAiEmployees,
  getAiEmployee,
};
