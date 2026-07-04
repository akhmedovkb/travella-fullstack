// backend/ai/videoOperator/videoOperator.prompt.js

function clean(value) {
  return String(value || "").trim();
}

function money(value, currency = "USD") {
  const raw = clean(value);
  if (!raw) return "";
  return `${raw} ${clean(currency) || "USD"}`.trim();
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
    price: money(input.price, input.currency || "USD"),
    flight: clean(input.flight),
    includes: clean(input.includes),
    supplier: clean(input.supplier),
    urgency: clean(input.urgency) || "места могут быстро уйти",
  };
}

function chooseHook(facts) {
  if (facts.price && facts.destination) {
    return `Горящий отказной тур в ${facts.destination} — цена уже зафиксирована.`;
  }
  if (facts.destination) {
    return `Есть срочный отказной вариант в ${facts.destination}.`;
  }
  return "Появилось новое горящее предложение от Travella.";
}

function buildVideoOperatorScript(input = {}) {
  const facts = buildTourFacts(input);
  const hook = chooseHook(facts);

  const lines = [
    hook,
    facts.code ? `Код предложения: ${facts.code}.` : "",
    facts.fromCity && facts.destination ? `Вылет из ${facts.fromCity}, направление — ${facts.destination}.` : "",
    facts.dates ? `Даты: ${facts.dates}.` : "",
    facts.hotel ? `Отель: ${facts.hotel}.` : "",
    facts.room ? `Номер: ${facts.room}.` : "",
    facts.meal ? `Питание: ${facts.meal}.` : "",
    facts.people ? `Размещение: ${facts.people}.` : "",
    facts.flight ? `Перелёт: ${facts.flight}.` : "",
    facts.includes ? `В пакет входит: ${facts.includes}.` : "",
    facts.price ? `Цена: ${facts.price}.` : "",
    `${facts.urgency}. Чтобы открыть контакты поставщика и забрать предложение, переходите в Travella.`,
  ].filter(Boolean);

  return {
    hook,
    script: lines.join(" ").replace(/\s+/g, " ").trim(),
    facts,
    style: {
      format: "vertical_short_video",
      aspectRatio: "9:16",
      tone: "urgent_sales_ru",
      targetDurationSec: 25,
    },
  };
}

module.exports = {
  buildVideoOperatorScript,
};
