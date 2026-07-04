// backend/ai/core/aiRuntime.js
// Travella AI Runtime: единая точка исполнения задач AI OS.

const { routeAiTask } = require("./taskRouter");
const { runVideoOperatorTask } = require("../videoOperator/videoOperator.runtime");

function normalizeCommand(command) {
  return String(command || "").trim();
}

async function runAiRuntime({ command, employeeId = "auto", actor = {} }) {
  const text = normalizeCommand(command);
  if (!text) {
    return {
      success: false,
      error: { code: "COMMAND_REQUIRED", message: "Напиши задачу для AI-сотрудника." },
    };
  }

  const route = routeAiTask(text);
  const resolvedEmployeeId = employeeId === "auto" ? route.employeeId : employeeId;

  if (resolvedEmployeeId !== "video_operator") {
    return {
      success: false,
      error: {
        code: "EMPLOYEE_NOT_AVAILABLE",
        message: "Сейчас подключён только Travella Video Operator. Остальные сотрудники будут добавлены позже.",
      },
      route,
    };
  }

  return runVideoOperatorTask({ command: text, actor, runtimeRoute: route });
}

module.exports = {
  runAiRuntime,
};
