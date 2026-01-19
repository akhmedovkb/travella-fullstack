// backend/utils/telegramServiceCard.js
const { parseDateFlexible } = require("../telegram/helpers/serviceActual");

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
};

const CATEGORY_EMOJI = {
  refused_tour: "📍",
  refused_hotel: "🏨",
  refused_flight: "✈️",
  refused_ticket: "🎫",
};

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

function extractStars(details) {
  const d = details || {};
  const raw = String(d.accommodationCategory || d.roomCategory || "").trim();
  if (!raw) return null;

  const m = raw.match(/([1-7])\s*\*|⭐\s*([1-7])/);
  const stars = m ? Number(m[1] || m[2]) : null;
  if (!stars) return null;

  return `⭐️ ${stars}*`;
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

/* ===================== MAIN CARD BUILDER (1:1 из bot.js) ===================== */
function getPriceDropBadge(detailsRaw, svc, role) {
  const d = parseDetailsAny(detailsRaw);

  const prev =
    d.previousPrice ??
    d.oldPrice ??
    null;

  const current = pickPrice(d, svc, role);

  if (!prev || !current) return null;

  const p = Number(String(prev).replace(/[^\d.]/g, ""));
  const c = Number(String(current).replace(/[^\d.]/g, ""));

  if (!Number.isFinite(p) || !Number.isFinite(c)) return null;

  if (c < p) {
    return "⬇️ <b>Стоимость стала ниже</b>";
  }

  return null;
}

function buildServiceMessage(svc, category, role = "client") {
  const d = parseDetailsAny(svc.details);

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
  const route = joinClean([from && to ? `${from} → ${to}` : (to || from), country]);

  const startRaw = d.departureFlightDate || d.startDate || d.startFlightDate || "";
  const endRaw = d.returnFlightDate || d.endDate || d.endFlightDate || "";
  const start = norm(startRaw);
  const end = norm(endRaw);

  const dates = start && end && start !== end ? `${start} → ${end}` : (start || end || "");

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

  if (role !== "provider" && String(category) === "refused_tour") {
    const parts = [];

    if (BOT_USERNAME) parts.push(`<i>через @${escapeHtml(BOT_USERNAME)}</i>`);

    parts.push(`🆕 <b>НОВЫЙ ОТКАЗНОЙ ТУР</b> <code>#R${serviceId}</code>`);
    if (route) parts.push(`✈️ <b>${escapeHtml(route)}</b>`);

    if (dates) {
      parts.push(`🗓 <b>${escapeHtml(dates)}${nights ? ` (${nights} ноч.)` : ""}</b>`);
    }

    if (hotel) parts.push(`🏨 <b>${escapeHtml(hotel)}</b>`);
    if (accommodation) parts.push(`🛏 ${escapeHtml(accommodation)}`);

    if (priceWithCur != null && String(priceWithCur).trim()) {
      parts.push(`💸 <b>${escapeHtml(String(priceWithCur))}</b> <i>(брутто)</i>`);
    }
    const priceDropBadge = getPriceDropBadge(svc.details, svc, role);
      if (priceDropBadge) {
        parts.push(priceDropBadge);
      }
    
    if (badgeClean) parts.push(`⏳ <b>Срок:</b> ${escapeHtml(badgeClean)}`);

    parts.push(`✅ <b>Фикс-пакет</b>: без замен (отель/даты/размещение)`);
    parts.push(`⚡ <b>Горящее</b>: такие варианты уходят быстро`);

    parts.push("");
    parts.push(providerLine);
    if (telegramLine) parts.push(telegramLine);

    parts.push("");
    parts.push(`👉 Подробнее и бронирование: ${a(serviceUrl, "открыть")}`);

    return { text: parts.join("\n"), photoUrl: getFirstImageUrl(svc), serviceUrl };
  }

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
