process.env.AI_VIDEO_ENABLED = "false";
process.env.AI_JOB_STORE_DB_ENABLED = "false";

const {
  createScriptFromManualContext,
  startHeygenForVideoJob,
} = require("../ai/videoOperator/videoOperator.runtime");

async function main() {
  const scriptResult = await createScriptFromManualContext({
    code: "R857",
    title: "Local smoke refused tour",
    category: "Отказной тур",
    fromCity: "Ташкент",
    destination: "Анталия",
    dates: "12-18 июля",
    hotel: "Smoke Resort",
    meal: "All inclusive",
    people: "2 взрослых",
    price: "599",
    currency: "USD",
    urgency: "тестовая задача, не публиковать",
  });

  if (!scriptResult.success) throw new Error("Script generation failed");
  if (!scriptResult.job?.id) throw new Error("Job id was not created");
  if (!scriptResult.output?.hook) throw new Error("Hook was not created");
  if (!scriptResult.output?.script) throw new Error("Script was not created");

  const heygenResult = await startHeygenForVideoJob({
    jobId: scriptResult.job.id,
    actor: { id: "local-smoke", role: "admin" },
  });

  if (heygenResult.success) {
    throw new Error("HeyGen started while AI_VIDEO_ENABLED=false");
  }

  const message = heygenResult.error?.message || "";
  if (!/disabled/i.test(message)) {
    throw new Error(`Unexpected HeyGen safety error: ${message}`);
  }

  console.log("AI Platform local smoke passed.");
  console.log(`Job: ${scriptResult.job.id}`);
  console.log(`Hook: ${scriptResult.output.hook}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
