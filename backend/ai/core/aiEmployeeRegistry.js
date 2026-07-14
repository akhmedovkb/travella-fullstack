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
  {
    id: "content_manager",
    name: "Travella Content Manager",
    department: "Marketing",
    version: "1.0.0",
    status: "beta",
    mission:
      "Готовит публикационный пакет для готовых AI-видео: captions, Telegram-посты, сторис, комментарии и заметки менеджеру.",
    capabilities: [
      "Caption для Instagram Reels",
      "Пост для Telegram",
      "Заголовок Shorts/Reels",
      "Текст для Stories",
      "Первый комментарий",
      "Проверка текста перед публикацией",
    ],
  },
  {
    id: "publishing_manager",
    name: "Travella Publishing Manager",
    department: "Marketing",
    version: "0.1.0",
    status: "beta",
    mission:
      "Ведёт ручную очередь публикаций: каналы, плановые даты, ссылки на опубликованные посты и общий статус размещения.",
    capabilities: [
      "Очередь утверждённых публикационных пакетов",
      "Планирование каналов публикации",
      "Отметка ручной публикации",
      "Хранение ссылок на опубликованные посты",
      "Контроль статусов публикации",
    ],
  },
];

function listAiEmployees() {
  const config = getAiConfig();
  return AI_EMPLOYEES.map((employee) => ({
    ...employee,
    enabled: employee.id === "video_operator" ? Boolean(config.video.enabled) : ["content_manager", "publishing_manager"].includes(employee.id),
    ready:
      employee.id === "video_operator"
        ? Boolean(config.video.enabled && config.video.heygen.ready)
        : ["content_manager", "publishing_manager"].includes(employee.id),
  }));
}

function getAiEmployee(id) {
  return listAiEmployees().find((employee) => employee.id === id) || null;
}

module.exports = { AI_EMPLOYEES, listAiEmployees, getAiEmployee };
