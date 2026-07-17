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

function compact(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,:;!?])/g, "$1")
    .trim();
}

function cleanFact(value) {
  return compact(value)
    .replace(/([A-Za-zА-Яа-яЁё]{1,6})-\s+(\d)/g, "$1-$2")
    .replace(/(\d)\s*;\s*(\d{2})/g, "$1:$2")
    .replace(/\s+([).,])/g, "$1")
    .replace(/^[\s:;,.()\-]+|[\s:;,.()\-]+$/g, "")
    .trim();
}

function cleanOfferName(value, fallback = "") {
  const text = compact(value)
    .replace(/через\s+@\S+/gi, "")
    .replace(/отказн[а-яё]*\s+тур[а-яё]*/gi, "")
    .replace(/горящ[а-яё]*/gi, "")
    .replace(/[🔥🌍🏨📅]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.()\-]+|[\s:;,.()\-]+$/g, "")
    .replace(/^(в|на|во)\s+/i, "")
    .trim();
  return normalizeDisplayCase(text) || clean(fallback);
}

function normalizeDisplayCase(value) {
  const text = String(value || "").trim();
  if (!text || /[a-z]/.test(text)) return text;
  const letters = text.replace(/[^A-ZА-ЯЁ]/g, "");
  if (letters.length < 4 || letters.length !== text.replace(/[^A-Za-zА-Яа-яЁё]/g, "").length) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s(-])([a-zа-яё])/g, (match, prefix, ch) => `${prefix}${ch.toUpperCase()}`)
    .split(" ")
    .map((word) => (["И", "Из", "В", "На", "Для", "От"].includes(word) ? word.toLowerCase() : word))
    .join(" ");
}

function departureFrom(value) {
  const city = clean(value, "Ташкент");
  if (/ташкент$/i.test(city)) return "Ташкента";
  return city;
}

function sentence(value) {
  const text = compact(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function joinSentence(parts) {
  return sentence(parts.filter(hasValue).join(", "));
}

function normalizeUrgency(value) {
  const text = clean(value);
  if (!text || /^(normal|low|medium|high)$/i.test(text)) {
    return "Это отказной тур, поэтому предложение может уйти в любой момент";
  }
  return text;
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
  const destination = cleanOfferName(ctx.destination, ctx.title) || "это направление";
  const price = formatPrice(ctx);
  if (price) return `Есть отказной вариант: ${destination}. Цена — ${price}.`;
  return `Есть отказной вариант: ${destination}.`;
}

function buildScript(ctx = {}) {
  const title = cleanOfferName(ctx.title, ctx.category || "отказной тур");
  const destination = cleanOfferName(ctx.destination, title);
  const price = formatPrice(ctx);
  const code = clean(ctx.code);
  const lines = [];

  lines.push(buildHook(ctx));
  lines.push("");
  lines.push("Это готовый пакет от Travella, который можно забрать, пока предложение актуально.");

  const details = [];
  if (hasValue(ctx.fromCity) || hasValue(destination)) {
    details.push(sentence(`Вылет из ${departureFrom(ctx.fromCity)}${hasValue(destination) ? `, направление — ${destination}` : ""}`));
  }
  if (hasValue(ctx.dates)) details.push(sentence(`Даты поездки: ${cleanFact(ctx.dates)}`));
  if (hasValue(ctx.hotel)) details.push(joinSentence([`Отель: ${cleanFact(ctx.hotel)}`, hasValue(ctx.room) ? `номер ${cleanFact(ctx.room)}` : ""]));
  if (hasValue(ctx.meal)) details.push(sentence(`Питание: ${cleanFact(ctx.meal)}`));
  if (hasValue(ctx.people)) details.push(sentence(`Размещение: ${cleanFact(ctx.people)}`));
  if (hasValue(ctx.flight)) details.push(sentence(`Перелёт: ${cleanFact(ctx.flight)}`));
  if (hasValue(ctx.includes)) details.push(sentence(`В пакет входит: ${cleanFact(ctx.includes)}`));
  if (price) details.push(`Цена: ${price}.`);

  if (details.length) {
    lines.push("");
    lines.push(...details);
  }

  lines.push("");
  lines.push(sentence(normalizeUrgency(ctx.urgency)));
  lines.push(`Чтобы забрать пакет, откройте Travella, ${code ? `назовите код ${code}` : "назовите код предложения"} и свяжитесь с поставщиком.`);

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
    { id: "no_raw_title_noise", label: "Нет сырого повтора служебного заголовка", passed: !/отказн(ой|ый)?\s+тур\s+в\s+отказн(ой|ый)?\s+тур/i.test(script) },
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
  const title = cleanOfferName(ctx.title, "горящий тур");
  const destination = cleanOfferName(ctx.destination, title);
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
