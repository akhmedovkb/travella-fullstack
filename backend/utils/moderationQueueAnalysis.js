// Server-side queue classification. Parity with browser rules is covered by tests.
const fmt = n => new Intl.NumberFormat().format(Number(n || 0));
function parseJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeDetails(details) {
  if (!details) return {};
  if (typeof details === "object" && !Array.isArray(details)) return details;
  if (typeof details === "string") {
    const parsed = parseJsonSafe(details, {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  }
  return {};
}

function normalizeImages(images) {
  if (!images) return [];
  const normalizeOne = (item) => {
    if (typeof item === "string") return item.trim();
    if (item && typeof item === "object") return String(item.url || item.src || item.imageUrl || "").trim();
    return "";
  };
  if (Array.isArray(images)) return images.map(normalizeOne).filter(Boolean);

  if (typeof images === "string") {
    const parsed = parseJsonSafe(images, null);
    if (Array.isArray(parsed)) return parsed.map(normalizeOne).filter(Boolean);
    if (parsed && typeof parsed === "string") return [parsed.trim()].filter(Boolean);
    return images.trim() ? [images.trim()] : [];
  }

  return [];
}

function getPublicServiceImages(images, detailsInput) {
  const details = normalizeDetails(detailsInput);
  const candidates = [
    ...normalizeImages(images),
    ...normalizeImages(details.images),
    ...normalizeImages(details.photos),
    ...normalizeImages(details.photoUrls),
    ...normalizeImages(details.galleryImages),
    details.image,
    details.imageUrl,
    details.cover,
    details.coverImage,
    details.photo,
    details.photoUrl,
  ];

  return [...new Set(candidates.map((value) => String(value || "").trim()).filter(Boolean))];
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v === 0) return v;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v !== null && typeof v !== "undefined" && v !== "") return v;
  }
  return null;
}

function hasText(value) {
  if (value === 0) return true;
  if (value === true || value === false) return true;
  if (Array.isArray(value)) return value.length > 0;
  return String(value ?? "").trim() !== "";
}

function parseMoneyValue(value) {
  if (value === null || typeof value === "undefined") return null;
  const raw = String(value)
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseDateValue(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const isoLike = raw.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoLike) {
    const d = new Date(Number(isoLike[1]), Number(isoLike[2]) - 1, Number(isoLike[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const ruLike = raw.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (ruLike) {
    const d = new Date(Number(ruLike[3]), Number(ruLike[2]) - 1, Number(ruLike[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getModerationReadiness(form, details, images) {
  const title = pickFirst(
    form.title,
    details.title,
    details.hotel,
    details.eventName,
    details.ticketTitle,
    details.directionTo
  );
  const direction = pickFirst(
    details.direction,
    details.directionTo,
    details.directionCountry,
    details.location
  );
  const dateFrom = pickFirst(
    details.departureFlightDate,
    details.departureDate,
    details.startFlightDate,
    details.startDate,
    details.checkInDate,
    details.eventDate
  );
  const price = pickFirst(details.grossPrice, details.gross_price, details.price, form.price);
  const cover = getPublicServiceImages(images, details)[0] || "";
  const providerContact = pickFirst(
    form.telegram_refused_chat_id,
    form.telegram_web_chat_id,
    form.telegram_chat_id
  );
  const accommodation = pickFirst(
    details.hotel,
    details.eventName,
    details.accommodation,
    details.roomCategory
  );

  return [
    { key: "title", label: "Название", ok: hasText(title), required: true },
    { key: "direction", label: "Направление", ok: hasText(direction), required: true },
    { key: "date", label: "Дата начала", ok: hasText(dateFrom), required: true },
    { key: "price", label: "Цена Gross", ok: hasText(price), required: true },
    { key: "photo", label: "Фото", ok: hasText(cover), required: true },
    { key: "contact", label: "Контакт поставщика", ok: hasText(providerContact), required: true },
    { key: "accommodation", label: "Отель/размещение", ok: hasText(accommodation), required: false },
    { key: "food", label: "Питание", ok: hasText(details.food), required: false },
  ];
}

function getDangerIssues(form, details, images) {
  const issues = [];
  const gross = parseMoneyValue(pickFirst(details.grossPrice, details.gross_price, details.price, form.price));
  const net = parseMoneyValue(pickFirst(details.netPrice, details.net_price, details.priceNet, details.price_net));
  const dateFromRaw = pickFirst(
    details.departureFlightDate,
    details.departureDate,
    details.startFlightDate,
    details.startDate,
    details.checkInDate,
    details.eventDate
  );
  const dateFrom = parseDateValue(dateFromRaw);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const proofImages = normalizeImages(details.proofImages);
  const hasProof = proofImages.length > 0 || hasText(details.telegramProofFileId) || hasText(details.proofUrl);
  const hasPhoto = getPublicServiceImages(images, details).length > 0;
  const hasProviderContact = hasText(
    pickFirst(form.telegram_refused_chat_id, form.telegram_web_chat_id, form.telegram_chat_id)
  );

  if (gross != null && net != null && gross < net) {
    issues.push({
      key: "gross-below-net",
      title: "Gross ниже Netto",
      text: `Gross ${fmt(gross)} меньше Netto ${fmt(net)}. Проверьте цену перед публикацией.`,
      blocking: true,
    });
  }

  if (dateFrom && dateFrom < today) {
    issues.push({
      key: "past-date",
      title: "Дата уже прошла",
      text: `Дата начала ${dateFromRaw} уже в прошлом.`,
      blocking: true,
    });
  }

  if (!hasProviderContact) {
    issues.push({
      key: "no-contact",
      title: "Нет Telegram контакта поставщика",
      text: "Клиент не сможет быстро связаться с поставщиком.",
      blocking: true,
    });
  }

  if (!hasPhoto) {
    issues.push({
      key: "no-photo",
      title: "Нет фото карточки",
      text: "Карточка будет выглядеть слабее в канале и на сайте.",
      blocking: true,
    });
  }

  if (!hasProof) {
    issues.push({
      key: "no-proof",
      title: "Нет proof",
      text: "Нет подтверждения подлинности. Можно сохранить, но публиковать рискованно.",
      blocking: false,
    });
  }

  return issues;
}

function editFormFromService(svc = {}) {
  const provider = svc.provider || {};
  return {
    title: svc.title || "",
    description: svc.description || "",
    category: svc.category || "",
    price: svc.price ?? "",
    vehicle_model: svc.vehicle_model || "",
    telegram_refused_chat_id:
      svc.telegram_refused_chat_id ||
      svc.provider_telegram_refused_chat_id ||
      provider.telegram_refused_chat_id ||
      svc.provider_tg_chat_id ||
      provider.telegram_chat_id ||
      "",
    telegram_web_chat_id:
      svc.telegram_web_chat_id || svc.provider_telegram_web_chat_id || provider.telegram_web_chat_id || "",
    telegram_chat_id:
      svc.telegram_chat_id || svc.provider_telegram_chat_id || svc.provider_tg_chat_id || provider.telegram_chat_id || "",
  };
}

function analyzeModerationService(svc = {}) {
  const details = normalizeDetails(svc.details);
  const images = normalizeImages(svc.images);
  const form = editFormFromService(svc);
  const readinessItems = getModerationReadiness(form, details, images);
  const dangerIssues = getDangerIssues(form, details, images);
  const missingRequired = readinessItems.filter((item) => item.required && !item.ok);
  const blockingIssues = dangerIssues.filter((issue) => issue.blocking);
  const warningIssues = dangerIssues.filter((issue) => !issue.blocking);
  const ready = missingRequired.length === 0 && blockingIssues.length === 0;
  const hasCorrectionHistory =
    String(svc.last_moderation_action || "").toLowerCase() === "rejected" &&
    String(svc.status || svc.moderation_status || "").toLowerCase() !== "rejected";
  const priority =
    (blockingIssues.length ? 100 : 0) +
    missingRequired.length * 12 +
    warningIssues.length * 3 +
    (hasCorrectionHistory ? 8 : 0) +
    (svc.status === "rejected" ? 1 : 0);

  return {
    form,
    details,
    images,
    readinessItems,
    dangerIssues,
    missingRequired,
    blockingIssues,
    warningIssues,
    ready,
    hasCorrectionHistory,
    priority,
  };
}

function getQueueMetrics(items = []) {
  return items.reduce(
    (acc, svc) => {
      const analysis = analyzeModerationService(svc);
      acc.total += 1;
      if (analysis.ready) acc.ready += 1;
      if (!analysis.ready) acc.needFix += 1;
      if (analysis.hasCorrectionHistory) acc.afterCorrection += 1;
      if (analysis.dangerIssues.some((x) => x.key === "no-proof")) acc.noProof += 1;
      if (analysis.dangerIssues.some((x) => x.key === "no-photo")) acc.noPhoto += 1;
      if (analysis.dangerIssues.some((x) => x.key === "no-contact")) acc.noContact += 1;
      if (analysis.dangerIssues.some((x) => x.key === "gross-below-net")) acc.badPrice += 1;
      if (analysis.dangerIssues.some((x) => x.key === "past-date")) acc.pastDate += 1;
      return acc;
    },
    {
      total: 0,
      ready: 0,
      needFix: 0,
      afterCorrection: 0,
      noProof: 0,
      noPhoto: 0,
      noContact: 0,
      badPrice: 0,
      pastDate: 0,
    }
  );
}

function matchesQueueFilter(svc, filter) {
  if (filter === "all") return true;
  const analysis = analyzeModerationService(svc);
  if (filter === "ready") return analysis.ready;
  if (filter === "needFix") return !analysis.ready;
  if (filter === "afterCorrection") return analysis.hasCorrectionHistory;
  return analysis.dangerIssues.some((issue) => issue.key === filter);
}

function getPublishedMetrics(items = []) {
  return items.reduce(
    (acc, svc) => {
      acc.total += 1;
      acc.views += Number(svc.views_count || 0);
      acc.unlocks += Number(svc.contact_unlocks_count || 0);
      acc.requests += Number(svc.quick_requests_count || 0);
      if (String(svc.last_moderation_action || "").toLowerCase() === "telegram_failed") acc.telegramFailed += 1;
      if (Number(svc.contact_unlocks_count || 0) === 0) acc.noUnlocks += 1;
      if (Number(svc.quick_requests_count || 0) === 0) acc.noRequests += 1;
      if (Number(svc.quick_requests_count || 0) > 0) acc.hasRequests += 1;
      return acc;
    },
    { total: 0, views: 0, unlocks: 0, requests: 0, telegramFailed: 0, noUnlocks: 0, noRequests: 0, hasRequests: 0 }
  );
}

function matchesPublishedFilter(svc, filter) {
  const action = String(svc.last_moderation_action || "").toLowerCase();
  const unlocks = Number(svc.contact_unlocks_count || 0);
  const requests = Number(svc.quick_requests_count || 0);
  if (filter === "telegramFailed") return action === "telegram_failed";
  if (filter === "noUnlocks") return unlocks === 0;
  if (filter === "noRequests") return requests === 0;
  if (filter === "hasRequests") return requests > 0;
  return true;
}

function comparePublishedItems(a, b, sort) {
  if (sort === "views") return Number(b.views_count || 0) - Number(a.views_count || 0);
  if (sort === "unlocks") return Number(b.contact_unlocks_count || 0) - Number(a.contact_unlocks_count || 0);
  if (sort === "requests") return Number(b.quick_requests_count || 0) - Number(a.quick_requests_count || 0);
  if (sort === "problems") {
    const score = (svc) =>
      (String(svc.last_moderation_action || "").toLowerCase() === "telegram_failed" ? 100 : 0) +
      (Number(svc.contact_unlocks_count || 0) === 0 ? 10 : 0) +
      (Number(svc.quick_requests_count || 0) === 0 ? 5 : 0);
    const diff = score(b) - score(a);
    if (diff) return diff;
  }
  const at = new Date(a.published_at || a.approved_at || a.updated_at || 0).getTime();
  const bt = new Date(b.published_at || b.approved_at || b.updated_at || 0).getTime();
  return bt - at;
}
module.exports = { analyzeModerationService, getQueueMetrics, matchesQueueFilter, getPublishedMetrics, matchesPublishedFilter, comparePublishedItems };
