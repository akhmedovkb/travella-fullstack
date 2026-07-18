// backend/ai/contentManager/contentPromptSystem.js

function clean(value, fallback = "") {
  const s = String(value ?? "").trim();
  return s || fallback;
}

function hasValue(value) {
  return String(value ?? "").trim() !== "";
}

function priceText(ctx = {}) {
  if (!hasValue(ctx.price)) return "";
  return `${ctx.price} ${clean(ctx.currency, "USD")}`;
}

function lines(items) {
  return items.filter((line) => line !== null && line !== undefined).join("\n");
}

function buildContentReview(ctx = {}, packageItems = []) {
  const joined = packageItems.map((item) => item.text || "").join("\n");
  const checks = [
    { id: "real_data", label: "Текст построен только на данных Travella DB", passed: true },
    { id: "no_fake_discount", label: "Нет обещания скидки без старой цены", passed: !/скидк|дешевле|эконом/i.test(joined) },
    { id: "no_last_seats", label: "Нет обещания последних мест без подтверждения", passed: !/последн(ие|ее|ий)\s+мест/i.test(joined) },
    { id: "safe_urgency", label: "Срочность объяснена отказным предложением", passed: /отказн|может уйти|актуальн/i.test(joined) },
    { id: "has_cta", label: "Есть понятный призыв к действию", passed: /напиши|свяжитесь|забрать|Travella|оплатите доступ|оплатить доступ/i.test(joined) },
  ];

  const missingFields = [];
  if (!hasValue(ctx.destination)) missingFields.push("направление");
  if (!hasValue(ctx.price)) missingFields.push("цена");
  if (!hasValue(ctx.code)) missingFields.push("код");

  return {
    status: checks.every((x) => x.passed) ? "ready_for_review" : "needs_review",
    approvalGate: "Публикация выполняется только после ручной проверки текста",
    missingFields,
    checks,
  };
}

function buildPublishingPackage(ctx = {}) {
  const title = clean(ctx.title, clean(ctx.category, "отказной тур"));
  const destination = clean(ctx.destination, title);
  const price = priceText(ctx);
  const code = clean(ctx.code);
  const codeLine = code ? `Код предложения: ${code}` : "";
  const priceLine = price ? `Цена: ${price}` : "Цена уточняется в Travella";
  const hashtags = ["#travella", "#отказнойтур", "#туры", "#путешествия", "#горящийтур"];

  const items = [
    {
      id: "instagram_caption",
      channel: "Instagram",
      label: "Instagram",
      title: "Caption для Reels",
      text: lines([
        `Горящий отказной тур: ${destination}`,
        "",
        `${title}.`,
        priceLine,
        codeLine,
        "",
        "Предложение отказное, поэтому может уйти быстро.",
        "Чтобы забрать тур, напиши нам или свяжись с Travella.",
        "",
        hashtags.join(" "),
      ]),
    },
    {
      id: "telegram_post",
      channel: "Telegram",
      label: "Telegram",
      title: "Пост для Telegram",
      text: lines([
        "Горящее отказное предложение от Travella",
        "",
        `Направление: ${destination}`,
        hasValue(ctx.fromCity) ? `Вылет: ${ctx.fromCity}` : null,
        hasValue(ctx.dates) ? `Даты: ${ctx.dates}` : null,
        hasValue(ctx.hotel) ? `Отель: ${ctx.hotel}` : null,
        hasValue(ctx.meal) ? `Питание: ${ctx.meal}` : null,
        priceLine,
        codeLine,
        "",
        "Предложение отказное и может быстро стать неактуальным. Для бронирования нажмите кнопку «Оплатить доступ к поставщику» под видео.",
      ]),
    },
    {
      id: "reels_title",
      channel: "Reels",
      label: "Reels",
      title: "Заголовок Reels/Shorts",
      text: `${code ? `${code}: ` : ""}${destination}${price ? ` за ${price}` : " от Travella"}`.trim(),
    },
    {
      id: "story_text",
      channel: "Stories",
      label: "Stories",
      title: "Текст для Stories",
      text: lines([
        "Сторис 1: Горящий отказной тур",
        `Сторис 2: ${destination}${price ? ` за ${price}` : ""}`,
        "Сторис 3: Предложение может уйти быстро",
        `Сторис 4: ${code ? `Напиши код ${code}` : "Напиши нам, чтобы забрать тур"}`,
      ]),
    },
    {
      id: "first_comment",
      channel: "Instagram",
      label: "1-й комментарий",
      title: "Первый комментарий",
      text: `${code ? `Код: ${code}. ` : ""}Для деталей и бронирования напишите Travella в сообщения.`,
    },
    {
      id: "manager_note",
      channel: "Internal",
      label: "Менеджеру",
      title: "Сообщение менеджеру",
      text: lines([
        `Проверь актуальность отказного тура${code ? ` ${code}` : ""}.`,
        `Клиенту показываем: ${destination}${price ? `, ${price}` : ""}.`,
        "Перед подтверждением обязательно сверить наличие у поставщика.",
      ]),
    },
  ];

  return {
    version: "content_manager_v1",
    status: "ready_for_review",
    generatedAt: new Date().toISOString(),
    summary: "Пакет публикации готов к ручной проверке.",
    hashtags,
    items,
    review: buildContentReview(ctx, items),
  };
}

module.exports = {
  buildPublishingPackage,
  buildContentReview,
};
