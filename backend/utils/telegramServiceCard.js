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
  refused_hotel: "Отказной отель",
  refused_flight: "Отказной авиабилет",
  refused_ticket: "Отказной билет",
  refused_event_ticket: "Отказной билет",
};

const CATEGORY_EMOJI = {
  refused_tour: "📍",
  refused_hotel: "🏨",
  refused_flight: "✈️",
  refused_ticket: "🎫",
  refused_event_ticket: "🎫",
};

/* ===================== pretty labels ===================== */

function foodLabel(x) {
  const s = String(x || "").trim().toUpperCase();
  const map = {
    RO: "Без питания (RO)",
    BB: "Завтраки (BB)",
    HB: "Завтрак+ужин (HB)",
    FB: "Полный пансион (FB)",
    AI: "Все включено (AI)",
    UAI: "Ультра все включено (UAI)",
    HALAL: "Халяль (HALAL)",
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

  // ISO / native
  const dNative = new Date(s0);
  if (!isNaN(dNative.getTime())) return dNative;

  // dd.mm.yyyy or dd/mm/yyyy
  let m = s0.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s.*)?$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (yyyy >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(yyyy, mm - 1, dd);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // yyyy.mm.dd
  m = s0.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:\s.*)?$/);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (yyyy >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const d = new Date(yyyy, mm - 1, dd);
      if (!isNaN(d.getTime())) return d;
    }
  }

  return null;
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
    if (fid) return `tgfile:${fid}`;
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
    return fileId ? `tgfile:${fileId}` : null;
  }

  if (v.startsWith("data:image")) {
    return `${TG_IMAGE_BASE}/api/telegram/service-image/${svc.id}`;
  }

  if (v.startsWith("http://") || v.startsWith("https://")) return v;

  if (v.startsWith("/")) return TG_IMAGE_BASE + v;

  return `${TG_IMAGE_BASE}/${v.replace(/^\/+/, "")}`;
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
  if (c.startsWith("refused_")) return c;

  return c; // как есть
}

function guessRefusedCategory(details) {
  const d = details || {};
  // эвристика: по полям details
  if (d.eventCategory || d.ticketDetails || d.ticketType) return "refused_event_ticket";
  if (d.airline || d.flightDetails || d.departureFlightDate || d.returnFlightDate) return "refused_flight";
  if (d.hotel || d.hotelName || d.checkIn || d.checkOut || d.checkInDate || d.checkOutDate) return "refused_hotel";
  return "refused_tour";
}

function buildServiceMessage(svc, category, role = "client") {
  const d = parseDetailsAny(svc.details);
    // ✅ normalize category + страховка
  let catNorm = normalizeCategory(category);

  // если category не передали или он пустой — попробуем взять из svc.category
  if (!catNorm) catNorm = normalizeCategory(svc?.category);

  // если это вообще “refused_*”, но не один из ожидаемых — угадаем по details
  if (role !== "provider" && String(catNorm || "").startsWith("refused_")) {
    const known = new Set([
      "refused_tour",
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

  const start = norm(startRaw);
  const end = norm(endRaw);

  const dates = start && end && start !== end ? `${start} → ${end}` : start || end || "";

  let nights = null;
  try {
    const sdt = start ? parseDateFlexible(start) : null;
    const edt = end ? parseDateFlexible(end) : null;
    if (sdt && edt) {
      const diff = Math.round((edt.getTime() - sdt.getTime()) / 86400000);
      if (diff > 0 && diff < 60) nights = diff;
    }
  } catch {}

  const hotel = norm(d.hotel || d.hotelName);
  const accommodation = norm(d.accommodation);

  const priceRaw = pickPrice(d, svc, role);
  const priceWithCur = formatPriceWithCurrency(priceRaw);

  const badge = getExpiryBadge(d, svc);
  const badgeClean = badge ? String(badge).replace(/^⏳\s*/g, "").trim() : "";

  const providerNameRaw = (svc.provider_name || "Поставщик").trim();
  const providerId = svc.provider_id || svc.providerId || svc.provider?.id || null;
  const providerProfileUrl = providerId ? `${SITE_URL}/profile/provider/${providerId}` : null;

  const providerLine = providerProfileUrl
    ? `Поставщик: ${a(providerProfileUrl, providerNameRaw)}`
    : `Поставщик: ${escapeHtml(providerNameRaw)}`;

  let telegramLine = "";
  if (svc.provider_telegram) {
    let u = String(svc.provider_telegram).trim().replace(/^@/, "");
    u = u.replace(/^https?:\/\/t\.me\//i, "");
    u = u.replace(/^tg:\/\/resolve\?domain=/i, "");
    if (u) telegramLine = `Telegram: ${a(`https://t.me/${encodeURIComponent(u)}`, u)}`;
  }

  /* ===================== PREMIUM helpers ===================== */

  const labelLine = (icon, label, value, boldValue = true) => {
    const v = String(value || "").trim();
    if (!v) return "";
    if (boldValue) return `${icon} <b>${escapeHtml(label)}:</b> <b>${escapeHtml(v)}</b>`;
    return `${icon} <b>${escapeHtml(label)}:</b> ${escapeHtml(v)}`;
  };

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
    const ci =
      norm(d.checkIn || d.checkInDate || d.arrivalDate || d.arrival || d.startDate || "");
    const co =
      norm(d.checkOut || d.checkOutDate || d.departureDate || d.departure || d.endDate || "");

    const lines = [];
    if (ci) lines.push(labelLine("🟢", "Заезд", ci, true));
    if (co) lines.push(labelLine("🔴", "Выезд", co, true));

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
    if (n) lines.push(`🌙 <b>Ночей:</b> <b>${escapeHtml(String(n))}</b>`);
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
    if (city) lines.push(labelLine("🏙", "Город", city, true));
    if (country2) lines.push(labelLine("🌍", "Страна", country2, true));
    if (!lines.length && route) lines.push(labelLine("📍", "Локация", route, true));
    return lines;
  };

  const tourLocationLines = () => {
    const fromCity = norm(d.directionFrom || d.fromCity || d.cityFrom || "");
    const toCity = norm(d.directionTo || d.toCity || d.cityTo || "");
    const country2 = norm(d.directionCountry || d.country || "");
    const lines = [];
    if (fromCity) lines.push(labelLine("🛫", "Город вылета", fromCity, true));
    if (toCity) lines.push(labelLine("🛬", "Город прибытия", toCity, true));
    if (country2) lines.push(labelLine("🌍", "Страна направления", country2, true));
    if (!lines.length && route) lines.push(labelLine("📍", "Маршрут", route, true));
    return lines;
  };

  const flightLocationLines = () => {
    const fromCity = norm(d.directionFrom || d.fromCity || d.cityFrom || "");
    const toCity = norm(d.directionTo || d.toCity || d.cityTo || "");
    const country2 = norm(d.directionCountry || d.country || "");
    const lines = [];
    if (fromCity) lines.push(labelLine("🛫", "Вылет", fromCity, true));
    if (toCity) lines.push(labelLine("🛬", "Прилёт", toCity, true));
    if (country2) lines.push(labelLine("🌍", "Страна", country2, true));
    if (!lines.length && route) lines.push(labelLine("📍", "Маршрут", route, true));
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
    if (city) lines.push(labelLine("🏙", "Город", city, true));
    if (country2) lines.push(labelLine("🌍", "Страна", country2, true));
    const location = norm(d.location);
    if (!lines.length && location) lines.push(labelLine("📍", "Локация", location, true));
    return lines;
  };

  const pushPriceDrop = (parts) => {
    const priceDrop = getPriceDropMeta(svc.details, svc, role);
    if (!priceDrop) return;
    parts.push(priceDrop.header);
    parts.push(priceDrop.diffLine);
  };

  /* ===================== SPECIAL TEMPLATES ===================== */

  if (role !== "provider" && String(category) === "refused_tour") {
    const parts = [];

    if (BOT_USERNAME) parts.push(`<i>через @${escapeHtml(BOT_USERNAME)}</i>`);
    parts.push(`🆕 <b>НОВЫЙ ОТКАЗНОЙ ТУР</b> <code>#R${serviceId}</code>`);

    const tl = titleLine("generic");
    if (tl) parts.push(tl);

    pushPriceDrop(parts);

    const locLines = tourLocationLines();
    for (const line of locLines) parts.push(line);

    if (dates) {
      const dv = `${dates}${nights ? ` (${nights} ноч.)` : ""}`;
      parts.push(labelLine("🗓", "Даты", dv, true));
    }

    if (hotel) parts.push(labelLine("🏨", "Отель", hotel, true));

    const starsPretty = extractStars(d);
    if (starsPretty) parts.push(`${escapeHtml(starsPretty)}`);

    const roomCatRaw = d.accommodationCategory || d.roomCategory || "";
    const roomCatClean = stripStarsFromRoomCat(roomCatRaw);
    const roomCat = norm(roomCatClean);
    if (roomCat) parts.push(labelLine("🛏", "Категория номера", roomCat, false));

    if (accommodation) parts.push(labelLine("👥", "Размещение", accommodation, false));

    if (priceWithCur != null && String(priceWithCur).trim()) {
      parts.push(`💸 <b>Цена:</b> <b>${escapeHtml(String(priceWithCur))}</b> <i>(брутто)</i>`);
    }

    if (badgeClean) parts.push(labelLine("⏳", "Срок", badgeClean, false));

    if (d.changeable === true) parts.push(`🔁 <b>Можно вносить изменения</b>`);
    else parts.push(`✅ <b>Фикс-пакет</b>: без замен (отель/даты/размещение)`);

    parts.push(`⚡ <b>Горящее</b>: такие варианты уходят быстро`);

    parts.push("");
    parts.push(providerLine);
    if (telegramLine) parts.push(telegramLine);

    parts.push("");
    parts.push(`👉 Подробнее и бронирование: ${a(serviceUrl, "открыть")}`);

    return { text: parts.join("\n"), photoUrl: getFirstImageUrl(svc), serviceUrl };
  }

  if (role !== "provider" && String(category) === "refused_hotel") {
    const parts = [];
    if (BOT_USERNAME) parts.push(`<i>через @${escapeHtml(BOT_USERNAME)}</i>`);

    parts.push(`🆕 <b>НОВЫЙ ОТКАЗНОЙ ОТЕЛЬ</b> <code>#R${serviceId}</code>`);

    const tl = titleLine("hotel");
    if (tl) parts.push(tl);

    pushPriceDrop(parts);

    const hl = hotelLocationLines();
    for (const line of hl) parts.push(line);

    const hd = hotelDatesLines();
    for (const line of hd) parts.push(line);

    if (hotel) parts.push(labelLine("🏨", "Отель", hotel, true));

    const starsPretty = extractStars(d);
    if (starsPretty) parts.push(`${escapeHtml(starsPretty)}`);

    const roomCatRaw = d.accommodationCategory || d.roomCategory || "";
    const roomCatClean = stripStarsFromRoomCat(roomCatRaw);
    const roomCat = norm(roomCatClean);
    if (roomCat) parts.push(labelLine("🛏", "Категория номера", roomCat, false));

    if (accommodation) parts.push(labelLine("👥", "Размещение", accommodation, false));

    const foodPretty = foodLabel(d.food);
    if (foodPretty) {
      const halalTag = d.halal ? " • Halal" : "";
      parts.push(labelLine("🍽", "Питание", `${foodPretty}${halalTag}`, false));
    }

    const transferPretty = transferLabel(d.transfer);
    if (transferPretty) parts.push(labelLine("🚗", "Трансфер", transferPretty, false));

    if (d.changeable === true) parts.push(`🔁 <b>Можно вносить изменения</b>`);
    if (d.changeable === false) parts.push(`⛔ <b>Без изменений</b>`);

    if (priceWithCur != null && String(priceWithCur).trim()) {
      parts.push(`💸 <b>Цена:</b> <b>${escapeHtml(String(priceWithCur))}</b> <i>(брутто)</i>`);
    }
    if (badgeClean) parts.push(labelLine("⏳", "Срок", badgeClean, false));

    parts.push(`⚡ <b>Горящее</b>: такие варианты уходят быстро`);

    parts.push("");
    parts.push(providerLine);
    if (telegramLine) parts.push(telegramLine);

    parts.push("");
    parts.push(`👉 Подробнее и бронирование: ${a(serviceUrl, "открыть")}`);

    return { text: parts.join("\n"), photoUrl: getFirstImageUrl(svc), serviceUrl };
  }

  if (role !== "provider" && String(category) === "refused_flight") {
    const parts = [];
    if (BOT_USERNAME) parts.push(`<i>через @${escapeHtml(BOT_USERNAME)}</i>`);

    parts.push(`🆕 <b>НОВЫЙ ОТКАЗНОЙ АВИАБИЛЕТ</b> <code>#R${serviceId}</code>`);

    const tl = titleLine("flight");
    if (tl) parts.push(tl);

    pushPriceDrop(parts);

    const fl = flightLocationLines();
    for (const line of fl) parts.push(line);

    const fd = flightDateLabel();
    if (fd) parts.push(labelLine("🗓", fd.label, fd.value, true));

    if (hasReturnFlight()) {
      parts.push(labelLine("🔁", "Тип", "Туда-обратно", false));
    }

    const airline = norm(d.airline);
    if (airline) parts.push(labelLine("🛫", "Авиакомпания", airline, false));

    const flightDetails = norm(d.flightDetails);
    if (flightDetails) parts.push(labelLine("📝", "Детали", flightDetails, false));

    if (priceWithCur != null && String(priceWithCur).trim()) {
      parts.push(`💸 <b>Цена:</b> <b>${escapeHtml(String(priceWithCur))}</b> <i>(брутто)</i>`);
    }
    if (badgeClean) parts.push(labelLine("⏳", "Срок", badgeClean, false));

    parts.push(`⚡ <b>Горящее</b>: такие варианты уходят быстро`);

    parts.push("");
    parts.push(providerLine);
    if (telegramLine) parts.push(telegramLine);

    parts.push("");
    parts.push(`👉 Подробнее и бронирование: ${a(serviceUrl, "открыть")}`);

    return { text: parts.join("\n"), photoUrl: getFirstImageUrl(svc), serviceUrl };
  }

  if (
    role !== "provider" &&
    (String(category) === "refused_ticket" || String(category) === "refused_event_ticket")
  ) {
    const parts = [];
    if (BOT_USERNAME) parts.push(`<i>через @${escapeHtml(BOT_USERNAME)}</i>`);

    const evEmoji = ticketEmoji(d.eventCategory || d.ticketType || d.type);
    parts.push(
      `🆕 <b>НОВЫЙ ОТКАЗНОЙ БИЛЕТ НА МЕРОПРИЯТИЕ</b> ${evEmoji} <code>#R${serviceId}</code>`
    );

    const tl = titleLine("ticket");
    if (tl) parts.push(tl);

    pushPriceDrop(parts);

    const eventCat = norm(d.eventCategory);
    if (eventCat) parts.push(labelLine(evEmoji, "Категория", eventCat, true));

    const tlc = ticketLocationLines();
    for (const line of tlc) parts.push(line);

    const ed = eventDateLabel();
    if (ed) parts.push(labelLine("🗓", ed.label, ed.value, true));

    const ticketDetails = norm(d.ticketDetails);
    if (ticketDetails) parts.push(labelLine("📝", "Детали", ticketDetails, false));

    if (priceWithCur != null && String(priceWithCur).trim()) {
      parts.push(`💸 <b>Цена:</b> <b>${escapeHtml(String(priceWithCur))}</b> <i>(брутто)</i>`);
    }
    if (badgeClean) parts.push(labelLine("⏳", "Срок", badgeClean, false));

    parts.push(`⚡ <b>Горящее</b>: такие варианты уходят быстро`);

    parts.push("");
    parts.push(providerLine);
    if (telegramLine) parts.push(telegramLine);

    parts.push("");
    parts.push(`👉 Подробнее и бронирование: ${a(serviceUrl, "открыть")}`);

    return { text: parts.join("\n"), photoUrl: getFirstImageUrl(svc), serviceUrl };
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
    parts.push(`💸 <b>${escapeHtml(String(priceWithCur))}</b> <i>(${escapeHtml(kind)})</i>`);
  }

  if (badgeClean) parts.push(`⏳ ${escapeHtml(badgeClean)}`);

  parts.push("");
  parts.push(providerLine);
  if (telegramLine) parts.push(telegramLine);

  parts.push("");
  parts.push(`👉 Подробнее и бронирование: ${a(serviceUrl, "открыть")}`);

  return { text: parts.join("\n"), photoUrl: getFirstImageUrl(svc), serviceUrl };
}

module.exports = { buildServiceMessage };
