// backend/ai/core/aiEmployeeRegistry.js

const { getAiConfig } = require("./aiConfig");

const AI_EMPLOYEES = {
  video_operator: {
    id: "video_operator",
    name: "Travella Video Operator",
    version: "1.0.0",
    department: "marketing",
    description:
      "Creates short promotional videos for refused tours using script generation and HeyGen avatar video generation.",
  },
};

function listAiEmployees() {
  const config = getAiConfig();

  return Object.values(AI_EMPLOYEES).map((employee) => ({
    ...employee,
    enabled:
      employee.id === "video_operator"
        ? Boolean(config.video.enabled)
        : false,
  }));
}

function getAiEmployee(employeeId) {
  return AI_EMPLOYEES[employeeId] || null;
}

module.exports = {
  AI_EMPLOYEES,
  listAiEmployees,
  getAiEmployee,
};
