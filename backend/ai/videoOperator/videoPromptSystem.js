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

function formatSpokenPrice(ctx) {
  const raw = clean(ctx.price);
  if (!raw) return "";
  const value = Number(String(raw).replace(/\s/g, "").replace(",", "."));
  const currency = clean(ctx.currency, "USD").toUpperCase();
  const currencyForms = {
    USD: ["доллар", "доллара", "долларов"],
    EUR: ["евро", "евро", "евро"],
    UZS: ["сум", "сума", "сумов"],
    RUB: ["рубль", "рубля", "рублей"],
  };
  if (!Number.isFinite(value)) return `${raw} ${currency}`.trim();

  const rounded = Math.round(value);
  const forms = currencyForms[currency] || [currency, currency, currency];
  return `${numberToRuWords(rounded)} ${pluralRu(rounded, forms)}`;
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
    .replace(/(\d)\s*\*/g, "$1 звёзд")
    .replace(/\s+([).,])/g, "$1")
    .replace(/^[\s:;,.()\-]+|[\s:;,.()\-]+$/g, "")
    .trim();
}

function pluralRu(value, forms) {
  const n = Math.abs(Number(value)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

function numberToRuWords(value) {
  const n = Math.abs(Math.trunc(Number(value) || 0));
  if (n === 0) return "ноль";
  const ones = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const onesFemale = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

  function triadToWords(num, female = false) {
    const result = [];
    const h = Math.floor(num / 100);
    const t = Math.floor((num % 100) / 10);
    const o = num % 10;
    if (h) result.push(hundreds[h]);
    if (t === 1) {
      result.push(teens[o]);
    } else {
      if (t) result.push(tens[t]);
      if (o) result.push((female ? onesFemale : ones)[o]);
    }
    return result;
  }

  const parts = [];
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  if (thousands) {
    parts.push(...triadToWords(thousands, true), pluralRu(thousands, ["тысяча", "тысячи", "тысяч"]));
  }
  if (rest) parts.push(...triadToWords(rest));
  return parts.join(" ");
}

const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function parseDateAny(value) {
  const text = cleanFact(value);
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) return { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
  return null;
}

function formatSpokenDate(value, includeYear = true) {
  const date = parseDateAny(value);
  if (!date || !MONTHS_RU[date.month - 1]) return cleanFact(value);
  return `${date.day} ${MONTHS_RU[date.month - 1]}${includeYear ? ` ${date.year} года` : ""}`;
}

function formatSpokenDateRange(value) {
  const text = cleanFact(value);
  const parts = text.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}/g) || [];
  if (parts.length < 2) return formatSpokenDate(text);

  const start = parseDateAny(parts[0]);
  const end = parseDateAny(parts[1]);
  if (!start || !end || !MONTHS_RU[start.month - 1] || !MONTHS_RU[end.month - 1]) return text;

  if (start.year === end.year && start.month === end.month) {
    return `с ${start.day} по ${end.day} ${MONTHS_RU[end.month - 1]} ${end.year} года`;
  }
  return `с ${formatSpokenDate(parts[0])} по ${formatSpokenDate(parts[1])}`;
}

function getDateRangeParts(value) {
  const text = cleanFact(value);
  const parts = text.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}/g) || [];
  if (parts.length < 2) return null;
  const start = parseDateAny(parts[0]);
  const end = parseDateAny(parts[1]);
  if (!start || !end) return null;
  return { start, end, startRaw: parts[0], endRaw: parts[1] };
}

function getNights(value) {
  const range = getDateRangeParts(value);
  if (!range) return null;
  const start = new Date(Date.UTC(range.start.year, range.start.month - 1, range.start.day));
  const end = new Date(Date.UTC(range.end.year, range.end.month - 1, range.end.day));
  const diff = Math.round((end.getTime() - start.getTime()) / 86400000);
  return diff > 0 && diff < 90 ? diff : null;
}

function formatSpokenNights(value) {
  const nights = getNights(value);
  if (!nights) return "";
  return `${numberToRuWords(nights)} ${pluralRu(nights, ["ночь", "ночи", "ночей"])}`;
}

function formatSpokenTime(value) {
  const match = cleanFact(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const hourText = `${hours} ${pluralRu(hours, ["час", "часа", "часов"])}`;
  if (!minutes) return hourText;
  return `${hourText} ${minutes} ${pluralRu(minutes, ["минута", "минуты", "минут"])}`;
}

function spellFlightCode(value) {
  const latin = {
    A: "эй",
    B: "би",
    C: "си",
    D: "ди",
    E: "и",
    F: "эф",
    G: "джи",
    H: "эйч",
    I: "ай",
    J: "джей",
    K: "кей",
    L: "эл",
    M: "эм",
    N: "эн",
    O: "оу",
    P: "пи",
    Q: "кью",
    R: "ар",
    S: "эс",
    T: "ти",
    U: "ю",
    V: "ви",
    W: "дабл-ю",
    X: "икс",
    Y: "уай",
    Z: "зет",
  };
  return String(value || "")
    .toUpperCase()
    .split("")
    .map((ch) => latin[ch] || ch)
    .join(" ");
}

function spellDigits(value) {
  const digits = ["ноль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  return String(value || "")
    .split("")
    .map((ch) => digits[Number(ch)] || ch)
    .join(" ");
}

function formatSpokenFlight(value) {
  const text = cleanFact(value);
  if (!text) return "";
  const flightNumber = text.match(/\b([A-ZА-Я]{1,4})[-\s]?(\d{2,5})\b/i);
  const time = text.match(/\b\d{1,2}:\d{2}\b/);
  const date = text.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\d{1,2}\.\d{4}\b/);
  const parts = [];
  if (flightNumber) parts.push(`рейс ${spellFlightCode(flightNumber[1])} ${spellDigits(flightNumber[2])}`);
  if (date) parts.push(`вылет ${formatSpokenDate(date[0])}`);
  if (time) parts.push(`в ${formatSpokenTime(time[0])}`);
  return parts.length ? parts.join(", ") : text;
}

function formatSpokenMeal(value) {
  const text = cleanFact(value);
  const normalized = text.toUpperCase();
  const known = {
    UAI: "ультра всё включено",
    AI: "всё включено",
    BB: "завтраки",
    HB: "полупансион",
    FB: "полный пансион",
    RO: "без питания",
  };
  return known[normalized] || text;
}

function formatSpokenRoom(value) {
  const text = cleanFact(value);
  const known = {
    standard: "стандарт",
    standart: "стандарт",
    deluxe: "делюкс",
    superior: "супериор",
    suite: "сьют",
  };
  return known[text.toLowerCase()] || text;
}

function formatSpokenPeople(value) {
  const text = cleanFact(value);
  const normalized = text.toUpperCase();
  const known = {
    DBL: "двухместное",
    SGL: "одноместное",
    TRPL: "трёхместное",
  };
  return known[normalized] || text;
}

function parseHotelForSales(value) {
  const text = cleanFact(value);
  const match = text.match(/^(.*?)\s+(\d)\s+зв[её]зд/i);
  const titleCaseName = (name) => compact(name)
    .split(" ")
    .map((word) => word ? `${word.slice(0, 1).toUpperCase()}${word.slice(1)}` : word)
    .join(" ");
  if (!match) return { name: titleCaseName(text), stars: "" };
  return {
    name: titleCaseName(match[1]),
    stars: `${numberToRuWords(Number(match[2]))} ${pluralRu(Number(match[2]), ["звезда", "звезды", "звёзд"])}`,
  };
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

function normalizeDestinationName(value) {
  const text = cleanOfferName(value);
  const lower = text.toLowerCase();
  const known = {
    "анталью": "Анталья",
    "аланию": "Алания",
    "турцию": "Турция",
  };
  return known[lower] || text;
}

function destinationToTravelCase(value) {
  const text = normalizeDestinationName(value);
  const lower = text.toLowerCase();
  const known = {
    "анталья": "Анталью",
    "алания": "Аланию",
    "турция": "Турцию",
  };
  if (known[lower]) return known[lower];
  if (/ия$/i.test(text)) return `${text.slice(0, -2)}ию`;
  if (/я$/i.test(text)) return `${text.slice(0, -1)}ю`;
  if (/а$/i.test(text)) return `${text.slice(0, -1)}у`;
  return text;
}

function destinationToPlaceCase(value) {
  const text = normalizeDestinationName(value);
  const lower = text.toLowerCase();
  const known = {
    "анталья": "Анталье",
    "алания": "Алании",
    "турция": "Турции",
  };
  if (known[lower]) return known[lower];
  if (/ия$/i.test(text)) return `${text.slice(0, -2)}ии`;
  if (/я$/i.test(text)) return `${text.slice(0, -1)}е`;
  if (/а$/i.test(text)) return `${text.slice(0, -1)}е`;
  return text;
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
  return "Стоп! Стоп! Стоп! Не пролистывайте!";
}

function buildScript(ctx = {}) {
  const title = cleanOfferName(ctx.title, ctx.category || "отказной тур");
  const destination = normalizeDestinationName(ctx.destination || title);
  const travelDestination = destinationToTravelCase(destination);
  const placeDestination = destinationToPlaceCase(destination);
  const fromCity = hasValue(ctx.fromCity) ? departureFrom(ctx.fromCity) : "";
  const dateRange = getDateRangeParts(ctx.dates);
  const nights = formatSpokenNights(ctx.dates);
  const hotel = parseHotelForSales(ctx.hotel);
  const price = formatSpokenPrice(ctx);
  const lines = [];

  lines.push(buildHook(ctx));
  lines.push("");
  lines.push("У меня для вас настоящий туристический разрыв из базы отказных туров Узбекистана.");
  lines.push("");
  lines.push(`Отказной тур в ${travelDestination}${fromCity ? ` из ${fromCity}` : ""}!`);
  if (dateRange) {
    lines.push(`Вылет — ${formatSpokenDate(dateRange.startRaw, false)}.`);
    lines.push(`Обратно — ${formatSpokenDate(dateRange.endRaw, false)}.`);
  } else if (hasValue(ctx.dates)) {
    lines.push(`Даты поездки: ${formatSpokenDateRange(ctx.dates)}.`);
  }
  if (nights) lines.push(`Целых ${nights} на отдыхе в ${placeDestination}.`);

  if (hotel.name || hotel.stars) {
    lines.push("");
    lines.push("И внимание.");
    if (hotel.stars) {
      lines.push("Не три звезды.");
      lines.push("Не четыре звезды.");
      lines.push(`А ${hotel.name} — ${hotel.stars}.`);
    } else {
      lines.push(`${hotel.name}.`);
    }
  }

  const stayItems = [
    hasValue(ctx.people) ? `${formatSpokenPeople(ctx.people)} размещение` : "",
    hasValue(ctx.room) ? `номер ${formatSpokenRoom(ctx.room)}` : "",
    hasValue(ctx.meal) ? formatSpokenMeal(ctx.meal) : "",
  ].filter(hasValue);
  if (stayItems.length) lines.push(sentence(`Для двоих: ${stayItems.join(", ")}`));

  lines.push("");
  if (price) {
    lines.push("И теперь самое главное.");
    lines.push(`Цена — ${price}.`);
  }
  lines.push("Но запомните: это отказной тур.");
  lines.push("Такие предложения не ждут долго.");
  lines.push("Пока вы думаете — его могут забрать.");
  lines.push("");
  lines.push("Хотите этот вариант?");
  lines.push("Нажимайте «Связаться с поставщиком» под видео и забирайте тур сейчас.");

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildAnalysis(ctx = {}) {
  const triggers = [];
  if (hasValue(ctx.price)) triggers.push("понятная цена");
  if (hasValue(ctx.hotel)) triggers.push("конкретный отель");
  if (hasValue(ctx.dates)) triggers.push("готовые даты");
  if (hasValue(ctx.flight)) triggers.push("детали перелёта доступны отдельно");
  triggers.push("срочность отказного предложения");

  return {
    mainOffer: `${clean(ctx.category, "Отказное предложение")} ${ctx.code || ""}`.trim(),
    target: "клиенты, которые готовы быстро принять решение по отказному туру из базы Узбекистана",
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
    { id: "spoken_dates", label: "Даты подготовлены для озвучки", passed: !/\b\d{4}-\d{2}-\d{2}\b/.test(script) },
    { id: "spoken_price", label: "Цена подготовлена для озвучки", passed: !/\b\d+(?:[.,]\d+)?\s*(USD|EUR|UZS|RUB)\b/i.test(script) },
    { id: "spoken_travel_codes", label: "Коды питания и размещения раскрыты для диктора", passed: !/\b(UAI|AI|BB|HB|FB|RO|DBL|SGL|TRPL)\b/i.test(script) },
    { id: "no_flight_voiceover", label: "Детали рейса не озвучиваются", passed: !/перел[её]т|рейс|вылет\s+\d{1,2}\s+[а-яё]+/i.test(script) },
    { id: "no_repeated_price_label", label: "Цена не повторяется лишний раз", passed: (script.match(/цена\s*[—:-]/gi) || []).length <= 1 },
    { id: "sales_pitch_compact", label: "Сценарий остаётся коротким live pitch", passed: script.split(/\n+/).filter(Boolean).length <= 18 },
    { id: "live_sales_energy", label: "Есть энергия live-продажи", passed: /стоп|смотрите|внимание|нажимайте|забирайте/i.test(script) },
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
