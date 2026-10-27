const pool = require("../db");
const { ensureTelegramLearningSchema } = require("../services/telegramLearningService");

async function main() {
  await ensureTelegramLearningSchema(pool);
  console.log("[telegram-learning] schema and lessons are ready");
}

main()
  .catch((error) => {
    console.error("[telegram-learning] setup failed", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

