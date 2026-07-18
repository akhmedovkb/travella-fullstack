// backend/ai/videoOperator/videoOperator.prompt.js
// Legacy adapter: keep older service paths on the same spoken-friendly script system.

const {
  buildHook,
  buildScript,
  buildMotionPrompt,
  buildScriptReview,
} = require("./videoPromptSystem");

function clean(value) {
  return String(value || "").trim();
}

function buildTourFacts(input = {}) {
  return {
    title: clean(input.title) || "отказной тур",
    code: clean(input.code),
    fromCity: clean(input.fromCity) || "Ташкент",
    destination: clean(input.destination),
    dates: clean(input.dates),
    hotel: clean(input.hotel),
    room: clean(input.room),
    meal: clean(input.meal),
    people: clean(input.people) || "2 человека",
    price: clean(input.price),
    currency: clean(input.currency) || "USD",
    flight: clean(input.flight),
    includes: clean(input.includes),
    supplier: clean(input.supplier),
    urgency: clean(input.urgency) || "Это отказной тур, поэтому предложение может уйти в любой момент",
  };
}

function buildVideoOperatorScript(input = {}) {
  const facts = buildTourFacts(input);
  const hook = buildHook(facts);
  const script = buildScript(facts);
  const motionPrompt = buildMotionPrompt(facts);

  return {
    hook,
    script,
    motionPrompt,
    facts,
    scriptReview: buildScriptReview(facts, script),
    style: {
      format: "vertical_short_video",
      aspectRatio: "9:16",
      tone: "spoken_sales_ru",
      targetDurationSec: 25,
    },
  };
}

module.exports = {
  buildVideoOperatorScript,
};
