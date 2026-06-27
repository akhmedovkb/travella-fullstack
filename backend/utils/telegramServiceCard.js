// backend/utils/telegramServiceCard.js

/* ===================== CONFIG (как в bot.js) ===================== */

const BOT_USERNAME = (
  process.env.TELEGRAM_CLIENT_BOT_USERNAME ||
  process.env.TELEGRAM_BOT_USERNAME ||
  ""
)
  .replace(/^@/, "")
  .trim();

const SERVICE_URL_TEMPLATE = (
  process.env.SERVICE_URL_TEMPLATE || "{SITE_URL}?service={id}"
).trim();

const SITE_URL = (
  process.env.SITE_PUBLIC_URL ||
  process.env.SITE_URL ||
  "https://travella.uz"
).replace(/\/+$/, "");

const PRICE_CURRENCY = (process.env.PRICE_CURRENCY || "USD").trim();

const TG_IMAGE_BASE = (
  process.env.TG_IMAGE_BASE ||
  process.env.API_PUBLIC_URL ||
  process.env.SITE_API_PUBLIC_URL ||
  process.env.API_BASE_PUBLIC_URL ||
  process.env.SITE_API_URL ||
  SITE_URL
).replace(/\/+$/, "");

/* ===================== LABELS / EMOJI ===================== */

const CATEGORY_LABELS = {
  refused_tour: "Отказной тур",
  author_tour: "Авторский тур",
  refused_hotel: "Отказной отель",
  refused_flight: "Отказной авиабилет",
  refused_ticket: "Отказной билет",
  refused_event_ticket: "Отказной билет",
};

const CATEGORY_EMOJI = {
  refused_tour: "📍",
  author_tour: "🧭",
  refused_hotel: "🏨",
  refused_flight: "✈️",
  refused_ticket: "🎫",
  refused_event_ticket: "🎫",
};

/* ===================== pretty labels ===================== */

function foodLabel(x) {
  const s = String(x || "").trim().toUpperCase();
  const map = {
    RO: "RO (без питания)",
    BB: "BB (завтраки)",
    HB: "HB (завтрак + ужин)",
    FB: "FB (полный пансион)",
    FBT: "FBT (3-разовое + базовый терапевтический пакет)",
    AI: "AI (всё включено)",
    UAI: "UAI (ультра всё включено)",
    HALAL: "Halal (халяль)",
  };
  return map[s] || (s ? `${s}` : "");
}

function transferLabel(x) {
  const s = String(x || "").trim().toLowerCase();
  const map = {
    individual: "Индивидуальный",
    private: "Индивидуальный",
    group: "Групповой",
    shared: "Групповой",
    none: "Без трансфера",
    no: "Без трансфера",
    absent: "Без трансфера",
    "отсутствует": "Без трансфера",
    "индивидуальный": "Индивидуальный",
    "групповой": "Групповой",
  };
  return map[s] || (String(x || "").trim() ? String(x).trim() : "");
}

function ticketEmoji(categoryOrType) {
  const s = String(categoryOrType || "").toLowerCase();
  if (s.includes("concert") || s.includes("конц")) return "🎤";
  if (
    s.includes("sport") ||
    s.includes("матч") ||
    s.includes("football") ||
    s.includes("футбол")
  )
    return "🏟";
  if (s.includes("theatre") || s.includes("театр")) return "🎭";
  if (s.includes("cinema") || s.includes("кино")) return "🎬";
  if (s.includes("expo") || s.includes("выстав")) return "🧩";
  if (s.includes("festival") || s.includes("фестив")) return "🎪";
  return "🎫";
}

/* ===================== local date parser (SELF-CONTAINED) ===================== */
/**
 * parseDateFlexible:
 * - supports Date
 * - supports ISO: 2026-02-16 / 2026-02-16T10:00:00Z
 * - supports D.M.YYYY / DD.MM.YYYY / D/MM/YYYY
 * - supports "YYYY.MM.DD"
 * returns Date or null
 */
function parseDateFlexible(x) {
  if (!x) return null;
  if (x instanceof Date && !isNaN(x.getTime())) return x;

  const s0 = String(x).trim();
  if (!s0) return null;

  // ✅ 1) ISO (YYYY-MM-DD or YYYY-MM-DDTHH:mm...)
  if (/^\d{4}-\d{2}-\d{2}/.test(s0)) {
    const dIso = new Date(s0);
    if (!isNaN(dIso.getTime())) return dIso;
  }

  // ✅ 2) DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
  let m = s0.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s.*)?$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (yyyy >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(yyyy, mm - 1, dd);
      // ✅ защита от 31.02
      if (d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd) return d;
    }
  }

  // ✅ 3) YYYY.MM.DD or YYYY/MM/DD or YYYY-MM-DD (without time)
  m = s0.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s.*)?$/);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (yyyy >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(yyyy, mm - 1, dd);
      if (d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd) return d;
    }
  }

  // ✅ 4) fallback only (если очень нужно)
  const dNative = new Date(s0);
  if (!isNaN(dNative.getTime())) return dNative;

  return null;
}
function formatDateDMY(x) {
  const d = parseDateFlexible(x);
  if (!d) {
    const s = String(x ?? "").trim();
    return s || "";
  }
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear());
  return `${dd}.${mm}.${yy}`;
}

/* ===================== helpers (скопировано из bot.js) ===================== */

function normalizeTitleSoft(str) {
  if (!str) return str;
  const s = String(str).trim();
  if (!s) return s;
  if (/[a-zа-яё]/.test(s)) return s;

  return s.replace(/[A-Za-zА-ЯЁа-яё]+/g, (w) => {
    if (w.length <= 3) return w;
    if (w === w.toUpperCase()) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }
    return w;
  });
}

function normalizeWeirdSeparator(s) {
  if (!s) return s;
  return String(s)
    .replace(/\s*['’]n\s*/gi, " → ")
    .replace(/\s*&n\s*/gi, " → ")
    .replace(/\s+→\s+/g, " → ")
    .trim();
}

function parseDetailsAny(details) {
  if (!details) return {};
  if (typeof details === "object") return details;
  if (typeof details === "string") {
    try {
      return JSON.parse(details);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * ⭐️ stars extractor (UPGRADED)
 */
function extractStars(details) {
  const d = details || {};
  const raw = String(d.accommodationCategory || d.roomCategory || "").trim();
  if (!raw) return null;

  const s = raw.toLowerCase();

  let m = raw.match(/([1-7])\s*\*|⭐\s*([1-7])/);
  let stars = m ? Number(m[1] || m[2]) : null;

  if (!stars) {
    m = s.match(/([1-7])\s*(star|stars|зв|зв\.|звезд|звёзд|звезда|звёзда)/i);
    stars = m ? Number(m[1]) : null;
  }

  if (!stars) {
    m = s.match(/(^|[^\d])([1-7])([^\d]|$)/);
    stars = m ? Number(m[2]) : null;
  }

  if (!stars) return null;
  return `⭐️ ${stars}*`;
}

function stripStarsFromRoomCat(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s
    .replace(/⭐\s*[1-7]\s*\*?/gi, "")
    .replace(/\b[1-7]\s*\*/gi, "")
    .replace(/\b[1-7]\s*(star|stars|зв|зв\.|звезд|звёзд|звезда|звёзда)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function pickPrice(details, svc, role) {
  const d = details || {};
  if (role === "provider") {
    return d.netPrice ?? d.price ?? d.grossPrice ?? svc.price ?? null;
  }
  return d.grossPrice ?? d.price ?? d.netPrice ?? svc.price ?? null;
}

function formatPriceWithCurrency(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (!v) return null;

  if (/\b(usd|u\.?s\.?d\.?|eur|rub|uzs|\$|€|₽|сум)\b/i.test(v)) return v;
  return `${v} ${PRICE_CURRENCY}`;
}

function buildServiceUrl(serviceId) {
  const tpl = SERVICE_URL_TEMPLATE || "{SITE_URL}?service={id}";
  return tpl
    .replace(/\{SITE_URL\}/g, SITE_URL)
    .replace(/\{id\}/g, String(serviceId));
}

function getExpiryBadge(detailsRaw, svc) {
  const d = parseDetailsAny(detailsRaw);
  const expirationRaw = d.expiration || svc?.expiration || null;
  if (!expirationRaw) return null;

  const exp = parseDateFlexible(expirationRaw);
  if (!exp) return null;

  const today = new Date();
  const today0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow0 = new Date(today0.getTime() + 24 * 60 * 60 * 1000);
  const exp0 = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate());

  if (exp0.getTime() === today0.getTime()) return "⏳ истекает сегодня";
  if (exp0.getTime() === tomorrow0.getTime()) return "⏳ истекает завтра";
  return null;
}

function shouldShowProviderContacts(role, unlocked) {
  const r = String(role || "").toLowerCase();

  if (r === "admin" || r === "provider") return true;

  // клиент/гость/прочие — только после unlock
  return unlocked === true;
}

/**
 * В services.images могут быть:
 * - base64 data:image...
 * - http(s) URL
 * - относительный /path
 * - "tg:<file_id>"
 */
function getFirstImageUrl(svc) {
  const directCandidates = [
    svc?.imageUrl,
    svc?.image_url,
    svc?.thumbnailUrl,
    svc?.thumbnail_url,
    svc?.image,
    svc?.photo,
  ];

  for (const c of directCandidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  let arr = svc?.images ?? null;

  if (typeof arr === "string") {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = [arr];
    }
  }
  if (!Array.isArray(arr)) arr = [];

  if (!arr.length) {
    const d = parseDetailsAny(svc.details);
    const fid = (d.telegramPhotoFileId || "").trim();
    if (fid) return fid;
    return null;
  }

  let v = arr[0];
  if (v && typeof v === "object") {
    v =
      v.url ||
      v.src ||
      v.path ||
      v.location ||
      v.href ||
      v.imageUrl ||
      v.image_url ||
      null;
  }
  if (typeof v !== "string") return null;

  v = v.trim();
  if (!v) return null;

  if (v.startsWith("tg:")) {
    const fileId = v.slice(3).trim();
    return fileId || null;
  }

  if (v.startsWith("data:image")) {
    return `${TG_IMAGE_BASE}/api/telegram/service-image/${svc.id}`;
  }

  if (v.startsWith("http://") || v.startsWith("https://")) return encodeURI(v);

  if (v.startsWith("/")) return encodeURI(TG_IMAGE_BASE + v);

  return encodeURI(`${TG_IMAGE_BASE}/${v.replace(/^\/+/, "")}`);
}

/* ===================== PRICE DROP (header + diff) ===================== */

function toNumberPrice(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const num = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? num : null;
}

function getPriceDropMeta(detailsRaw, svc, role) {
  const d = parseDetailsAny(detailsRaw);

  const currentRaw = pickPrice(d, svc, role);
  const current = toNumberPrice(currentRaw);

  const prevRaw = d.previousPrice ?? d.prevPrice ?? d.oldPrice ?? null;
  const prev = toNumberPrice(prevRaw);

  if (!Number.isFinite(prev) || !Number.isFinite(current)) return null;
  if (current >= prev) return null;

  const diff = prev - current;
  const cur = PRICE_CURRENCY || "USD";

  return {
    header: `📉 <b>ЦЕНА СНИЖЕНА</b>`,
    diffLine: `⬇️ <b>−${diff} ${cur}</b>`,
  };
}

/* ===================== MAIN CARD BUILDER ===================== */

function normalizeCategory(cat) {
  const c = String(cat || "").trim().toLowerCase();

  // алиасы/частые варианты
  if (c === "refused_event_ticket") return "refused_event_ticket";
  if (c === "refused_ticket") return "refused_ticket";

  // иногда могут прилетать “кривые” названия — нормализуем
  if (c.includes("event") && c.includes("ticket")) return "refused_event_ticket";
  if (c.includes("flight") || c.includes("air")) return "refused_flight";
  if (c.includes("hotel")) return "refused_hotel";
  if (c === "author_tour" || c.includes("author") || c.includes("автор")) return "author_tour";
  if (c.startsWith("refused_")) return c;

  return c; // как есть
}

function guessRefusedCategory(details) {
  const d = details || {};
  if (d.program || d.included || d.tourFormat || d.flexibleDates || d.guideLanguage) return "author_tour";
  // эвристика: по полям details
  if (d.eventCategory || d.ticketDetails || d.ticketType) return "refused_event_ticket";
  if (d.airline || d.flightDetails || d.departureFlightDate || d.returnFlightDate) return "refused_flight";
  if (d.hotel || d.hotelName || d.checkIn || d.checkOut || d.checkInDate || d.checkOutDate) return "refused_hotel";
  return "refused_tour";
}

function buildServiceMessage(svc, category, role = "client", options = {}) {
  // 🛡 hardening: запрещаем “магические роли”, роль НЕ должна давать доступ к контактам
  const r0 = String(role || "client").toLowerCase();
  if (r0 === "client_unlocked" || r0 === "client_public") role = "client";

  const d = parseDetailsAny(svc.details);

  // ✅ единый источник правды:
  // - если явно передали unlocked=true → показываем контакты
  // - если админ/провайдер → показываем контакты
  // - если открытие контактов переведено в бесплатный режим → тоже показываем сразу
  const unlockPrice = Number(options?.unlockPrice ?? options?.effectivePrice ?? options?.contactUnlockPrice ?? 0);
  const isFreeMode = unlockPrice <= 0;
  const unlocked = options?.unlocked === true || isFreeMode;

  const newBadge = options?.newBadge === true;

    // ✅ normalize category + страховка
  let catNorm = normalizeCategory(category);

  // если category не передали или он пустой — попробуем взять из svc.category
  if (!catNorm) catNorm = normalizeCategory(svc?.category);

  // если это вообще “refused_*”, но не один из ожидаемых — угадаем по details
  if (role !== "provider" && String(catNorm || "").startsWith("refused_")) {
    const known = new Set([
      "refused_tour",
      "author_tour",
      "refused_hotel",
      "refused_flight",
      "refused_ticket",
      "refused_event_ticket",
    ]);
    if (!known.has(catNorm)) catNorm = guessRefusedCategory(d);
  }

  // дальше в функции используй catNorm вместо category
  category = catNorm;

  const serviceId = svc.id;
  const serviceUrl = buildServiceUrl(serviceId);

  const escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const a = (url, label) => {
    if (!url) return escapeHtml(label || "");
    return `<a href="${escapeHtml(url)}">${escapeHtml(label || url)}</a>`;
  };

  const joinClean = (arr, sep = " • ") =>
    arr.map((x) => String(x || "").trim()).filter(Boolean).join(sep);

  const norm = (v) => (v ? normalizeWeirdSeparator(String(v)) : "");

  const titleRaw = (svc.title || CATEGORY_LABELS?.[category] || "Услуга").trim();
  const titlePretty = normalizeTitleSoft(titleRaw);

  const emoji = CATEGORY_EMOJI?.[category] || "";
  const stars = extractStars ? extractStars(d) : "";
  const titleDecor = joinClean([emoji, titlePretty, stars], " ");

  const from = norm(d.directionFrom);
  const to = norm(d.directionTo);
  const country = norm(d.directionCountry);
  const route = joinClean([from && to ? `${from} → ${to}` : to || from, country]);

  /* ===================== dates (UPGRADED FALLBACKS) ===================== */

  const startRaw =
    d.departureFlightDate ||
    d.startDate ||
    d.startFlightDate ||
    d.checkIn ||
    d.checkInDate ||
    d.arrivalDate ||
    d.arrival ||
    d.dateFrom ||
    d.eventDate ||
    "";

  const endRaw =
    d.returnFlightDate ||
    d.returnDate ||
    d.endDate ||
    d.endFlightDate ||
    d.checkOut ||
    d.checkOutDate ||
    d.departureDate ||
    d.departure ||
    d.dateTo ||
    "";

  const startDateObj = parseDateFlexible(startRaw);
  const endDateObj = parseDateFlexible(endRaw);
  
  const start = startDateObj ? formatDateDMY(startDateObj) : norm(startRaw);
  const end = endDateObj ? formatDateDMY(endDateObj) : norm(endRaw);
  
  const dates = start && end && start !== end ? `${start} → ${end}` : start || end || "";

  let nights = null;
  try {
    const sdt = startDateObj;
    const edt = endDateObj;
    if (sdt && edt) {
      const s0 = new Date(sdt.getFullYear(), sdt.getMonth(), sdt.getDate());
      const e0 = new Date(edt.getFullYear(), edt.getMonth(), edt.getDate());
      const diff = Math.round((e0.getTime() - s0.getTime()) / 86400000);
      if (diff > 0 && diff < 60) nights = diff;
    }
  } catch {}

  const hotel = norm(d.hotel || d.hotelName);
  const accommodation = norm(d.accommodation);

  const priceRaw = pickPrice(d, svc, role);
  const priceWithCur = formatPriceWithCurrency(priceRaw);
  // ✅ определяем тип цены (нетто/брутто)
const priceKind =
  role === "provider"
    ? (d.netPrice ?? null) != null
      ? "нетто"
      : (d.grossPrice ?? null) != null
        ? "брутто"
        : "нетто"
    : "брутто";

  const badge = getExpiryBadge(d, svc);
  const badgeClean = badge ? String(badge).replace(/^⏳\s*/g, "").trim() : "";

  /* ===================== PREMIUM helpers ===================== */

  const labelLine = (icon, label, value) => {
    const v = String(value ?? "").trim();
    if (!v) return "";
    return `${icon} <b>${escapeHtml(label)}</b>: ${escapeHtml(v)}`;
  };
  
  // ⚠️ если value уже содержит HTML (например <a href="...">...</a>),
  // используем эту версию — она НЕ экранирует value, но экранирует label.
  const labelLineHtml = (icon, label, htmlValue) => {
    const v = String(htmlValue ?? "").trim();
    if (!v) return "";
    return `${icon} <b>${escapeHtml(label)}</b>: ${v}`;
  };

  const providerNameRaw = (svc.provider_name || "Поставщик").trim();
  const providerId = svc.provider_id || svc.providerId || svc.provider?.id || null;
  const providerProfileUrl = providerId ? `${SITE_URL}/profile/provider/${providerId}` : null;
  
  const providerLine = providerProfileUrl
    ? labelLineHtml("🏢", "Поставщик", a(providerProfileUrl, providerNameRaw))
    : labelLine("🏢", "Поставщик", providerNameRaw);
  
  let telegramLine = "";
  if (svc.provider_telegram) {
    let u = String(svc.provider_telegram).trim().replace(/^@/, "");
    u = u.replace(/^https?:\/\/t\.me\//i, "");
    u = u.replace(/^tg:\/\/resolve\?domain=/i, "");
    if (u) {
      telegramLine = labelLineHtml(
        "📲",
        "Telegram",
        a(`https://t.me/${encodeURIComponent(u)}`, u)
      );
    }
  }

  const titleLine = (mode = "generic") => {
    const raw = String(svc.title || "").trim();

    const isGeneric =
      raw &&
      ["отказной тур", "отказной отель", "отказной авиабилет", "отказной билет"].includes(
        raw.toLowerCase()
      );

    if (raw && !isGeneric) {
      return `📝 <b>${escapeHtml(normalizeTitleSoft(raw))}</b>`;
    }

    if (mode === "hotel") {
      const h = norm(d.hotel || d.hotelName);
      const city = norm(d.directionTo) || norm(d.city) || norm(d.locationCity);
      const country2 = norm(d.directionCountry);
      if (h) {
        const place = [city, country2].filter(Boolean).join(", ");
        return place
          ? `📝 <b>${escapeHtml(h)} (${escapeHtml(place)})</b>`
          : `📝 <b>${escapeHtml(h)}</b>`;
      }
      const loc = route || [city, country2].filter(Boolean).join(", ");
      if (loc) return `📝 <b>${escapeHtml(loc)}</b>`;
      return "";
    }

    if (mode === "flight") {
      const f = norm(d.directionFrom);
      const t = norm(d.directionTo);
      const c = norm(d.directionCountry);
      const rt = f && t ? `${f} → ${t}` : route;
      const base = [rt, c].filter(Boolean).join(" • ");
      if (base) return `📝 <b>${escapeHtml(base)}</b>`;
      return "";
    }

    if (mode === "ticket") {
      const cat = norm(d.eventCategory) || norm(d.ticketType) || norm(d.type);
      const loc = norm(d.location) || norm(d.city) || norm(d.directionTo);
      const dt =
        norm(d.eventDate) ||
        norm(d.startDate) ||
        norm(d.departureDate) ||
        norm(d.date) ||
        "";
      const pieces = [cat, loc].filter(Boolean).join(" • ");
      if (pieces && dt) return `📝 <b>${escapeHtml(pieces)} — ${escapeHtml(dt)}</b>`;
      if (pieces) return `📝 <b>${escapeHtml(pieces)}</b>`;
      if (loc && dt) return `📝 <b>${escapeHtml(loc)} — ${escapeHtml(dt)}</b>`;
      if (loc) return `📝 <b>${escapeHtml(loc)}</b>`;
      return "";
    }

    return "";
  };

  const hasReturnFlight = () => {
    const rr =
      d.returnFlightDate ||
      d.returnDate ||
      d.endFlightDate ||
      d.endDate ||
      d.checkOut ||
      d.checkOutDate ||
      d.departureDate ||
      d.departure ||
      "";
    return String(rr || "").trim().length > 0;
  };

  const flightDateLabel = () => {
    const s = String(start || "").trim();
    const e = String(end || "").trim();
    if (s && e && s !== e) return { label: "Даты", value: `${s} → ${e}` };
    if (s) return { label: "Дата", value: s };
    if (e) return { label: "Дата", value: e };
    return null;
  };

  const eventDateLabel = () => {
    const s = String(start || "").trim();
    const e = String(end || "").trim();
    if (s && e && s !== e) return { label: "Даты", value: `${s} → ${e}` };
    if (s) return { label: "Дата", value: s };
    if (e) return { label: "Дата", value: e };
    return null;
  };

  const hotelDatesLines = () => {
    const ciRaw =
      d.checkIn || d.checkInDate || d.arrivalDate || d.arrival || d.startDate || "";
    const coRaw =
      d.checkOut || d.checkOutDate || d.departureDate || d.departure || d.endDate || "";

    const ci = norm(formatDateDMY(ciRaw) || ciRaw);
    const co = norm(formatDateDMY(coRaw) || coRaw);

    const lines = [];
    if (ci) lines.push(labelLine("🟢", "Заезд", ci));
    if (co) lines.push(labelLine("🔴", "Выезд", co));

    let n = nights;
    try {
      if (ci && co) {
        const sdt = parseDateFlexible(ci);
        const edt = parseDateFlexible(co);
        if (sdt && edt) {
          const diff = Math.round((edt.getTime() - sdt.getTime()) / 86400000);
          if (diff > 0 && diff < 60) n = diff;
        }
      }
    } catch {}
    if (n) lines.push(`🌙 <b>Ночей:</b> ${escapeHtml(String(n))}`);
    return lines;
  };

  const hotelLocationLines = () => {
    const city =
      norm(d.directionTo) ||
      norm(d.city) ||
      norm(d.locationCity) ||
      norm(d.toCity) ||
      "";
    const country2 =
      norm(d.directionCountry) ||
      norm(d.country) ||
      norm(d.locationCountry) ||
      "";
    const lines = [];
    if (city) lines.push(labelLine("🏙", "Город", city));
    if (country2) lines.push(labelLine("🌍", "Страна", country2));
    if (!lines.length && route) lines.push(labelLine("📍", "Локация", route));
    return lines;
  };

  const tourLocationLines = () => {
    const fromCity = norm(d.directionFrom || d.fromCity || d.cityFrom || "");
    const toCity = norm(d.directionTo || d.toCity || d.cityTo || "");
    const country2 = norm(d.directionCountry || d.country || "");
    const lines = [];
    if (fromCity) lines.push(labelLine("🛫", "Город вылета", fromCity));
    if (toCity) lines.push(labelLine("🛬", "Город прибытия", toCity));
    if (country2) lines.push(labelLine("🌍", "Страна направления", country2));
    if (!lines.length && route) lines.push(labelLine("📍", "Маршрут", route));
    return lines;
  };
  
  const flightLocationLines = () => {
    const fromCity = norm(d.directionFrom || d.fromCity || d.cityFrom || "");
    const toCity = norm(d.directionTo || d.toCity || d.cityTo || "");
    const country2 = norm(d.directionCountry || d.country || "");
    const lines = [];
    if (fromCity) lines.push(labelLine("🛫", "Вылет", fromCity));
    if (toCity) lines.push(labelLine("🛬", "Прилёт", toCity));
    if (country2) lines.push(labelLine("🌍", "Страна", country2));
    if (!lines.length && route) lines.push(labelLine("📍", "Маршрут", route));
    return lines;
  };

  const ticketLocationLines = () => {
    const city =
      norm(d.city) ||
      norm(d.locationCity) ||
      norm(d.directionTo) ||
      norm(d.toCity) ||
      "";
    const country2 =
      norm(d.country) ||
      norm(d.locationCountry) ||
      norm(d.directionCountry) ||
      "";
    const lines = [];
    if (city) lines.push(labelLine("🏙", "Город", city));
    if (country2) lines.push(labelLine("🌍", "Страна", country2));
    const location = norm(d.location);
    if (!lines.length && location) lines.push(labelLine("📍", "Локация", location));
    return lines;
  };

  const pushPriceDrop = (parts) => {
    const priceDrop = getPriceDropMeta(svc.details, svc, role);
    if (!priceDrop) return;
    parts.push(priceDrop.header);
    parts.push(priceDrop.diffLine);
  };
  const pushDivider = (parts) => {
    if (parts.length && parts[parts.length - 1] !== "") parts.push("");
  };

  const refusedHeading = (label) => {
    const cleanLabel = escapeHtml(String(label || "ОТКАЗНОЙ ПАКЕТ"));
    if (newBadge) {
      return `🆕 <b>НОВЫЙ ${cleanLabel}</b>\n📍 <code>#R${serviceId}</code>`;
    }
    return `🔥 <b>ГОРЯЩИЙ ${cleanLabel}</b>\n📍 <code>#R${serviceId}</code>`;
  };

  const pushRefusedUrgency = (parts) => {
    parts.push("🔥 <b>ОТКАЗНОЙ ПАКЕТ</b>");
    parts.push("⚡ Обычно такие варианты уходят быстро");
    parts.push("⏳ Актуальность ограничена");
  };

  const authorFormatLabel = (value) => {
    const v = String(value || "").trim().toLowerCase();
    if (v === "group") return "Групповой";
    if (v === "private") return "Индивидуальный";
    if (v === "custom") return "Под запрос";
    return String(value || "").trim();
  };

  const compactText = (value, max = 180) => {
    const raw = String(value || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!raw) return "";
    if (raw.length <= max) return raw;
    return `${raw.slice(0, max).trim()}…`;
  };

  const splitBullets = (value, maxItems = 6) => {
    const raw = String(value || "").trim();
    if (!raw) return [];
    return raw
      .split(/\n|;|•|✓|✔|,/g)
      .map((x) => x.replace(/^[-–—\s]+/g, "").trim())
      .filter(Boolean)
      .slice(0, maxItems);
  };

  const pushBulletBlock = (parts, icon, title, value, maxItems = 6) => {
    const items = splitBullets(value, maxItems);
    if (!items.length) return;
    parts.push(`${icon} <b>${escapeHtml(title)}</b>:`);
    for (const item of items) parts.push(`  ✓ ${escapeHtml(item)}`);
  };

  const projectSupportPaid =
    svc.project_support_paid === true ||
    svc.support_project_paid === true ||
    svc.provider_support_paid === true ||
    svc.has_project_support === true ||
    d.projectSupportPaid === true ||
    d.supportProjectPaid === true;

  /* ===================== TELEGRAM CARD v4 SELLING HELPERS ===================== */

  const firstValue = (...values) => {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        const cleaned = value.map((x) => String(x || "").trim()).filter(Boolean);
        if (cleaned.length) return cleaned.join(", ");
        continue;
      }
      const s = norm(value);
      if (s) return s;
    }
    return "";
  };

  const hasPositiveFlag = (...values) => {
    for (const value of values) {
      if (value === true) return true;
      const s = String(value ?? "").trim().toLowerCase();
      if (!s) continue;
      if (["true", "yes", "y", "1", "да", "включено", "included", "include"].includes(s)) return true;
    }
    return false;
  };

  const hasNegativeFlag = (...values) => {
    for (const value of values) {
      if (value === false) return true;
      const s = String(value ?? "").trim().toLowerCase();
      if (!s) continue;
      if (["false", "no", "n", "0", "нет", "не включено", "none", "absent"].includes(s)) return true;
    }
    return false;
  };

  const shortMealLabel = (value) => {
    const raw = firstValue(value);
    if (!raw) return "";
    const up = raw.toUpperCase();
    const map = {
      RO: "RO (без питания)",
      BB: "BB (завтраки)",
      HB: "HB (завтрак + ужин)",
      FB: "FB (полный пансион)",
      FBT: "FBT (3-разовое + базовый терапевтический пакет)",
      AI: "AI (всё включено)",
      UAI: "UAI (ультра всё включено)",
      HALAL: "Halal",
    };
    if (map[up]) return map[up];
    if (/ULTRA|УЛЬТРА|UAI/.test(up)) return "UAI (ультра всё включено)";
    if (/ALL\s*INCLUSIVE|ВС[ЕЁ]\s*ВКЛ|AI/.test(up)) return "AI (всё включено)";
    if (/FBT|THERAP|ТЕРАП|ЛЕЧЕН/.test(up)) return "FBT (3-разовое + базовый терапевтический пакет)";
    if (/FULL\s*BOARD|ПОЛН|FB/.test(up)) return "FB (полный пансион)";
    if (/HALF\s*BOARD|ПОЛУ|HB/.test(up)) return "HB (завтрак + ужин)";
    if (/ROOM\s*ONLY|БЕЗ\s*ПИТ|RO/.test(up)) return "RO (без питания)";
    if (/BREAKFAST|ЗАВТРАК|BB/.test(up)) return "BB (завтраки)";
    return raw;
  };

  const shortRoomLabel = (value) => {
    const raw = firstValue(value);
    if (!raw) return "";
    return raw
      .replace(/Deluxe\s+Room/gi, "Deluxe")
      .replace(/Standard\s+Room/gi, "Standard")
      .replace(/Room/gi, "")
      .replace(/Select\s+Sea\s+view\s+room/gi, "Sea View")
      .replace(/Sea\s+View/gi, "Sea View")
      .replace(/\s{2,}/g, " ")
      .trim();
  };

  const transferItems = () => {
    const out = [];
    const add = (label) => {
      const v0 = firstValue(label);
      if (!v0) return;
      const v = transferLabel(v0) || v0;
      const low = String(v).toLowerCase();
      if (/без трансфера|нет|none|no|absent/.test(low)) return;
      if (!out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
    };

    add(d.transfer);
    add(d.transferType);
    add(d.transferIncluded);
    add(d.transfers);
    add(d.airportTransfer);
    add(d.airport_transfer);
    add(d.hotelTransfer);
    add(d.hotel_transfer);
    add(d.groupTransfer);
    add(d.privateTransfer);
    add(d.individualTransfer);

    if (hasPositiveFlag(d.transferIncluded, d.hasTransfer, d.airportTransferIncluded)) add("Включён");
    if (hasPositiveFlag(d.privateTransfer, d.individualTransfer)) add("Индивидуальный");
    if (hasPositiveFlag(d.groupTransfer, d.sharedTransfer)) add("Групповой");

    return out.slice(0, 3);
  };

  const compactIncludedLine = (items, maxItems = 6) => {
    const cleaned = [];
    for (const item of items) {
      const s = String(item || "").trim();
      if (!s) continue;
      if (!cleaned.some((x) => x.toLowerCase() === s.toLowerCase())) cleaned.push(s);
    }
    return cleaned.slice(0, maxItems).join(" • ");
  };

  const priceHeroLine = () => {
    if (priceWithCur == null || !String(priceWithCur).trim()) return "";
    const audience = firstValue(
      d.priceFor,
      d.pricePer,
      d.priceDescription,
      d.priceComment,
      d.priceNote,
      d.passengersCount ? `за ${d.passengersCount} пассаж.` : "",
      d.ticketsCount ? `за ${d.ticketsCount} билет.` : ""
    );
    return audience
      ? `💵 <b>${escapeHtml(String(priceWithCur))}</b> <i>${escapeHtml(audience)}</i>`
      : `💵 <b>${escapeHtml(String(priceWithCur))}</b>`;
  };

  const smartBadges = (kind = "refused") => {
    const arr = [];
    if (kind === "refused") arr.push("🔥 отказное");
    if (kind === "flight") arr.push("✈️ билет");
    if (kind === "ticket") arr.push("🎫 мероприятие");
    if (d.changeable === false || d.fixedPackage === true || d.isFixedPackage === true) arr.push("🔒 фикс-пакет");
    if (d.changeable === true) arr.push("🔁 можно менять");
    if (badgeClean) arr.push(`⏳ ${badgeClean}`);
    arr.push("⚡ срочно");
    return arr.join(" • ");
  };

  const providerCompactBlock = (parts) => {
    pushDivider(parts);
    if (shouldShowProviderContacts(role, unlocked)) {
      parts.push(`🤝 <b>${escapeHtml(providerNameRaw)}</b>`);
      if (telegramLine) parts.push(telegramLine);
    } else {
      parts.push(`🤝 <b>Поставщик:</b> 🔒 скрыт до открытия`);
    }
  };

  const normalizedRole = String(role || "").toLowerCase();
  const isClientViewer = normalizedRole === "client";
  const isProviderViewer = normalizedRole === "provider";
  const canQuickRequest = isClientViewer || isProviderViewer;

  const sellingKb = (extraRows = []) => {
    const rows = [];

    // «Открыть контакты» — только клиенту.
    // «Быстрый запрос» нужен и клиенту, и поставщику.
    if (isClientViewer) rows.push([{ text: "🔓 Открыть контакты", callback_data: `contacts:${serviceId}` }]);
    if (canQuickRequest) rows.push([{ text: "⚡ Быстрый запрос", callback_data: `quick:${serviceId}` }]);

    for (const row of extraRows || []) {
      if (Array.isArray(row) && row.length) rows.push(row);
    }

    if (serviceUrl) rows.push([{ text: "🌐 Подробнее на сайте", url: serviceUrl }]);

    return { inline_keyboard: rows, replaceDefault: true };
  };

  const line = (icon, value) => {
    const v = firstValue(value);
    return v ? `${icon} ${escapeHtml(v)}` : "";
  };

  /* ===================== SPECIAL TEMPLATES ===================== */


  if ((role !== "provider" || options?.forceRefused === true) && String(category) === "author_tour") {
    const parts = [];

    const cleanInline = (value) =>
      String(value ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    const splitSmartLines = (value, maxItems = 6) => {
      const raw = cleanInline(value);
      if (!raw) return [];
      return raw
        .split(/\n|;|•|✓|✔/g)
        .map((x) => x.replace(/^[-–—\s]+/g, "").trim())
        .filter(Boolean)
        .slice(0, maxItems);
    };

    const pluralRuNights = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return "";
      const abs = Math.abs(Math.trunc(n));
      const last = abs % 10;
      const last2 = abs % 100;
      if (last === 1 && last2 !== 11) return `${abs} ночь`;
      if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return `${abs} ночи`;
      return `${abs} ночей`;
    };

    const formatStayItem = (item) => {
      if (item == null) return "";
      if (typeof item === "string") return item.trim();
      if (typeof item !== "object") return String(item).trim();

      const hotelName = norm(
        item.hotel ||
          item.name ||
          item.title ||
          item.accommodation ||
          item.place ||
          item.hotelName ||
          ""
      );

      const nightsCount =
        item.nights ??
        item.nightCount ??
        item.nightsCount ??
        item.days ??
        "";

      const cityName = norm(item.city || item.location || "");
      const suffix = nightsCount ? pluralRuNights(nightsCount) : cityName;
      return joinClean([hotelName, suffix], " — ");
    };

  const getStayLines = () => {
    const out = [];
    const seen = new Set();

    const addLine = (value) => {
      const line = norm(value);
      if (!line) return;
      const key = line.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(line);
    };

    const pushItem = (hotel, nights, city) => {
      const h = norm(hotel);
      if (!h) return;
      const suffixParts = [];
      const nightsText = nights ? pluralRuNights(nights) : "";
      const cityText = norm(city || "");
      if (nightsText) suffixParts.push(nightsText);
      if (cityText) suffixParts.push(cityText);
      addLine(suffixParts.length ? `${h} — ${suffixParts.join(" — ")}` : h);
    };

    const parseTextAccommodation = (value) => {
      const raw = cleanInline(value);
      if (!raw) return;

      raw
        .split(/\n|;/g)
        .map((x) => x.replace(/^[-–—•\s]+/g, "").trim())
        .filter(Boolean)
        .forEach((line) => {
          const tooLong = line.length > 110;
          const hasDayProgram =
            /день\s*\d+|day\s*\d+|экскурс|вылет|трансфер|встреча|возвращение|свободн|прогулк|посещение/i.test(line);
          const looksLikeHotel =
            /hotel|отель|m[oö]venpick|kar\s+hotel|great\s+fortune|resort|inn|suite|spa|palace|boutique/i.test(line);

          if (looksLikeHotel && !hasDayProgram && !tooLong) addLine(line);
        });
    };

    const parseDurationStays = (value) => {
      const raw = cleanInline(value);
      if (!raw) return;

      const re = /(.+?)\s*-\s*(\d+)\s*(?:nights?|ноч(?:ь|и|ей))\s*-\s*([^\n]+?)(?=\s+[A-ZА-ЯЁÜÖÇĞİŞ][^\n]*?\s*-\s*\d+\s*(?:nights?|ноч(?:ь|и|ей))\s*-|$)/giu;
      let m;
      while ((m = re.exec(raw))) {
        pushItem(m[1], m[2], m[3]);
      }
    };

    const pushAnyStaySource = (src) => {
      if (!src) return;

      if (Array.isArray(src)) {
        src.forEach((x) => {
          if (typeof x === "string") {
            parseTextAccommodation(x);
            return;
          }

          if (x && typeof x === "object") {
            pushItem(
              x.hotel ||
                x.name ||
                x.title ||
                x.hotelName ||
                x.accommodation ||
                x.place,
              x.nights ||
                x.nightCount ||
                x.nightsCount ||
                x.days,
              x.city ||
                x.location
            );
          }
        });
        return;
      }

      if (typeof src === "string") {
        parseTextAccommodation(src);
        return;
      }

      if (typeof src === "object") {
        pushItem(
          src.hotel ||
            src.name ||
            src.title ||
            src.hotelName ||
            src.accommodation ||
            src.place,
          src.nights ||
            src.nightCount ||
            src.nightsCount ||
            src.days,
          src.city ||
            src.location
        );
      }
    };

    [
      d.stays,
      d.accommodationPlan,
      d.hotelsPlan,
      d.hotels,
      d.lodging,
      d.accommodationHotels,
    ].forEach(pushAnyStaySource);

    if (!out.length && Array.isArray(d.programDays)) {
      d.programDays.forEach((day) => {
        if (day?.stay) pushAnyStaySource(day.stay);
        if (Array.isArray(day?.stays)) pushAnyStaySource(day.stays);
      });
    }

    // Новый основной fallback для старых записей: в R793 проживание лежит в details.duration
    if (!out.length) parseDurationStays(d.duration || d.tourDuration || "");

    // Последний fallback: из обычных полей отеля.
    if (!out.length) {
      parseTextAccommodation(d.accommodation);
      parseTextAccommodation(d.hotel);
      parseTextAccommodation(d.hotelName);
    }

    // Самый последний fallback для legacy: вытянуть только названия отелей из program, не весь текст программы.
    if (!out.length) {
      const txt = cleanInline(d.program);
      const hotelRegex = /Размещение\s+в\s+отеле\s+([^\n]+?)(?=\s+(?:🗓\s*)?ДЕНЬ\s*\d+|\s+Выезд|\s+Трансфер|\s+Возвращение|\s+Экскурсия|$)/giu;
      let m;
      while ((m = hotelRegex.exec(txt))) {
        const chunk = String(m[1] || "").trim();
        const [hotelName, cityName] = chunk.split(/,\s*/);
        pushItem(hotelName, null, cityName || null);
      }
    }

    return out.slice(0, 5);
  };

    const normalizeRouteLine = (value) =>
      String(value || "")
        .replace(/\s*[-–—]\s*/g, " → ")
        .replace(/\s*\/\s*/g, " → ")
        .replace(/\s+→\s+/g, " → ")
        .replace(/\s{2,}/g, " ")
        .trim();

    const isGenericAuthorTitle = (value) => {
      const v = String(value || "").trim().toLowerCase();
      return !v || v === "авторский тур" || v === "author tour" || v === "author_tour";
    };

    if (BOT_USERNAME) parts.push(`<i>через @${escapeHtml(BOT_USERNAME)}</i>`);
    parts.push(`🧭 <b>АВТОРСКИЙ ТУР</b> <code>#R${serviceId}</code>`);

    const titleText = normalizeRouteLine(
      normalizeTitleSoft(String(svc.title || d.title || "").trim())
    );

    const routeTitle = normalizeRouteLine(
      norm(d.routeTitle || d.route || d.routeName || "") ||
        joinClean(
          [
            norm(d.directionFrom || d.fromCity || d.cityFrom),
            norm(d.directionTo || d.toCity || d.cityTo),
          ],
          " → "
        )
    );

    // Brochure v2: показываем одну сильную hero-строку маршрута/названия.
    // Не выводим title + route одновременно, чтобы не было дубля вида:
    // "Uzungol - Trabzon - Istanbul" + "Uzungol → Istanbul".
    const heroLine = !isGenericAuthorTitle(titleText) ? titleText : routeTitle;
    if (heroLine) {
      parts.push(`🏔 <b>${escapeHtml(heroLine)}</b>`);
    }

    const countryTitle = norm(d.directionCountry || d.country || d.destinationCountry || "");
    if (countryTitle) parts.push(`🌍 ${escapeHtml(countryTitle)}`);

    pushDivider(parts);

    if (dates) parts.push(`🗓 ${escapeHtml(dates)}`);
    if (nights) {
      parts.push(`🌙 ${escapeHtml(pluralRuNights(nights))}`);
    } else if (norm(d.duration || d.tourDuration || "")) {
      parts.push(labelLine("⏱", "Длительность", norm(d.duration || d.tourDuration || "")));
    }

    const format = authorFormatLabel(d.tourFormat || d.format || "");
    const pax = joinClean(
      [
        d.minPax ? `${d.minPax}` : "",
        d.maxPax ? `${d.maxPax} чел` : "",
      ],
      "–"
    );
    const formatLine = joinClean([format, pax], " • ");
    if (formatLine) parts.push(`👥 ${escapeHtml(formatLine)}`);

    const langLine = norm(d.guideLanguage || d.language || d.languages || "");
    if (langLine) parts.push(`🗣 ${escapeHtml(langLine)}`);

    if (
      d.transportIncluded === true ||
      String(d.transport || "").toLowerCase() === "included" ||
      /^да$/i.test(String(d.transport || ""))
    ) {
      parts.push("🚐 Транспорт включён");
    }

    const meetingPoint =
      norm(d.meetingPoint || d.startPoint || d.pickupPoint || "") ||
      norm(d.directionFrom || d.fromCity || d.cityFrom || "");

    if (meetingPoint) parts.push(`📍 Старт: ${escapeHtml(meetingPoint)}`);

    const stayLines = getStayLines();
    if (stayLines.length) {
      pushDivider(parts);
      parts.push("━━━━━━━━━━");
      parts.push("");
      parts.push("🏨 <b>Проживание</b>");
      for (const line of stayLines) parts.push(`• ${escapeHtml(line)}`);
    }

    const includedItems = splitSmartLines(d.included || d.includes || d.includedText, 12);
    if (includedItems.length) {
      pushDivider(parts);
      parts.push("━━━━━━━━━━");
      parts.push("");
      parts.push("✅ <b>Включено</b>");
      for (const item of includedItems) parts.push(`• ${escapeHtml(item)}`);
    }
    
    const notIncludedItems = splitSmartLines(
      d.notIncluded || d.excluded || d.notIncludedText || d.excludeText,
      12
    );
    
    if (notIncludedItems.length) {
      pushDivider(parts);
      parts.push("━━━━━━━━━━");
      parts.push("");
      parts.push("❌ <b>Не включено</b>");
      for (const item of notIncludedItems) parts.push(`• ${escapeHtml(item)}`);
    }

    if (priceWithCur != null && String(priceWithCur).trim()) {
      pushDivider(parts);
      parts.push(`💰 <b>${escapeHtml(String(priceWithCur))}</b> (${escapeHtml(priceKind)})`);
    }

    if (projectSupportPaid) {
      parts.push("");
      parts.push("💛 <b>Поддерживает проект</b>");
    }

    const authorName =
      providerNameRaw && providerNameRaw !== "Поставщик"
        ? providerNameRaw
        : norm(d.authorName || d.guideName || "");

    const authorTelegramRaw = String(
      d.authorTelegram ||
        d.guideTelegram ||
        svc.provider_telegram ||
        svc.providerTelegram ||
        ""
    ).trim();

    const authorTelegram = authorTelegramRaw
      .replace(/^@/, "")
      .replace(/^https?:\/\/t\.me\//i, "")
      .replace(/^tg:\/\/resolve\?domain=/i, "")
      .trim();

      if (authorName) {
        const providerValue = authorTelegram
          ? a(`https://t.me/${encodeURIComponent(authorTelegram)}`, authorName)
          : escapeHtml(authorName);
      
        parts.push(`🏢 <b>Поставщик:</b> ${providerValue}`);
      }


    // ВАЖНО: программу тура НЕ вставляем в основную карточку.
    // Она открывается отдельной кнопкой «🗓 Программа тура» через handler atp:<serviceId> в bot.js.

    const kbRows = [
      [
        { text: "🗓 Программа тура", callback_data: `atp:${serviceId}` },
        { text: "🌐 Подробнее на сайте", url: serviceUrl },
      ],
    ];

    if (isClientViewer) {
      kbRows.push([
        { text: "👤 Контакты", callback_data: `contacts:${serviceId}` },
        { text: "💬 Быстрый запрос", callback_data: `quick:${serviceId}` },
      ]);
    } else if (isProviderViewer) {
      kbRows.push([{ text: "💬 Быстрый запрос", callback_data: `quick:${serviceId}` }]);
    }

    return {
      text: parts.join("\n"),
      photoUrl: getFirstImageUrl(svc),
      serviceUrl,
      kbExtra: { inline_keyboard: kbRows, replaceDefault: true },
    };
  }

  if ((role !== "provider" || options?.forceRefused === true) && String(category) === "refused_tour") {
    const parts = [];
    if (BOT_USERNAME) parts.push(`<i>через @${escapeHtml(BOT_USERNAME)}</i>`);

    parts.push(`🔥 <b>ОТКАЗНОЙ ТУР</b> <code>#R${serviceId}</code>`);

    const destination = firstValue(d.directionTo, d.toCity, d.cityTo, d.resort, d.city);
    const country2 = firstValue(d.directionCountry, d.country, d.destinationCountry);
    const hotelName = firstValue(d.hotel, d.hotelName, hotel);
    const heroTitle = firstValue(
      destination && country2 ? `${destination}, ${country2}` : destination || country2,
      route,
      titlePretty
    );
    if (heroTitle) parts.push(`🌍 <b>${escapeHtml(heroTitle)}</b>`);
    if (hotelName) parts.push(`🏨 <b>${escapeHtml(hotelName)}</b>`);

    const mainBits = [];
    if (dates) mainBits.push(`${dates}${nights ? ` • ${nights} ноч.` : ""}`);
    if (accommodation) mainBits.push(accommodation);
    if (mainBits.length) parts.push(`📅 ${escapeHtml(mainBits.join(" • "))}`);

    const priceLine = priceHeroLine();
    if (priceLine) parts.push(priceLine);

    const roomCatRaw = d.accommodationCategory || d.roomCategory || d.room || d.roomType || "";
    const roomCat = shortRoomLabel(stripStarsFromRoomCat(roomCatRaw));
    const foodPretty = shortMealLabel(d.food || d.meal || d.mealType);
    const transfers = transferItems();

    const included = [];
    if (firstValue(d.flightIncluded, d.flightsIncluded) || firstValue(d.flightDetails) || hasPositiveFlag(d.includesFlight)) included.push("✈️ перелёт");
    if (transfers.length) included.push(`🚐 ${transfers.join(" / ")}`);
    if (foodPretty) included.push(`🍽 ${foodPretty}`);
    if (roomCat) included.push(`🛏 ${roomCat}`);
    const starsPretty = extractStars(d);
    if (starsPretty) included.push(starsPretty.replace("⭐️", "⭐"));
    if (hasPositiveFlag(d.insuranceIncluded, d.insurance, d.hasInsurance)) included.push("🛡 страховка");
    if (hasPositiveFlag(d.earlyCheckIn)) included.push("🏨 ранний заезд");
    if (hasPositiveFlag(d.lateCheckOut)) included.push("🕘 поздний выезд");
    if (hasPositiveFlag(d.arrivalFastTrack)) included.push("🛬 fast track");

    const includedLine = compactIncludedLine(included, 8);
    if (includedLine) {
      pushDivider(parts);
      parts.push(`✅ <b>Включено:</b> ${escapeHtml(includedLine)}`);
    }

    const flightDetails = norm(d.flightDetails);
    if (flightDetails) parts.push("ℹ️ Детали рейса — по кнопке ниже");

    pushDivider(parts);
    parts.push(smartBadges("refused"));

    providerCompactBlock(parts);

    const extraRows = [];
    if (flightDetails) extraRows.push([{ text: "✈️ Детали рейса", callback_data: `fd:${serviceId}` }]);

    return {
      text: parts.join("\n"),
      photoUrl: getFirstImageUrl(svc),
      serviceUrl,
      kbExtra: sellingKb(extraRows),
    };
  }

  if ((role !== "provider" || options?.forceRefused === true) && String(category) === "refused_hotel") {
    const parts = [];
    if (BOT_USERNAME) parts.push(`<i>через @${escapeHtml(BOT_USERNAME)}</i>`);

    parts.push(`🏨 <b>ОТКАЗНОЙ ОТЕЛЬ</b> <code>#R${serviceId}</code>`);

    const hotelName = firstValue(d.hotel, d.hotelName, titlePretty);
    const city = firstValue(d.directionTo, d.city, d.locationCity, d.toCity);
    const country2 = firstValue(d.directionCountry, d.country, d.locationCountry);
    if (hotelName) parts.push(`🏨 <b>${escapeHtml(hotelName)}</b>`);
    const place = [city, country2].filter(Boolean).join(", ");
    if (place) parts.push(`📍 ${escapeHtml(place)}`);

    const dateBits = [];
    if (dates) dateBits.push(`${dates}${nights ? ` • ${nights} ноч.` : ""}`);
    if (accommodation) dateBits.push(accommodation);
    if (dateBits.length) parts.push(`📅 ${escapeHtml(dateBits.join(" • "))}`);

    const priceLine = priceHeroLine();
    if (priceLine) parts.push(priceLine);

    const roomCatRaw = d.accommodationCategory || d.roomCategory || d.room || d.roomType || "";
    const roomCat = shortRoomLabel(stripStarsFromRoomCat(roomCatRaw));
    const foodPretty = shortMealLabel(d.food || d.meal || d.mealType);
    const transfers = transferItems();

    const included = [];
    const starsPretty = extractStars(d);
    if (starsPretty) included.push(starsPretty.replace("⭐️", "⭐"));
    if (roomCat) included.push(`🛏 ${roomCat}`);
    if (foodPretty) included.push(`🍽 ${foodPretty}${d.halal ? " Halal" : ""}`);
    if (transfers.length) included.push(`🚐 ${transfers.join(" / ")}`);
    if (hasPositiveFlag(d.insuranceIncluded, d.insurance, d.hasInsurance)) included.push("🛡 страховка");
    if (hasPositiveFlag(d.earlyCheckIn)) included.push("🏨 ранний заезд");
    if (hasPositiveFlag(d.lateCheckOut)) included.push("🕘 поздний выезд");
    if (hasPositiveFlag(d.arrivalFastTrack)) included.push("🛬 fast track");
    if (firstValue(d.spa, d.spaIncluded)) included.push(`💆 ${firstValue(d.spa, d.spaIncluded)}`);
    if (firstValue(d.treatment, d.medicalPackage, d.therapyPackage)) included.push(`🩺 ${firstValue(d.treatment, d.medicalPackage, d.therapyPackage)}`);

    const includedLine = compactIncludedLine(included, 8);
    if (includedLine) {
      pushDivider(parts);
      parts.push(`✅ <b>Главное:</b> ${escapeHtml(includedLine)}`);
    }

    pushDivider(parts);
    parts.push(smartBadges("refused"));

    providerCompactBlock(parts);

    return {
      text: parts.join("\n"),
      photoUrl: getFirstImageUrl(svc),
      serviceUrl,
      kbExtra: sellingKb(),
    };
  }

  if ((role !== "provider" || options?.forceRefused === true) && String(category) === "refused_flight") {
    const parts = [];
    if (BOT_USERNAME) parts.push(`<i>через @${escapeHtml(BOT_USERNAME)}</i>`);

    parts.push(`✈️ <b>ОТКАЗНОЙ АВИАБИЛЕТ</b> <code>#R${serviceId}</code>`);

    const fromCity = firstValue(d.directionFrom, d.fromCity, d.cityFrom, d.departureCity);
    const toCity = firstValue(d.directionTo, d.toCity, d.cityTo, d.arrivalCity);
    const country2 = firstValue(d.directionCountry, d.country);
    const routeLine = fromCity && toCity ? `${fromCity} → ${toCity}` : firstValue(route, toCity, fromCity);
    if (routeLine) parts.push(`📍 <b>${escapeHtml(routeLine)}</b>`);
    if (country2 && !routeLine.includes(country2)) parts.push(`🌍 ${escapeHtml(country2)}`);

    const fd = flightDateLabel();
    const tripType = hasReturnFlight() || String(d.tripType || d.flightType || "").toLowerCase().includes("round")
      ? "туда-обратно"
      : "в одну сторону";
    if (fd) parts.push(`📅 ${escapeHtml(fd.value)} • ${escapeHtml(tripType)}`);

    const airline = firstValue(d.airline, d.airCompany, d.carrier);
    const flightNumber = firstValue(d.flightNumber, d.flightNo, d.departureFlightNumber, d.outboundFlightNumber);
    const departureTime = firstValue(d.departureTime, d.departureFlightTime, d.outboundTime, d.timeFrom);
    const arrivalTime = firstValue(d.arrivalTime, d.arrivalFlightTime, d.timeTo);
    const baggage = firstValue(d.baggage, d.luggage, d.baggageInfo, d.baggageAllowance);
    const cabin = firstValue(d.cabinClass, d.class, d.ticketClass, d.serviceClass);
    const seats = firstValue(d.seats, d.quantity, d.passengersCount, d.availableSeats, d.places);

    const flightBits = [];
    if (airline) flightBits.push(`🛫 ${airline}`);
    if (flightNumber) flightBits.push(`№ ${flightNumber}`);
    if (departureTime || arrivalTime) flightBits.push(`🕘 ${[departureTime, arrivalTime].filter(Boolean).join(" → ")}`);
    if (cabin) flightBits.push(`💺 ${cabin}`);
    if (baggage) flightBits.push(`🧳 ${baggage}`);
    if (seats) flightBits.push(`👤 ${seats} мест.`);

    const priceLine = priceHeroLine();
    if (priceLine) parts.push(priceLine);

    const flightLine = compactIncludedLine(flightBits, 8);
    if (flightLine) {
      pushDivider(parts);
      parts.push(`✅ <b>Детали:</b> ${escapeHtml(flightLine)}`);
    }

    const returnFlightNumber = firstValue(d.returnFlightNumber, d.inboundFlightNumber);
    const returnTime = firstValue(d.returnFlightTime, d.inboundTime, d.returnDepartureTime);
    if (returnFlightNumber || returnTime) {
      parts.push(`🔁 <b>Обратно:</b> ${escapeHtml([returnFlightNumber && `№ ${returnFlightNumber}`, returnTime].filter(Boolean).join(" • "))}`);
    }

    const flightDetails = norm(d.flightDetails);
    if (flightDetails) parts.push("ℹ️ Полные детали рейса — по кнопке ниже");

    pushDivider(parts);
    parts.push(smartBadges("flight"));

    providerCompactBlock(parts);

    const extraRows = [];
    if (flightDetails) extraRows.push([{ text: "✈️ Детали рейса", callback_data: `fd:${serviceId}` }]);

    return {
      text: parts.join("\n"),
      photoUrl: getFirstImageUrl(svc),
      serviceUrl,
      kbExtra: sellingKb(extraRows),
    };
  }

    if (
      (role !== "provider" || options?.forceRefused === true) &&
      (String(category) === "refused_ticket" || String(category) === "refused_event_ticket")
    ) {
    const parts = [];
    if (BOT_USERNAME) parts.push(`<i>через @${escapeHtml(BOT_USERNAME)}</i>`);

    const evEmoji = ticketEmoji(d.eventCategory || d.ticketType || d.type || svc.title);
    parts.push(`${evEmoji} <b>ОТКАЗНОЙ БИЛЕТ</b> <code>#R${serviceId}</code>`);

    const eventName = firstValue(d.eventName, d.title, svc.title);
    if (eventName) parts.push(`${evEmoji} <b>${escapeHtml(normalizeTitleSoft(eventName))}</b>`);

    const eventCat = firstValue(d.eventCategory, d.ticketType, d.type);
    const city = firstValue(d.city, d.locationCity, d.directionTo, d.toCity);
    const venue = firstValue(d.venue, d.place, d.location, d.eventPlace, d.hall, d.stadium);
    const placeLine = [city, venue].filter(Boolean).join(" • ");
    if (eventCat) parts.push(`🏷 ${escapeHtml(eventCat)}`);
    if (placeLine) parts.push(`📍 ${escapeHtml(placeLine)}`);

    const ed = eventDateLabel();
    const eventTime = firstValue(d.eventTime, d.time, d.startTime);
    if (ed || eventTime) parts.push(`📅 ${escapeHtml([ed?.value, eventTime].filter(Boolean).join(" • "))}`);

    const priceLine = priceHeroLine();
    if (priceLine) parts.push(priceLine);

    const sector = firstValue(d.sector, d.block, d.zone);
    const row = firstValue(d.row, d.seatRow);
    const seat = firstValue(d.seat, d.placeNumber, d.seatsNumbers);
    const qty = firstValue(d.ticketsCount, d.quantity, d.seats, d.count);
    const format = firstValue(d.ticketFormat, d.deliveryType, d.ticketDelivery, d.format);
    const ticketDetails = firstValue(d.ticketDetails, d.details, d.description);

    const detailBits = [];
    if (sector) detailBits.push(`🪑 сектор ${sector}`);
    if (row) detailBits.push(`ряд ${row}`);
    if (seat) detailBits.push(`место ${seat}`);
    if (qty) detailBits.push(`🎟 ${qty} билет.`);
    if (format) detailBits.push(`📲 ${format}`);
    if (ticketDetails && detailBits.length < 5) detailBits.push(ticketDetails);

    const detailLine = compactIncludedLine(detailBits, 7);
    if (detailLine) {
      pushDivider(parts);
      parts.push(`✅ <b>Детали:</b> ${escapeHtml(detailLine)}`);
    }

    pushDivider(parts);
    parts.push(smartBadges("ticket"));

    providerCompactBlock(parts);

    return {
      text: parts.join("\n"),
      photoUrl: getFirstImageUrl(svc),
      serviceUrl,
      kbExtra: sellingKb(),
    };
  }

  /* ===================== DEFAULT ===================== */

  const parts = [];
  if (BOT_USERNAME) parts.push(`<i>через @${escapeHtml(BOT_USERNAME)}</i>`);
  parts.push(`<b>${escapeHtml(titleDecor)}</b>`);
  if (route) parts.push(`✈️ ${escapeHtml(route)}`);
  if (dates) parts.push(`🗓 ${escapeHtml(dates)}${nights ? ` (${nights} ноч.)` : ""}`);
  if (hotel) parts.push(`🏨 ${escapeHtml(hotel)}`);
  if (accommodation) parts.push(`🛏 ${escapeHtml(accommodation)}`);

  if (priceWithCur != null && String(priceWithCur).trim()) {
    const kind = role === "provider" ? "нетто" : "брутто";
    parts.push(`💸 <b>Цена</b>: ${escapeHtml(String(priceWithCur))} <i>(${escapeHtml(kind)})</i>`);
  }

  if (badgeClean) parts.push(`⏳ ${escapeHtml(badgeClean)}`);

  pushDivider(parts);
  if (shouldShowProviderContacts(role, unlocked)) {
    parts.push(providerLine);
    if (telegramLine) parts.push(telegramLine);
  } else {
    parts.push(labelLine("🏢", "Поставщик", "🔒 скрыт"));
    parts.push("🔓 Откройте контакты для связи");
  }

  pushDivider(parts);
  parts.push(`👉 Подробнее и бронирование: ${a(serviceUrl, "открыть")}`);

  return { text: parts.join("\n"), photoUrl: getFirstImageUrl(svc), serviceUrl };
}

function shouldRenderUnlockButton(role = "client", options = {}) {
  const r = String(role || "").toLowerCase();

  // админ/провайдеру кнопка не нужна
  if (r === "admin" || r === "provider") return false;

  const unlockPrice = Number(
    options?.unlockPrice ??
    options?.effectivePrice ??
    options?.contactUnlockPrice ??
    0
  );

  // в бесплатном режиме кнопка unlock не нужна
  if (unlockPrice <= 0) return false;

  // если уже unlocked — тоже не нужна
  if (options?.unlocked === true) return false;

  return true;
}

module.exports = { buildServiceMessage };
