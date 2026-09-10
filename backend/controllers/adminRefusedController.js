// backend/controllers/adminRefusedController.js
const db = require("../db");

// Telegram send + keyboards/helpers
const { tgSend, tgSendPhoto } = require("../utils/telegram");
const CLIENT_BOT_TOKEN = (process.env.TELEGRAM_CLIENT_BOT_TOKEN || "").trim();
const { buildServiceMessage } = require("../utils/telegramServiceCard");
const { getContactUnlockSettings } = require("../utils/contactUnlockSettings");

const PUBLIC_CHANNEL_CHAT_ID_RAW = (
  process.env.TELEGRAM_PUBLIC_CHANNEL_ID ||
  process.env.TG_PUBLIC_CHANNEL_ID ||
  process.env.TELEGRAM_ANNOUNCE_CHANNEL_ID ||
  process.env.TELEGRAM_CHANNEL_ID ||
  ""
).trim();

function normalizeTelegramPublishChatId(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";

  raw = raw
    .replace(/^https?:\/\/t\.me\//i, "@")
    .replace(/^t\.me\//i, "@")
    .replace(/\?.*$/, "")
    .replace(/\/.*$/, "")
    .trim();

  if (!raw) return "";
  if (raw.startsWith("@")) return raw;
  if (/^-100\d+$/.test(raw)) return raw;
  if (/^-\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `-100${raw}`;
  return raw;
}

const PUBLIC_CHANNEL_CHAT_ID = normalizeTelegramPublishChatId(PUBLIC_CHANNEL_CHAT_ID_RAW);

// helpers для проверки актуальности услуги
const {
  isServiceActual,
  parseDateFlexible,
} = require("../telegram/helpers/serviceActual");
const {
  buildSvcActualKeyboard,
} = require("../telegram/keyboards/serviceActual");

// безопасный парсинг details (json/json-string/null)
function parseDetailsAny(details) {
  if (!details) return {};
  if (typeof details === "object") return details;
  if (typeof details === "string") {
    try {
      const parsed = JSON.parse(details);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

// SAFE DATE PARSER (never throws)
// поддерживает "кривые" YYYY-16-01 (swap month/day)
function parseDateSafe(val) {
  if (!val) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) return val;
  const s = String(val).trim();
  if (!s) return null;

  // expected YYYY-MM-DD
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    let [, y, a, b] = m;
    let mm = Number(a);
    let dd = Number(b);

    // swap if month > 12 and day <= 12 (e.g. 2026-16-01 -> 2026-01-16)
    if (mm > 12 && dd <= 12) {
      [mm, dd] = [dd, mm];
    }

    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

    const iso = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(
      2,
      "0"
    )}`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // fallback: parseDateFlexible (понимает YYYY.MM.DD и datetime)
  return parseDateFlexible ? parseDateFlexible(s) : null;
}

// взять chatId провайдера
function pickProviderChatId(p) {
  return (
    p?.telegram_refused_chat_id ||
    p?.telegram_web_chat_id ||
    p?.telegram_chat_id ||
    p?.tg_chat_id ||
    p?.chatId ||
    null
  );
}

function tiyinToSum(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n / 100);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isBlank(value) {
  return value == null || String(value).trim() === "";
}

function firstFilled(...values) {
  for (const value of values) {
    if (!isBlank(value)) return String(value).trim();
  }
  return "";
}

function hasRefusedPrice(row, detailsObj) {
  return !isBlank(
    firstFilled(
      row?.price,
      row?.net_price,
      row?.gross_price,
      detailsObj?.netPrice,
      detailsObj?.grossPrice,
      detailsObj?.publicPrice,
      detailsObj?.price,
      detailsObj?.amount,
      detailsObj?.ticketPrice,
      detailsObj?.totalPrice,
      detailsObj?.pricePerPerson
    )
  );
}

function hasRefusedImages(row, detailsObj) {
  const arrays = [
    row?.images,
    row?.photos,
    detailsObj?.images,
    detailsObj?.photos,
    detailsObj?.photoUrls,
    detailsObj?.proofImages,
  ];
  if (arrays.some((arr) => Array.isArray(arr) && arr.some((x) => !isBlank(x)))) return true;

  return [
    row?.image,
    row?.image_url,
    row?.photo,
    row?.photo_url,
    detailsObj?.image,
    detailsObj?.imageUrl,
    detailsObj?.photo,
    detailsObj?.photoUrl,
    detailsObj?.mainImage,
    detailsObj?.coverImage,
  ].some((x) => !isBlank(x));
}

function hasProviderContact(row) {
  return [
    row?.p_phone,
    row?.p_email,
    row?.p_social,
    row?.telegram_refused_chat_id,
    row?.telegram_web_chat_id,
    row?.telegram_chat_id,
    row?.tg_chat_id,
  ].some((x) => !isBlank(x));
}

function buildRefusedQualityFlags(row, detailsObj, actual) {
  const flags = [];
  if (!actual) flags.push({ key: "actual", label: "подтвердить актуальность" });
  if (!hasRefusedPrice(row, detailsObj)) flags.push({ key: "price", label: "указать цену" });
  if (!hasRefusedImages(row, detailsObj)) flags.push({ key: "photo", label: "добавить фото" });
  if (!hasProviderContact(row)) flags.push({ key: "contact", label: "добавить контакт поставщика" });
  if (!pickProviderChatId(row)) flags.push({ key: "tg", label: "открыть Telegram-бота Travella и нажать /start" });
  return flags;
}

// дата для сортировки/отображения
function getStartDateForAdminSort(svc) {
  const d = parseDetailsAny(svc.details);
  const cat = String(svc.category || "").toLowerCase();

  const pick = (...keys) => {
    for (const k of keys) {
      const v = d?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (v instanceof Date) return v;
    }
    return null;
  };

  // 1) Новый единый стандарт для всех refused_* услуг
  let raw = pick("startDate", "start_date");

  // 2) Обратная совместимость со старыми данными
  if (!raw) {
    if (cat === "refused_hotel") {
      raw = pick(
        "checkinDate",
        "checkInDate",
        "check_in",
        "check_in_date",
        "dateFrom",
        "date_from",
        "date"
      );
    } else if (cat === "refused_ticket") {
      raw = pick(
        "eventDate",
        "event_date",
        "date",
        "dateFrom",
        "date_from"
      );
    } else if (cat === "refused_flight") {
      raw = pick(
        "departureFlightDate",
        "departureDate",
        "departure_date",
        "startFlightDate",
        "start_flight_date",
        "flightDate",
        "flight_date",
        "dateFrom",
        "date_from",
        "date"
      );
    } else {
      // refused_tour и общий fallback
      raw = pick(
        "dateFrom",
        "date_from",
        "departureFlightDate",
        "departureDate",
        "departure_date",
        "flightDate",
        "flight_date",
        "checkinDate",
        "checkInDate",
        "check_in",
        "check_in_date",
        "eventDate",
        "event_date",
        "date"
      );
    }
  }

  let dt = parseDateSafe(raw);
  if (dt) return dt;

  // fallback по конечной дате, если стартовая не найдена/битая
  raw = pick(
    "endDate",
    "end_date",
    "checkoutDate",
    "checkOutDate",
    "checkout_date",
    "returnFlightDate",
    "endFlightDate"
  );
  dt = parseDateSafe(raw);
  return dt || null;
}

function normalizeMeta(detailsObj) {
  const d = detailsObj && typeof detailsObj === "object" ? detailsObj : {};
  if (
    !d.tg_actual_reminders_meta ||
    typeof d.tg_actual_reminders_meta !== "object"
  ) {
    d.tg_actual_reminders_meta = {};
  }
  return d;
}

function nowIso() {
  return new Date().toISOString();
}

function adminRefusedCategoryWhere(alias = "s") {
  return `((${alias}.category LIKE 'refused_%') OR ${alias}.category = 'author_tour')`;
}


function isAdminRefusedCategoryValue(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "author_tour" || v.startsWith("refused_");
}

exports.listActualRefused = async (req, res) => {
  try {
    const {
      category = "", // refused_tour / refused_hotel / refused_flight / refused_ticket
      status = "", // published / approved / draft / rejected / deleted
      q = "",
      page = "1",
      limit = "30",

      // all | actual | inactive
      actuality: actualityRaw = "",

      // backward compatibility:
      // includeInactive=1 => all, includeInactive=0 => actual
      includeInactive = "",

      // 0 => only non-deleted, 1 => include deleted too
      showDeleted = "0",

      // sorting
      sortBy: sortByRaw = "sort_date", // created_at | provider | sort_date | id
      sortOrder: sortOrderRaw = "asc", // asc | desc
    } = req.query;

    const sortBy = String(sortByRaw || "sort_date").toLowerCase();
    const sortOrder =
      String(sortOrderRaw || "asc").toLowerCase() === "desc" ? "desc" : "asc";
    const dir = sortOrder === "desc" ? -1 : 1;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);

    let actuality = String(actualityRaw || "").trim().toLowerCase();
    if (!["all", "actual", "inactive"].includes(actuality)) {
      if (String(includeInactive) === "1") actuality = "all";
      else actuality = "actual";
    }

    const where = [];
    const params = [];

    where.push(adminRefusedCategoryWhere('s'));

    if (String(showDeleted) !== "1") {
      where.push(`s.deleted_at IS NULL`);
    }

    if (category && isAdminRefusedCategoryValue(category)) {
      params.push(category);
      where.push(`s.category = $${params.length}`);
    }

    if (status) {
      params.push(status);
      where.push(`LOWER(s.status) = LOWER($${params.length})`);
    } else if (String(showDeleted) === "1") {
      // без фильтра по status, чтобы видеть и deleted
    } else {
      where.push(`LOWER(s.status) IN ('published', 'approved')`);
    }

    if (q && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      const pIdx = params.length;
      where.push(`
        (
          LOWER(COALESCE(s.title,'')) LIKE $${pIdx}
          OR LOWER(COALESCE(p.name,'')) LIKE $${pIdx}
          OR LOWER(COALESCE(p.phone,'')) LIKE $${pIdx}
          OR LOWER(COALESCE(p.social,'')) LIKE $${pIdx}
          OR LOWER(COALESCE(s.details::text,'')) LIKE $${pIdx}
        )
      `);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      SELECT
        s.id,
        s.category,
        s.status,
        s.title,
        s.provider_id,
        s.created_at,
        s.updated_at,
        s.deleted_at,
        s.deleted_by,
        s.expiration_at AS expiration,
        s.details,

        p.id AS p_id,
        p.name AS p_name,
        p.phone AS p_phone,
        p.social AS p_social,
        p.telegram_refused_chat_id,
        p.telegram_web_chat_id,
        p.telegram_chat_id,
        p.tg_chat_id

      FROM services s
      JOIN providers p ON p.id = s.provider_id
      ${whereSql}
      ORDER BY s.id DESC
    `;

    const rowsRes = await db.query(sql, params);
    const rows = Array.isArray(rowsRes.rows) ? rowsRes.rows : [];

    let items = rows.map((r) => {
      const detailsObj = parseDetailsAny(r.details);
      const actual = isServiceActual(detailsObj, r);
      const dt = getStartDateForAdminSort(r);
      const chatId = pickProviderChatId(r);
      const meta = (detailsObj && detailsObj.tg_actual_reminders_meta) || {};
      const publicationMeta = (detailsObj && detailsObj.admin_publication_meta) || {};
      const fixRequestMeta = (detailsObj && detailsObj.admin_fix_request_meta) || {};

      return {
        id: r.id,
        category: r.category,
        status: r.status,
        title: r.title,
        providerId: r.provider_id,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
        deletedBy: r.deleted_by || null,
        expiration: r.expiration ? new Date(r.expiration).toISOString() : null,
        provider: {
          id: r.p_id,
          name: r.p_name,
          phone: r.p_phone,
          telegramUsername: r.p_social,
          telegram_refused_chat_id: r.telegram_refused_chat_id || null,
          telegram_web_chat_id: r.telegram_web_chat_id || null,
          telegram_chat_id: r.telegram_chat_id || null,
          tg_chat_id: r.tg_chat_id || null,
          chatId,
        },
        details: detailsObj,
        isActual: !!actual,
        startDateForSort: dt ? dt.toISOString() : null,
        meta: {
          lastSentAt: meta.lastSentAt || null,
          lastAnswer: meta.lastAnswer || null,
          lastConfirmedAt: meta.lastConfirmedAt || null,
          lockUntil: meta.lockUntil || null,
          lastSentBy: meta.lastSentBy || null,
          publicChannelPublishedAt: publicationMeta.publicChannelPublishedAt || null,
          publicChannelMessageId: publicationMeta.publicChannelMessageId || null,
          publicChannelChatId: publicationMeta.publicChannelChatId || null,
          publicChannelPublishedBy: publicationMeta.publicChannelPublishedBy || null,
          fixRequestedAt: fixRequestMeta.requestedAt || null,
          fixFirstRequestedAt: fixRequestMeta.firstRequestedAt || fixRequestMeta.requestedAt || null,
          fixRequestedBy: fixRequestMeta.requestedBy || null,
          fixRequestFlags: Array.isArray(fixRequestMeta.flags) ? fixRequestMeta.flags : [],
          fixRequestFollowUpCount: Number(fixRequestMeta.followUpCount || 0),
          fixRequestLastAutoFollowUpAt: fixRequestMeta.lastAutoFollowUpAt || null,
          fixNoResponseAt: fixRequestMeta.noResponseAt || null,
        },
      };
    });

    if (actuality === "actual") {
      items = items.filter((x) => x.isActual);
    } else if (actuality === "inactive") {
      items = items.filter((x) => !x.isActual);
    }

    items.sort((a, b) => {
      if (sortBy === "created_at") {
        const da = a.createdAt ? new Date(a.createdAt) : null;
        const dbb = b.createdAt ? new Date(b.createdAt) : null;
        if (!da && !dbb) return 0;
        if (!da) return 1;
        if (!dbb) return -1;
        return (da.getTime() - dbb.getTime()) * dir;
      }

      if (sortBy === "provider") {
        const pa = (a.provider?.name || "").toString().toLowerCase();
        const pb = (b.provider?.name || "").toString().toLowerCase();
        return pa.localeCompare(pb, "ru", { sensitivity: "base" }) * dir;
      }
      if (sortBy === "id") {
        return (Number(a.id || 0) - Number(b.id || 0)) * dir;
      }

      const da = a.startDateForSort ? new Date(a.startDateForSort) : null;
      const dbb = b.startDateForSort ? new Date(b.startDateForSort) : null;
      if (!da && !dbb) return 0;
      if (!da) return 1;
      if (!dbb) return -1;
      return (da.getTime() - dbb.getTime()) * dir;
    });

    const total = items.length;
    const offset = (pageNum - 1) * limitNum;
    const paged = items.slice(offset, offset + limitNum);

    res.json({
      success: true,
      total,
      page: pageNum,
      limit: limitNum,
      sortBy,
      sortOrder,
      actuality,
      showDeleted: String(showDeleted) === "1" ? "1" : "0",
      items: paged,
    });
  } catch (e) {
    console.error("[adminRefused] listActualRefused error:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.getRefusedById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Bad id" });
    }

    const sql = `
      SELECT
        s.*,
        p.id AS p_id,
        p.name AS p_name,
        p.phone AS p_phone,
        p.social AS p_social,
        p.telegram_refused_chat_id,
        p.telegram_web_chat_id,
        p.telegram_chat_id,
        p.tg_chat_id
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      WHERE s.id = $1
      LIMIT 1
    `;
    const r = await db.query(sql, [id]);
    const row = r.rows?.[0];
    if (!row) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const detailsObj = parseDetailsAny(row.details);
    const chatId = pickProviderChatId(row);
    const reminderMeta = detailsObj.tg_actual_reminders_meta || {};
    const publicationMeta = detailsObj.admin_publication_meta || {};
    const fixRequestMeta = detailsObj.admin_fix_request_meta || {};

    const svcForActual = {
      ...row,
      expiration: row.expiration_at || row.expiration || null,
    };

    res.json({
      success: true,
      item: {
        id: row.id,
        category: row.category,
        status: row.status,
        title: row.title,
        providerId: row.provider_id,
        createdAt: row.created_at
          ? new Date(row.created_at).toISOString()
          : null,
        updatedAt: row.updated_at
          ? new Date(row.updated_at).toISOString()
          : null,
        deletedAt: row.deleted_at
          ? new Date(row.deleted_at).toISOString()
          : null,
        deletedBy: row.deleted_by || null,
        expiration: row.expiration_at
          ? new Date(row.expiration_at).toISOString()
          : null,
        details: detailsObj,
        provider: {
          id: row.p_id,
          name: row.p_name,
          phone: row.p_phone,
          telegramUsername: row.p_social,
          telegram_refused_chat_id: row.telegram_refused_chat_id || null,
          telegram_web_chat_id: row.telegram_web_chat_id || null,
          telegram_chat_id: row.telegram_chat_id || null,
          tg_chat_id: row.tg_chat_id || null,
          chatId,
        },
        meta: {
          lastSentAt: reminderMeta.lastSentAt || null,
          lastAnswer: reminderMeta.lastAnswer || null,
          lastConfirmedAt: reminderMeta.lastConfirmedAt || null,
          lockUntil: reminderMeta.lockUntil || null,
          lastSentBy: reminderMeta.lastSentBy || null,
          publicChannelPublishedAt: publicationMeta.publicChannelPublishedAt || null,
          publicChannelMessageId: publicationMeta.publicChannelMessageId || null,
          publicChannelChatId: publicationMeta.publicChannelChatId || null,
          publicChannelPublishedBy: publicationMeta.publicChannelPublishedBy || null,
          fixRequestedAt: fixRequestMeta.requestedAt || null,
          fixFirstRequestedAt: fixRequestMeta.firstRequestedAt || fixRequestMeta.requestedAt || null,
          fixRequestedBy: fixRequestMeta.requestedBy || null,
          fixRequestFlags: Array.isArray(fixRequestMeta.flags) ? fixRequestMeta.flags : [],
          fixRequestFollowUpCount: Number(fixRequestMeta.followUpCount || 0),
          fixRequestLastAutoFollowUpAt: fixRequestMeta.lastAutoFollowUpAt || null,
          fixNoResponseAt: fixRequestMeta.noResponseAt || null,
        },
        isActual: isServiceActual(detailsObj, svcForActual),
        startDateForSort: (() => {
          const dt = getStartDateForAdminSort(row);
          return dt ? dt.toISOString() : null;
        })(),
      },
    });
  } catch (e) {
    console.error("[adminRefused] getRefusedById error:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

async function publishRefusedServiceToPublicChannel(id, actor = {}, options = {}) {
  const sid = Number(id || 0);
  if (!Number.isFinite(sid) || sid <= 0) {
    return { success: false, code: "BAD_ID", message: "Bad id" };
  }

  if (!PUBLIC_CHANNEL_CHAT_ID) {
    return {
      success: false,
      code: "NO_PUBLIC_CHANNEL",
      message: "TELEGRAM_PUBLIC_CHANNEL_ID is not configured",
    };
  }

  const sql = `
    SELECT
      s.*,
      p.id AS p_id,
      p.name AS p_name,
      to_jsonb(p)->>'company_name' AS p_company_name,
      p.phone AS p_phone,
      p.social AS p_social,
      p.email AS p_email,
      p.telegram_refused_chat_id,
      p.telegram_web_chat_id,
      p.telegram_chat_id,
      p.tg_chat_id
    FROM services s
    JOIN providers p ON p.id = s.provider_id
    WHERE s.id = $1
      AND s.deleted_at IS NULL
      AND ((s.category LIKE 'refused_%') OR s.category = 'author_tour')
    LIMIT 1
  `;
  const r = await db.query(sql, [sid]);
  const row = r.rows?.[0];
  if (!row) {
    return { success: false, code: "NOT_FOUND", message: "Service not found" };
  }

  const detailsObj = parseDetailsAny(row.details);
  const existingPublication = detailsObj.admin_publication_meta || {};
  if (existingPublication.publicChannelPublishedAt && !options.force) {
    return {
      success: false,
      code: "ALREADY_PUBLISHED",
      message: "Service was already published to public channel",
      id: sid,
      publishedAt: existingPublication.publicChannelPublishedAt,
      messageId: existingPublication.publicChannelMessageId || null,
    };
  }

  const actual = isServiceActual(detailsObj, {
    ...row,
    expiration: row.expiration_at || row.expiration || null,
  });
  if (!actual) {
    return { success: false, code: "NOT_ACTUAL", message: "Service is not actual" };
  }

  const unlockSettings = await getContactUnlockSettings(db).catch(() => null);
  const unlockPrice = tiyinToSum(unlockSettings?.effective_price || 0) || Number(process.env.CONTACT_UNLOCK_PRICE || 10000);
  const botUsername = (
    process.env.TELEGRAM_CLIENT_BOT_USERNAME ||
    process.env.TELEGRAM_BOT_USERNAME ||
    ""
  )
    .replace(/^@/, "")
    .trim();
  const siteUrl = (process.env.SITE_PUBLIC_URL || process.env.SITE_URL || "https://travella.uz").replace(/\/+$/, "");
  const deepLink = botUsername
    ? `https://t.me/${botUsername}?start=${encodeURIComponent(`operator_${sid}`)}`
    : `${siteUrl}/?service=${sid}`;

  const serviceForCard = {
    ...row,
    id: row.id,
    category: row.category,
    type: row.category,
    details: detailsObj,
    provider: {
      id: row.p_id,
      name: row.p_name,
      companyName: row.p_company_name,
      phone: row.p_phone,
      email: row.p_email,
      telegramUsername: row.p_social,
      telegram_refused_chat_id: row.telegram_refused_chat_id || null,
      telegram_web_chat_id: row.telegram_web_chat_id || null,
      telegram_chat_id: row.telegram_chat_id || null,
      tg_chat_id: row.tg_chat_id || null,
    },
  };

  const built = buildServiceMessage(serviceForCard, row.category || "refused_tour", "client", {
    audience: "public",
    publicSafe: true,
    unlocked: false,
    unlockPrice,
    forceHideProviderContacts: true,
    forceShowProviderContacts: false,
    publicOpenBotUrl: deepLink,
    forceRefused: String(row.category || "").startsWith("refused_") || row.category === "author_tour",
  });

  const text = String(built?.text || "").trim();
  const rows = Array.isArray(built?.kbExtra?.inline_keyboard)
    ? [...built.kbExtra.inline_keyboard]
    : [];
  const hasContactButton = rows.some((buttonRow) =>
    (buttonRow || []).some((btn) => String(btn?.text || "").includes("Связаться"))
  );
  if (!hasContactButton) rows.unshift([{ text: "💬 Связаться с поставщиком", url: deepLink }]);
  const replyMarkup = { inline_keyboard: rows };

  let sendResult = null;
  if (built?.photoUrl) {
    sendResult = await tgSendPhoto(
      PUBLIC_CHANNEL_CHAT_ID,
      built.photoUrl,
      text,
      { parse_mode: "HTML", reply_markup: replyMarkup },
      CLIENT_BOT_TOKEN,
      true
    );
  } else {
    await tgSend(
      PUBLIC_CHANNEL_CHAT_ID,
      text,
      { reply_markup: replyMarkup },
      CLIENT_BOT_TOKEN,
      true
    );
    sendResult = { ok: true };
  }

  const messageId = sendResult?.result?.message_id || sendResult?.message_id || null;
  const nextDetails = {
    ...detailsObj,
    admin_publication_meta: {
      ...(detailsObj.admin_publication_meta || {}),
      publicChannelPublishedAt: new Date().toISOString(),
      publicChannelMessageId: messageId,
      publicChannelChatId: PUBLIC_CHANNEL_CHAT_ID,
      publicChannelPublishedBy: actor?.id || null,
    },
  };

  await db.query(
    `
      UPDATE services
      SET details = $2::jsonb,
          status = CASE WHEN LOWER(COALESCE(status,'')) IN ('draft','pending','rejected') THEN 'published' ELSE status END,
          published_at = COALESCE(published_at, NOW()),
          updated_at = NOW()
      WHERE id = $1
    `,
    [sid, JSON.stringify(nextDetails)]
  );

  return {
    success: true,
    id: sid,
    messageId,
    channel: PUBLIC_CHANNEL_CHAT_ID,
  };
}

exports.publishRefusedService = async (req, res) => {
  try {
    const force = req.query?.force === "1" || req.body?.force === true || req.body?.force === "1";
    const result = await publishRefusedServiceToPublicChannel(req.params.id, req.user || {}, { force });
    const status = result.success ? 200 : result.code === "NOT_FOUND" ? 404 : 400;
    return res.status(status).json(result);
  } catch (e) {
    console.error("[adminRefused] publishRefusedService error:", e?.response?.data || e?.message || e);
    return res.status(500).json({
      success: false,
      code: "PUBLISH_FAILED",
      message: e?.response?.data?.description || e?.message || "Publish failed",
    });
  }
};

exports.publishRefusedBulk = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
      : [];
    const force = req.body?.force === true || req.body?.force === "1";

    if (!ids.length) {
      return res.status(400).json({ success: false, message: "No ids" });
    }

    const uniqueIds = [...new Set(ids)].slice(0, 25);
    const results = [];
    for (const id of uniqueIds) {
      try {
        results.push(await publishRefusedServiceToPublicChannel(id, req.user || {}, { force }));
      } catch (e) {
        results.push({
          success: false,
          id,
          code: "PUBLISH_FAILED",
          message: e?.response?.data?.description || e?.message || "Publish failed",
        });
      }
    }

    return res.json({
      success: true,
      requested: uniqueIds.length,
      published: results.filter((x) => x.success).length,
      failed: results.filter((x) => !x.success).length,
      results,
    });
  } catch (e) {
    console.error("[adminRefused] publishRefusedBulk error:", e?.message || e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

async function requestRefusedFixForService(id, actor = {}, options = {}) {
  const sid = Number(id || 0);
  if (!Number.isFinite(sid) || sid <= 0) {
    return { success: false, code: "BAD_ID", message: "Bad id" };
  }

  const sql = `
    SELECT
      s.*,
      p.id AS p_id,
      p.name AS p_name,
      to_jsonb(p)->>'company_name' AS p_company_name,
      p.phone AS p_phone,
      p.social AS p_social,
      p.email AS p_email,
      p.telegram_refused_chat_id,
      p.telegram_web_chat_id,
      p.telegram_chat_id,
      p.tg_chat_id
    FROM services s
    JOIN providers p ON p.id = s.provider_id
    WHERE s.id = $1
      AND s.deleted_at IS NULL
      AND ((s.category LIKE 'refused_%') OR s.category = 'author_tour')
    LIMIT 1
  `;
  const r = await db.query(sql, [sid]);
  const row = r.rows?.[0];
  if (!row) return { success: false, code: "NOT_FOUND", message: "Service not found", id: sid };

  const chatId = pickProviderChatId(row);
  if (!chatId) {
    return {
      success: false,
      code: "NO_PROVIDER_CHAT_ID",
      message: "У провайдера нет Telegram chatId",
      id: sid,
    };
  }

  const detailsObj = parseDetailsAny(row.details);
  const actual = isServiceActual(detailsObj, {
    ...row,
    expiration: row.expiration_at || row.expiration || null,
  });
  const flags = buildRefusedQualityFlags(row, detailsObj, actual);
  if (!flags.length) {
    return { success: false, code: "NO_FIX_NEEDED", message: "Card is already ready", id: sid };
  }

  const title = firstFilled(row.title, detailsObj.title, detailsObj.hotel, detailsObj.hotelName, `Услуга #${sid}`);
  const providerName = firstFilled(row.p_company_name, row.p_name, "Поставщик");
  const siteUrl = (process.env.SITE_PUBLIC_URL || process.env.SITE_URL || "https://travella.uz").replace(/\/+$/, "");
  const serviceUrl = `${siteUrl}/dashboard?from=admin&service=${encodeURIComponent(sid)}`;
  const flagLines = flags.map((flag) => `• ${escapeHtml(flag.label)}`).join("\n");
  const text = [
    options.followUp
      ? `⏰ <b>Повторное напоминание: нужно исправить карточку Travella</b>`
      : `🛠 <b>Нужно исправить карточку Travella</b>`,
    ``,
    `Здравствуйте, ${escapeHtml(providerName)}.`,
    `По услуге <b>#${sid}</b> нужно обновить данные, чтобы мы могли опубликовать её в подборке отказных предложений.`,
    ``,
    `📌 <b>${escapeHtml(title)}</b>`,
    ``,
    `<b>Что нужно добавить/проверить:</b>`,
    flagLines,
    ``,
    `После исправления откройте <b>Мои услуги</b> в боте или в кабинете Travella и обновите карточку.`,
  ].join("\n");

  const replyMarkup = {
    inline_keyboard: [
      [{ text: "📋 Мои услуги", url: serviceUrl }],
    ],
  };

  await tgSend(chatId, text, { reply_markup: replyMarkup }, CLIENT_BOT_TOKEN, true);

  const nextDetails = {
    ...detailsObj,
    admin_fix_request_meta: {
      ...(detailsObj.admin_fix_request_meta || {}),
      requestedAt: new Date().toISOString(),
      firstRequestedAt: detailsObj.admin_fix_request_meta?.firstRequestedAt || detailsObj.admin_fix_request_meta?.requestedAt || new Date().toISOString(),
      requestedBy: actor?.id || null,
      flags: flags.map((flag) => flag.key),
      labels: flags.map((flag) => flag.label),
      followUpCount: options.followUp
        ? Number(detailsObj.admin_fix_request_meta?.followUpCount || 0) + 1
        : Number(detailsObj.admin_fix_request_meta?.followUpCount || 0),
      lastAutoFollowUpAt: options.followUp
        ? new Date().toISOString()
        : detailsObj.admin_fix_request_meta?.lastAutoFollowUpAt || null,
      noResponseAt: options.markNoResponse
        ? new Date().toISOString()
        : detailsObj.admin_fix_request_meta?.noResponseAt || null,
    },
  };

  await db.query(
    `
      UPDATE services
      SET details = $2::jsonb,
          updated_at = NOW()
      WHERE id = $1
    `,
    [sid, JSON.stringify(nextDetails)]
  );

  return { success: true, id: sid, chatId, flags: flags.map((flag) => flag.key) };
}

exports.requestRefusedFixForServiceInternal = requestRefusedFixForService;

exports.requestFixRefusedService = async (req, res) => {
  try {
    const result = await requestRefusedFixForService(req.params.id, req.user || {});
    const status = result.success ? 200 : result.code === "NOT_FOUND" ? 404 : 400;
    return res.status(status).json(result);
  } catch (e) {
    console.error("[adminRefused] requestFixRefusedService error:", e?.response?.data || e?.message || e);
    return res.status(500).json({
      success: false,
      code: "FIX_REQUEST_FAILED",
      message: e?.response?.data?.description || e?.message || "Fix request failed",
    });
  }
};

exports.requestFixRefusedBulk = async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0)
      : [];

    if (!ids.length) return res.status(400).json({ success: false, message: "No ids" });

    const uniqueIds = [...new Set(ids)].slice(0, 50);
    const results = [];
    for (const id of uniqueIds) {
      try {
        results.push(await requestRefusedFixForService(id, req.user || {}));
      } catch (e) {
        results.push({
          success: false,
          id,
          code: "FIX_REQUEST_FAILED",
          message: e?.response?.data?.description || e?.message || "Fix request failed",
        });
      }
    }

    return res.json({
      success: true,
      requested: uniqueIds.length,
      sent: results.filter((x) => x.success).length,
      noChat: results.filter((x) => x.code === "NO_PROVIDER_CHAT_ID").length,
      noFixNeeded: results.filter((x) => x.code === "NO_FIX_NEEDED").length,
      failed: results.filter((x) => !x.success && !["NO_PROVIDER_CHAT_ID", "NO_FIX_NEEDED"].includes(x.code)).length,
      results,
    });
  } catch (e) {
    console.error("[adminRefused] requestFixRefusedBulk error:", e?.message || e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

async function sendActualityQuestionForService(id, { force = false, lastSentBy = "admin" } = {}) {
  if (!id) {
    return { success: false, code: "BAD_ID", message: "Bad id" };
  }

  const sql = `
    SELECT
      s.id, s.category, s.status, s.title, s.details, s.provider_id,
      p.telegram_refused_chat_id,
      p.telegram_web_chat_id,
      p.telegram_chat_id,
      p.tg_chat_id,
      p.social, p.phone, p.name
    FROM services s
    JOIN providers p ON p.id = s.provider_id
    WHERE s.id = $1
      AND s.deleted_at IS NULL
    LIMIT 1
  `;
  const r = await db.query(sql, [id]);
  const row = r.rows?.[0];
  if (!row) {
    return { success: false, code: "NOT_FOUND", message: "Not found" };
  }

  const chatId = pickProviderChatId(row);
  if (!chatId) {
    return {
      success: false,
      code: "NO_PROVIDER_CHAT_ID",
      message: "У провайдера нет Telegram chatId. Попросите поставщика открыть Telegram-бота и нажать /start, либо внесите chatId вручную через TG inline edit.",
      serviceId: row.id,
    };
  }

  const detailsObj = normalizeMeta(parseDetailsAny(row.details));
  const meta = detailsObj.tg_actual_reminders_meta;

  const escapeHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  if (!force && meta.lockUntil) {
    const lock = new Date(meta.lockUntil);
    if (!isNaN(lock.getTime()) && lock.getTime() > Date.now()) {
      return {
        success: false,
        code: "LOCKED",
        message: `Locked until ${meta.lockUntil}`,
        locked: true,
        serviceId: row.id,
        meta: {
          lockUntil: meta.lockUntil,
          lastSentAt: meta.lastSentAt || null,
        },
      };
    }
  }

  const keyboard = buildSvcActualKeyboard(row.id, { isActual: true });
  const safeTitle = escapeHtml((row.title || "Услуга").toString().slice(0, 80));
  const safeCategory = escapeHtml(row.category);
  const d = parseDetailsAny(row.details);

  const dateInfo =
    (d.startDate && d.endDate && `${d.startDate} → ${d.endDate}`) ||
    (d.checkinDate &&
      d.checkoutDate &&
      `${d.checkinDate} → ${d.checkoutDate}`) ||
    (d.checkInDate &&
      d.checkOutDate &&
      `${d.checkInDate} → ${d.checkOutDate}`) ||
    (d.departureFlightDate &&
      `${d.departureFlightDate}${
        d.returnFlightDate ? ` → ${d.returnFlightDate}` : ""
      }`) ||
    (d.eventDate && String(d.eventDate)) ||
    "";

  const placeInfo =
    [d.directionCountry, d.directionFrom, d.directionTo]
      .filter(Boolean)
      .join(" / ") ||
    [d.country, d.city].filter(Boolean).join(" / ") ||
    (d.hotel && String(d.hotel)) ||
    "";

  const msg =
    `⏰ <b>Проверка актуальности</b>\n\n` +
    `Код: <code>#R${row.id}</code>\n` +
    `Услуга: <b>${safeTitle}</b>\n` +
    (placeInfo
      ? `Направление/отель: <b>${escapeHtml(placeInfo)}</b>\n`
      : "") +
    (dateInfo ? `Даты: <b>${escapeHtml(dateInfo)}</b>\n` : "") +
    `Категория: <code>${safeCategory}</code>\n\n` +
    `Актуально ли предложение сейчас?`;

  const sendOk = await tgSend(
    chatId,
    msg,
    {
      reply_markup: keyboard,
      disable_web_page_preview: true,
    },
    CLIENT_BOT_TOKEN || ""
  );

  meta.lastSentAt = nowIso();
  meta.lastSentBy = lastSentBy || "admin";
  meta.lockUntil = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  meta.lastSendOk = !!sendOk;

  await db.query(`UPDATE services SET details = $1 WHERE id = $2`, [
    JSON.stringify(detailsObj),
    row.id,
  ]);

  return {
    success: true,
    ok: !!sendOk,
    sent: !!sendOk,
    chatId,
    serviceId: row.id,
    message: "Sent",
    meta: {
      lastSentAt: meta.lastSentAt,
      lockUntil: meta.lockUntil,
      lastSentBy: meta.lastSentBy,
    },
  };
}

exports.askActualNow = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const force = String(req.query.force || "0") === "1";
    const result = await sendActualityQuestionForService(id, { force, lastSentBy: "admin" });

    if (result.code === "BAD_ID") {
      return res.status(400).json(result);
    }
    if (result.code === "NOT_FOUND") {
      return res.status(404).json(result);
    }

    return res.json(result);
  } catch (e) {
    console.error("[adminRefused] askActualNow error:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.askActualBulk = async (req, res) => {
  try {
    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = Array.from(
      new Set(
        rawIds
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x) && x > 0)
      )
    ).slice(0, 100);

    if (!ids.length) {
      return res.status(400).json({
        success: false,
        message: "ids must be a non-empty array",
      });
    }

    const force = String(req.query.force || req.body?.force || "0") === "1";
    const results = [];

    for (const id of ids) {
      try {
        const result = await sendActualityQuestionForService(id, {
          force,
          lastSentBy: "admin_bulk",
        });
        results.push(result);
      } catch (e) {
        results.push({
          success: false,
          serviceId: id,
          code: "ERROR",
          message: e?.message || "Send error",
        });
      }
    }

    const sent = results.filter((x) => x?.sent || x?.ok).length;
    const locked = results.filter((x) => x?.locked || x?.code === "LOCKED").length;
    const noChat = results.filter((x) => x?.code === "NO_PROVIDER_CHAT_ID").length;
    const notFound = results.filter((x) => x?.code === "NOT_FOUND").length;
    const failed = results.length - sent - locked;

    return res.json({
      success: true,
      ok: true,
      total: ids.length,
      sent,
      locked,
      noChat,
      notFound,
      failed,
      results,
    });
  } catch (e) {
    console.error("[adminRefused] askActualBulk error:", e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.extendRefusedService = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Bad id" });
    }

    const checkRes = await db.query(
      `
      SELECT id, category, status, details, expiration_at
      FROM services
      WHERE id = $1
        AND deleted_at IS NULL
        AND ((category LIKE 'refused_%') OR category = 'author_tour')
      LIMIT 1
      `,
      [id]
    );

    const row = checkRes.rows?.[0];
    if (!row) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const updRes = await db.query(
      `
      UPDATE services
         SET
           expiration_at = COALESCE(expiration_at, NOW()) + interval '7 days',
           details = jsonb_set(
             jsonb_set(
               COALESCE(details::jsonb, '{}'::jsonb),
               '{isActive}',
               'true'::jsonb,
               true
             ),
             '{expiration}',
             to_jsonb(
               (COALESCE(expiration_at, NOW()) + interval '7 days')::timestamp
             )::jsonb,
             true
           ),
           updated_at = NOW()
       WHERE id = $1
         AND deleted_at IS NULL
         AND ((category LIKE 'refused_%') OR category = 'author_tour')
       RETURNING id, category, status, details, expiration_at, updated_at
      `,
      [id]
    );

    const updated = updRes.rows?.[0];
    return res.json({
      success: true,
      message: "Extended",
      item: {
        ...updated,
        details: parseDetailsAny(updated?.details),
      },
    });
  } catch (e) {
    console.error("[adminRefused] extendRefusedService error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteRefusedService = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Bad id" });
    }

    const actorId = Number(req.user?.id) || null;

    const delRes = await db.query(
      `
      UPDATE services
         SET
           status = 'deleted',
           deleted_at = NOW(),
           deleted_by = $2,
           updated_at = NOW()
       WHERE id = $1
         AND deleted_at IS NULL
         AND ((category LIKE 'refused_%') OR category = 'author_tour')
       RETURNING id
      `,
      [id, actorId]
    );

    if (!delRes.rowCount) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    return res.json({
      success: true,
      message: "Deleted",
      id,
    });
  } catch (e) {
    console.error("[adminRefused] deleteRefusedService error:", e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.restoreRefusedService = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Bad id",
      });
    }

    const upd = await db.query(
      `
      UPDATE services
      SET
        deleted_at = NULL,
        deleted_by = NULL,
        status = 'published',
        updated_at = NOW()
      WHERE id = $1
        AND ((category LIKE 'refused_%') OR category = 'author_tour')
      RETURNING id
      `,
      [id]
    );

    if (!upd.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
      });
    }

    return res.json({
      success: true,
      message: "Service restored",
      id,
    });
  } catch (e) {
    console.error("[adminRefused] restoreRefusedService error:", e);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
