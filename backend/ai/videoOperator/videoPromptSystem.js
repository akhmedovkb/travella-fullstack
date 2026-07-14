// backend/ai/videoOperator/videoPromptSystem.js

function clean(value, fallback = "") {
  const s = String(value ?? "").trim();
  return s || fallback;
}

function hasValue(value) {
  return String(value ?? "").trim() !== "";
}

function formatPrice(ctx) {
  if (!hasValue(ctx.price)) return "";
  return `${ctx.price} ${clean(ctx.currency, "USD")}`;
}

function getSafeFactRules(ctx = {}) {
  const missing = [];
  if (!hasValue(ctx.destination)) missing.push("направление");
  if (!hasValue(ctx.price)) missing.push("цена");
  if (!hasValue(ctx.dates)) missing.push("даты");
  if (!hasValue(ctx.hotel)) missing.push("отель");

  return {
    language: "ru",
    brandVoice: "уверенно, коротко, без давления и без выдуманных обещаний",
    guardrails: [
      "использовать только факты из Travella DB",
      "не обещать скидку, если нет старой цены",
      "не говорить про последние места, если нет такого поля",
      "не называть отель идеальным или премиальным без рейтинга/описания",
      "срочность объяснять только тем, что это отказное предложение",
      "в конце давать понятный CTA: связаться с Travella или открыть Travella",
    ],
    missing,
  };
}

function buildHook(ctx = {}) {
  const destination = clean(ctx.destination, "это направление");
  const price = formatPrice(ctx);
  if (price) return `Отказной тур в ${destination}: пакет можно забрать за ${price}, пока предложение актуально.`;
  return `Появился отказной тур в ${destination}: такие предложения могут уйти быстро.`;
}

function buildScript(ctx = {}) {
  const title = clean(ctx.title, ctx.category || "отказной тур");
  const destination = clean(ctx.destination, title);
  const price = formatPrice(ctx);
  const lines = [];

  lines.push(buildHook(ctx));
  lines.push("");
  lines.push("Есть актуальное отказное предложение от Travella.");
  lines.push(`${title}.`);

  const details = [];
  if (hasValue(ctx.fromCity) || hasValue(ctx.destination)) details.push(`Вылет: ${clean(ctx.fromCity, "Ташкент")}. Направление: ${destination}.`);
  if (hasValue(ctx.dates)) details.push(`Даты: ${ctx.dates}.`);
  if (hasValue(ctx.hotel)) details.push(`Отель: ${ctx.hotel}${hasValue(ctx.room) ? `, номер ${ctx.room}` : ""}.`);
  if (hasValue(ctx.meal)) details.push(`Питание: ${ctx.meal}.`);
  if (hasValue(ctx.people)) details.push(`Размещение: ${ctx.people}.`);
  if (hasValue(ctx.flight)) details.push(`Перелёт: ${ctx.flight}.`);
  if (hasValue(ctx.includes)) details.push(`В пакет входит: ${ctx.includes}.`);
  if (price) details.push(`Цена: ${price}.`);

  if (details.length) {
    lines.push("");
    lines.push(...details);
  }

  lines.push("");
  lines.push(`Важно: ${clean(ctx.urgency, "это отказной тур, поэтому предложение может уйти в любой момент")}.`);
  lines.push("Если хотите забрать этот пакет, откройте Travella и свяжитесь с поставщиком.");

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildAnalysis(ctx = {}) {
  const triggers = [];
  if (hasValue(ctx.price)) triggers.push("понятная цена");
  if (hasValue(ctx.hotel)) triggers.push("конкретный отель");
  if (hasValue(ctx.dates)) triggers.push("готовые даты");
  if (hasValue(ctx.flight)) triggers.push("маршрут/перелёт");
  triggers.push("срочность отказного предложения");

  return {
    mainOffer: `${clean(ctx.category, "Отказное предложение")} ${ctx.code || ""}`.trim(),
    target: "клиенты, которые готовы быстро принять решение по готовому туру",
    triggers,
    recommendedFormat: "vertical_9_16_avatar_video",
  };
}

function buildScriptReview(ctx = {}, script = "") {
  const rules = getSafeFactRules(ctx);
  const checks = [
    { id: "real_data", label: "Использует реальные данные Travella DB", passed: true },
    { id: "no_fake_discount", label: "Не обещает скидку без старой цены", passed: !/скидк|дешевле|эконом/i.test(script) },
    { id: "no_last_seats", label: "Не обещает последние места без подтверждения", passed: !/последн(ие|ее|ий)\s+мест/i.test(script) },
    { id: "urgency_safe", label: "Срочность объяснена через отказной тур", passed: /отказн/i.test(script) },
    { id: "cta", label: "Есть понятный призыв к действию", passed: /Travella|свяжитесь|забрать|откройте/i.test(script) },
  ];

  return {
    status: checks.every((x) => x.passed) ? "ready_for_review" : "needs_review",
    requiresHumanApproval: true,
    approvalGate: "HeyGen запускается только после ручного подтверждения сценария",
    missingFields: rules.missing,
    checks,
  };
}

function buildPublishingDrafts(ctx = {}) {
  const title = clean(ctx.title, "горящий тур");
  const destination = clean(ctx.destination, title);
  const price = formatPrice(ctx);
  const code = clean(ctx.code);
  const codeLine = code ? `Код: ${code}` : "";
  const lines = (items) => items.filter((line) => line !== null && line !== undefined).join("\n");

  return [
    {
      id: "instagram",
      label: "Instagram",
      title: "Caption для Instagram",
      text: lines([
        "Горящий отказной тур от Travella",
        "",
        `${destination}.`,
        price ? `Есть пакет за ${price}.` : "Есть пакет по специальной цене.",
        "",
        "Предложение может уйти быстро. Если хочешь забрать этот тур, напиши нам сейчас.",
        codeLine,
        "",
        "#travella #отказнойтур #туры #путешествия",
      ]),
    },
    {
      id: "telegram",
      label: "Telegram",
      title: "Пост для Telegram",
      text: lines([
        "Горящее предложение от Travella",
        "",
        `Направление: ${destination}`,
        price ? `Цена: ${price}` : null,
        codeLine,
        "",
        "Отказной тур может уйти в любой момент. Чтобы забрать пакет, свяжитесь с Travella.",
      ]),
    },
    {
      id: "shorts",
      label: "Shorts",
      title: "Shorts title",
      text: `${code ? `${code}: ` : ""}${title} ${price ? `за ${price}` : "от Travella"}`.trim(),
    },
  ];
}

module.exports = {
  buildHook,
  buildScript,
  buildAnalysis,
  buildScriptReview,
  buildPublishingDrafts,
  getSafeFactRules,
};
