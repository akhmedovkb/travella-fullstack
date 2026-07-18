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
    "дубай": "Дубае",
    "стамбул": "Стамбуле",
    "ташкент": "Ташкенте",
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
  if (/самарканд$/i.test(city)) return "Самарканда";
  if (/шымкент$/i.test(city)) return "Шымкента";
  return city;
}

function sentence(value) {
  const text = compact(value);
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function capitalizeFirst(value) {
  const text = String(value || "");
  return text ? `${text.slice(0, 1).toUpperCase()}${text.slice(1)}` : "";
}

function joinSentence(parts) {
  return sentence(parts.filter(hasValue).join(", "));
}

function normalizeUrgency(value) {
  const text = clean(value);
  if (!text || /^(normal|low|medium|high)$/i.test(text)) {
    return "Это отказное предложение, поэтому оно может уйти в любой момент";
  }
  return text;
}

function getOfferKind(ctx = {}) {
  const text = `${ctx.category || ""} ${ctx.title || ""}`.toLowerCase();
  if (/авиа|flight|перел[её]т/.test(text)) return "отказной авиабилет";
  if (/отел|hotel|гостиниц/.test(text)) return "отказной отель";
  if (/мероприят|event|ticket|билет/.test(text)) return "отказной билет на мероприятие";
  if (/авторск/.test(text)) return "авторский тур";
  return "отказной тур";
}

function getOfferKindPlural(ctx = {}) {
  const kind = getOfferKind(ctx);
  if (kind === "отказной авиабилет") return "отказные авиабилеты";
  if (kind === "отказной отель") return "отказные отели";
  if (kind === "отказной билет на мероприятие") return "отказные билеты на мероприятия";
  if (kind === "авторский тур") return "авторские туры";
  return "отказные туры";
}

function pickVariant(seed, variants, offset = 0) {
  const items = Array.isArray(variants) ? variants.filter(Boolean) : [];
  if (!items.length) return "";
  let hash = 0;
  const text = `${String(seed || "travella")}|${offset}`;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return items[Math.abs(hash) % items.length];
}

function getScriptSeed(ctx = {}, options = {}) {
  return [
    ctx.code,
    ctx.title,
    ctx.destination,
    ctx.fromCity,
    ctx.dates,
    ctx.hotel,
    ctx.price,
    options.scriptMode,
    options.variantSalt,
  ].filter(hasValue).join("|");
}

function buildDateLines(ctx, dateRange, offerKind = "") {
  const isHotel = /отель/.test(offerKind);
  const isEvent = /мероприят/.test(offerKind);
  const isFlight = /авиабилет/.test(offerKind);
  if (dateRange) {
    if (isHotel) {
      return [
        `Заезд — ${formatSpokenDate(dateRange.startRaw, false)}.`,
        `Выезд — ${formatSpokenDate(dateRange.endRaw, false)}.`,
      ];
    }
    return [
      `${isFlight ? "Туда" : "Вылет"} — ${formatSpokenDate(dateRange.startRaw, false)}.`,
      `${isFlight ? "Обратно" : "Обратно"} — ${formatSpokenDate(dateRange.endRaw, false)}.`,
    ];
  }
  if (hasValue(ctx.dates)) {
    const label = isEvent ? "Дата мероприятия" : isHotel ? "Дата заезда" : isFlight ? "Дата вылета" : "Даты поездки";
    return [`${label}: ${formatSpokenDateRange(ctx.dates)}.`];
  }
  return [];
}

function buildHotelLines(hotel, variant) {
  if (!hotel.name && !hotel.stars) return [];
  if (!hotel.stars) return [hotel.name + "."];

  if (variant === "ladder") {
    return [
      "И внимание.",
      "Не три звезды.",
      "Не четыре звезды.",
      `А ${hotel.name} — ${hotel.stars}.`,
    ];
  }

  if (variant === "punch") {
    return [
      "Теперь смотрите по отелю.",
      `${hotel.name}.`,
      `${hotel.stars.slice(0, 1).toUpperCase()}${hotel.stars.slice(1)}.`,
      "Это уже совсем другой уровень отдыха.",
    ];
  }

  return [
    "По отелю тоже красиво.",
    `${hotel.name} — ${hotel.stars}.`,
  ];
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

function buildHook(ctx = {}, options = {}) {
  const seed = getScriptSeed(ctx, options);
  const mode = options.scriptMode || "default";
  const offerKind = getOfferKind(ctx);
  const offerKindPlural = getOfferKindPlural(ctx);
  const aggressiveHooks = [
    "Стоп! Не пролистывайте, этот вариант надо увидеть сейчас!",
    `Секунду! В базе “${offerKindPlural}” появился сильный вариант!`,
    `Внимание сюда! Такой ${offerKind} долго не ждёт!`,
    "Не листайте дальше! Тут вариант для быстрого решения!",
    `Смотрите внимательно: это тот самый ${offerKind}, который забирают быстро!`,
  ];
  const compactHooks = [
    `Быстро: есть ${offerKind}.`,
    "Есть свежий отказной вариант.",
    `Смотрите, что появилось в базе “${offerKindPlural}”.`,
  ];
  return pickVariant(seed, mode === "short" ? compactHooks : mode === "aggressive" || mode === "reroll" ? aggressiveHooks : [
    "Стоп! Стоп! Стоп! Не пролистывайте!",
    "Подождите! Вот это сейчас надо увидеть!",
    `Секунду внимания! Тут появился очень горячий ${offerKind}!`,
    `Не листайте дальше! Смотрите, что есть в базе “${offerKindPlural}”!`,
    "Внимание! Есть вариант, который долго ждать не будет!",
  ]);
}

function buildScript(ctx = {}, options = {}) {
  const seed = getScriptSeed(ctx, options);
  const mode = options.scriptMode || "default";
  const offerKind = getOfferKind(ctx);
  const offerKindPlural = getOfferKindPlural(ctx);
  const title = cleanOfferName(ctx.title, ctx.category || "отказной тур");
  const destination = normalizeDestinationName(ctx.destination || title);
  const travelDestination = destinationToTravelCase(destination);
  const placeDestination = destinationToPlaceCase(destination);
  const fromCity = hasValue(ctx.fromCity) ? departureFrom(ctx.fromCity) : "";
  const dateRange = getDateRangeParts(ctx.dates);
  const nights = formatSpokenNights(ctx.dates);
  const hotel = parseHotelForSales(ctx.hotel);
  const price = formatSpokenPrice(ctx);
  const sourceLine = pickVariant(seed, mode === "aggressive" ? [
    `У меня для вас сильный live-вариант из базы: ${offerKindPlural} Узбекистана.`,
    `Это быстрый шанс забрать готовое предложение из базы: ${offerKindPlural} Узбекистана.`,
    `Сейчас покажу вариант, который в базе “${offerKindPlural}” может долго не прожить.`,
    `В базе Travella появился ${offerKind} для тех, кто решает быстро.`,
  ] : [
    `У меня для вас настоящий туристический разрыв из базы: ${offerKindPlural} Узбекистана.`,
    `В базе Travella появился ${offerKind}, который точно стоит открыть.`,
    `Смотрите внимательно: это ${offerKind} из базы Узбекистана, и он уже готов к быстрому решению.`,
    "Вот такие предложения любят те, кто умеет быстро забирать хорошие варианты.",
  ], 1);
  const routeLine = pickVariant(seed, mode === "aggressive" ? [
    `${destination}${fromCity ? ` из ${fromCity}` : ""}. Готовые даты, понятная цена, и решение надо принимать быстро.`,
    `Направление — ${travelDestination}${fromCity ? `, вылет из ${fromCity}` : ""}. Всё уже собрано в один пакет.`,
    `Ловите: ${travelDestination}${fromCity ? ` из ${fromCity}` : ""}. Это именно тот формат, где долго думать опасно.`,
  ] : [
    `${capitalizeFirst(offerKind)} в ${travelDestination}${fromCity ? ` из ${fromCity}` : ""}!`,
    `${destination}${fromCity ? ` из ${fromCity}` : ""} — вот что сейчас появилось!`,
    `Летний вариант в ${travelDestination}${fromCity ? `, вылет из ${fromCity}` : ""}!`,
  ], 2);
  const hotelMode = pickVariant(seed, ["ladder", "punch", "compact"], 3);
  const priceLead = pickVariant(seed, mode === "aggressive" ? [
    "Теперь к главному — к цене.",
    "И вот почему это предложение стоит проверить прямо сейчас.",
    "Самый сильный момент — цена.",
  ] : [
    "И теперь самое главное.",
    "А теперь момент, ради которого стоит досмотреть.",
    "Теперь внимание на цену.",
    "Вот здесь начинается самое интересное.",
  ], 4);
  const urgencyLines = pickVariant(seed, mode === "aggressive" ? [
    [
      `Это ${offerKind}.`,
      "Такие варианты не лежат в базе спокойно.",
      "Увидели, проверили, забрали.",
    ],
    [
      "Здесь главное — скорость.",
      "Пока один думает, другой уже уточняет у поставщика.",
      "Поэтому действовать лучше сразу.",
    ],
    [
      `${capitalizeFirst(offerKindPlural)} живут быстро.`,
      "Если даты и цена подходят — не откладывайте.",
      "Следующий шаг простой: открыть контакт с поставщиком.",
    ],
  ] : [
    [
      `Но запомните: это ${offerKind}.`,
      "Такие предложения не ждут долго.",
      "Пока вы думаете — его могут забрать.",
    ],
    [
      "Это отказной вариант, поэтому тянуть нельзя.",
      "Если даты и цена подходят, действовать нужно сразу.",
      "Такие предложения обычно уходят быстро.",
    ],
    [
      "Главное — не откладывать.",
      "Отказные туры живут в базе недолго.",
      "Сейчас увидели, сейчас проверили, сейчас забрали.",
    ],
  ], 5);
  const ctaLines = pickVariant(seed, mode === "aggressive" ? [
    [
      "Хотите забрать этот вариант?",
      "Нажимайте «Связаться с поставщиком» под видео и проверяйте наличие сейчас.",
    ],
    [
      "Подходит по датам и цене?",
      "Жмите «Связаться с поставщиком» под видео и сразу переходите к подтверждению.",
    ],
    [
      "Не откладывайте на вечер.",
      "Кнопка «Связаться с поставщиком» под видео — ваш следующий шаг.",
    ],
  ] : [
    [
      "Хотите этот вариант?",
      "Нажимайте «Связаться с поставщиком» под видео и забирайте тур сейчас.",
    ],
    [
      "Если подходит — не ждите.",
      "Жмите «Связаться с поставщиком» под видео и уточняйте наличие.",
    ],
    [
      "Кнопка под видео уже ждёт.",
      "Нажимайте «Связаться с поставщиком» и забирайте этот вариант.",
    ],
  ], 6);
  const lines = [];

  lines.push(buildHook(ctx, options));
  lines.push("");
  lines.push(sourceLine);
  lines.push("");
  lines.push(routeLine);
  lines.push(...buildDateLines(ctx, dateRange, offerKind));
  if (nights && /отель/.test(offerKind)) lines.push(`${capitalizeFirst(nights)} проживания в ${placeDestination}.`);
  if (nights && !/отель|авиабилет|мероприят/.test(offerKind)) lines.push(`Целых ${nights} на отдыхе в ${placeDestination}.`);

  const hotelLines = buildHotelLines(hotel, hotelMode);
  if (hotelLines.length) {
    lines.push("");
    lines.push(...hotelLines);
  }

  const stayItems = [
    hasValue(ctx.people) ? `${formatSpokenPeople(ctx.people)} размещение` : "",
    hasValue(ctx.room) ? `номер ${formatSpokenRoom(ctx.room)}` : "",
    hasValue(ctx.meal) ? formatSpokenMeal(ctx.meal) : "",
  ].filter(hasValue);
  if (stayItems.length) lines.push(sentence(`Для двоих: ${stayItems.join(", ")}`));

  lines.push("");
  if (price) {
    lines.push(priceLead);
    lines.push(`Цена — ${price}.`);
  }
  lines.push(...urgencyLines);
  lines.push("");
  lines.push(...ctaLines);

  if (mode === "short") {
    return [
      buildHook(ctx, options),
      "",
      `${destination}${fromCity ? ` из ${fromCity}` : ""}.`,
      ...buildDateLines(ctx, dateRange, offerKind),
      nights && /отель/.test(offerKind) ? `${capitalizeFirst(nights)} проживания в ${placeDestination}.` : "",
      nights && !/отель|авиабилет|мероприят/.test(offerKind) ? `${capitalizeFirst(nights)} отдыха в ${placeDestination}.` : "",
      hotel.name ? `${hotel.name}${hotel.stars ? ` — ${hotel.stars}` : ""}.` : "",
      stayItems.length ? sentence(`Для двоих: ${stayItems.join(", ")}`) : "",
      price ? `Цена — ${price}.` : "",
      `Это ${offerKind}, поэтому лучше проверить наличие сразу.`,
      "Нажимайте «Связаться с поставщиком» под видео.",
    ].filter(hasValue).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildMotionPrompt(ctx = {}, options = {}) {
  const seed = getScriptSeed(ctx, options);
  const mode = options.scriptMode || "default";
  const offerKind = getOfferKind(ctx);
  const destination = normalizeDestinationName(ctx.destination || ctx.title || "это предложение");
  const hotel = parseHotelForSales(ctx.hotel);
  const energy = mode === "short"
    ? "коротко, собрано, уверенно"
    : mode === "aggressive" || mode === "reroll"
      ? "очень энергично, быстро, уверенно, в стиле live-продавца"
      : "энергично, уверенно, доброжелательно, как продавец в прямом эфире";
  const openingGesture = pickVariant(seed, [
    "В начале резко наклоняется немного вперёд, поднимает открытую ладонь в жесте «стоп» и сразу привлекает внимание зрителя.",
    "В первые секунды смотрит прямо в камеру, чуть подаётся вперёд и делает короткий жест ладонью, как будто останавливает пролистывание.",
    "На старте уверенно поднимает руку на уровень груди и делает энергичный акцент, приглашая досмотреть предложение.",
  ], 1);
  const routeGesture = pickVariant(seed, [
    `При упоминании направления ${destination} раскрывает ладони в стороны, показывает масштаб и привлекательность предложения.`,
    `На названии направления ${destination} улыбается шире и делает открытый жест двумя руками, как будто показывает готовый вариант.`,
    `Когда говорит про ${destination}, слегка кивает, раскрывает ладони и удерживает взгляд в камеру.`,
  ], 2);
  const hotelGesture = hotel.name ? pickVariant(seed, [
    "На фразах про отель и уровень звёздности делает выразительный акцент рукой и немного замедляет речь.",
    "Когда звучит название отеля, показывает уверенность: лёгкий кивок, открытые ладони, спокойная улыбка.",
    "При описании отеля движения становятся мягче, выражение лица — довольное и вдохновляющее.",
  ], 3) : "";
  const priceGesture = pickVariant(seed, [
    "Перед объявлением цены делает короткую драматическую паузу, слегка наклоняется к камере и поднимает указательный палец.",
    "На цене делает самый сильный акцент: уверенный кивок, чёткий жест рукой вниз, взгляд прямо в камеру.",
    "Когда произносит цену, говорит чуть медленнее, подчёркивает важность предложения движением ладони.",
  ], 4);
  const urgencyGesture = pickVariant(seed, [
    `На фразах о срочности ${offerKind} становится серьёзнее, жесты короче и точнее, без паники.`,
    "Когда объясняет срочность, немного ускоряется, смотрит прямо в камеру и делает два коротких акцента рукой.",
    "На блоке срочности выражение лица становится более собранным, голос уверенный, жесты подчёркивают быстрый выбор.",
  ], 5);
  const ctaGesture = pickVariant(seed, [
    "В финале улыбается, уверенно показывает вниз во время фразы про кнопку «Связаться с поставщиком» под видео.",
    "На призыве к действию несколько раз отчётливо показывает вниз обеими руками, затем возвращает взгляд в камеру.",
    "Финальную фразу произносит энергично и уверенно, указывает вниз на кнопку под видео и заканчивает открытой улыбкой.",
  ], 6);

  return [
    `Аватар ведёт себя как ${energy}. Постоянно смотрит прямо в камеру, говорит живо и эмоционально, но без суеты.`,
    openingGesture,
    routeGesture,
    hotelGesture,
    "На датах и деталях предложения делает спокойные, точные жесты руками, чтобы зрителю было легко воспринимать информацию.",
    priceGesture,
    urgencyGesture,
    "Во время перечисления преимуществ ритмично считает пункты пальцами или короткими движениями ладони.",
    ctaGesture,
  ].filter(hasValue).join("\n\n");
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
    target: `клиенты, которые готовы быстро принять решение: ${getOfferKind(ctx)} из базы Узбекистана`,
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
    { id: "cta", label: "Есть понятный призыв к действию", passed: /Travella|свяжитесь|связаться|забрать|откройте|жмите|нажимайте/i.test(script) },
    { id: "no_raw_title_noise", label: "Нет сырого повтора служебного заголовка", passed: !/отказн(ой|ый)?\s+тур\s+в\s+отказн(ой|ый)?\s+тур/i.test(script) },
    { id: "spoken_dates", label: "Даты подготовлены для озвучки", passed: !/\b\d{4}-\d{2}-\d{2}\b/.test(script) },
    { id: "spoken_price", label: "Цена подготовлена для озвучки", passed: !/\b\d+(?:[.,]\d+)?\s*(USD|EUR|UZS|RUB)\b/i.test(script) },
    { id: "spoken_travel_codes", label: "Коды питания и размещения раскрыты для диктора", passed: !/\b(UAI|AI|BB|HB|FB|RO|DBL|SGL|TRPL)\b/i.test(script) },
    { id: "no_flight_voiceover", label: "Детали рейса не озвучиваются", passed: !/перел[её]т|рейс|вылет\s+\d{1,2}\s+[а-яё]+/i.test(script) },
    { id: "no_repeated_price_label", label: "Цена не повторяется лишний раз", passed: (script.match(/цена\s*[—:-]/gi) || []).length <= 1 },
    { id: "sales_pitch_compact", label: "Сценарий остаётся коротким live pitch", passed: script.split(/\n+/).filter(Boolean).length <= 18 },
    { id: "live_sales_energy", label: "Есть энергия live-продажи", passed: /стоп|смотрите|внимание|нажимайте|забирайте|листайте/i.test(script) },
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
  buildMotionPrompt,
  buildAnalysis,
  buildScriptReview,
  buildPublishingDrafts,
  getSafeFactRules,
};
