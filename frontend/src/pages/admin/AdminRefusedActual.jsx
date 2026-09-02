// frontend/src/pages/admin/AdminRefusedActual.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

/**
 * Admin tool: shows refused_* services + manual actions + full edit modal
 *
 * Backend endpoints:
 *  - GET    /api/admin/refused/actual
 *  - GET    /api/admin/refused/:id
 *  - POST   /api/admin/refused/:id/ask-actual?force=1
 *  - POST   /api/admin/refused/ask-actual/bulk
 *  - POST   /api/admin/refused/:id/extend
 *  - DELETE /api/admin/refused/:id
 *  - POST   /api/admin/refused/:id/restore
 *  - GET    /api/admin/services/:id
 *  - PUT    /api/admin/services/:id
 */

function getAuthToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("adminToken") ||
    localStorage.getItem("providerToken") ||
    sessionStorage.getItem("token") ||
    ""
  );
}

function getRuntimeApiBase() {
  try {
    const v = window?.frontend?.API_BASE;
    return (v || "").toString().trim();
  } catch {
    return "";
  }
}

function getEnvApiBase() {
  const v =
    (
      import.meta?.env?.VITE_API_BASE_URL ||
      import.meta?.env?.VITE_API_URL ||
      import.meta?.env?.VITE_API_BASE ||
      ""
    )
      .toString()
      .trim();
  return v;
}

function normalizeApiBase(raw) {
  return (raw || "").toString().trim().replace(/\/+$/, "");
}

function getProductionApiFallback() {
  try {
    const host = (window?.location?.hostname || "").toLowerCase();
    if (host === "travella.uz" || host === "www.travella.uz") {
      return "https://travella-fullstack-production.up.railway.app";
    }
  } catch {
    // ignore
  }
  return "";
}

function computeApiPrefix(base) {
  if (!base) return "/api";
  const b = base.replace(/\/+$/, "");
  return b.endsWith("/api") ? "" : "/api";
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function short(s, n = 60) {
  const x = (s || "").toString();
  if (x.length <= n) return x;
  return x.slice(0, n - 1) + "…";
}

function classNames(...a) {
  return a.filter(Boolean).join(" ");
}

function isProbablyHtmlPayload(data, contentType) {
  if (contentType && String(contentType).toLowerCase().includes("text/html")) {
    return true;
  }
  if (typeof data !== "string") return false;
  const t = data.trim().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

function extractAxiosError(e) {
  const status = e?.response?.status || e?.__resp?.status;
  const contentType =
    e?.response?.headers?.["content-type"] ||
    e?.__resp?.headers?.["content-type"];
  const data = e?.response?.data ?? e?.__resp?.data;

  let msg =
    e?.response?.data?.message ||
    e?.response?.data?.error ||
    e?.message ||
    "Ошибка";

  if (isProbablyHtmlPayload(data, contentType)) {
    const hint =
      "API вернул HTML вместо JSON. Обычно это значит, что API_BASE не настроен и запрос ушёл на фронтенд вместо backend.";
    msg = `${hint} (status=${status || "?"}, content-type=${contentType || "?"})`;
  } else if (typeof data === "string" && data.trim()) {
    msg = `${msg} (status=${status || "?"})`;
  } else if (status) {
    msg = `${msg} (status=${status})`;
  }

  const snippet =
    typeof data === "string" ? data.trim().slice(0, 180) : null;

  return { msg, status, contentType, snippet };
}

function safeJsonParse(input, fallback) {
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}

function toDateTimeLocal(value) {
  if (!value) return "";
  const s = String(value).trim();
  if (!s) return "";

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00`;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function toNumericString(v) {
  if (v === null || typeof v === "undefined" || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
}

function calcMargin(details) {
  const net = Number(details?.netPrice || 0);
  const gross = Number(details?.grossPrice || 0);
  if (!Number.isFinite(net) || !Number.isFinite(gross)) return null;
  return gross - net;
}

function isBlank(v) {
  return v == null || String(v).trim() === "";
}

function parseFiniteNumber(v) {
  if (v == null || String(v).trim() === "") return null;
  const normalized = String(v).replace(",", ".").replace(/[^\d.-]/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeChatId(v) {
  const s = String(v ?? "").trim();
  return s;
}

function isValidChatId(v) {
  const s = normalizeChatId(v);
  return !s || /^-?\d+$/.test(s);
}

function getProviderTelegramFields(obj = {}) {
  return {
    telegram_refused_chat_id: normalizeChatId(obj?.telegram_refused_chat_id),
    telegram_web_chat_id: normalizeChatId(obj?.telegram_web_chat_id),
    telegram_chat_id: normalizeChatId(obj?.telegram_chat_id),
  };
}

function getEffectiveProviderChatId(obj = {}) {
  return (
    normalizeChatId(obj?.telegram_refused_chat_id) ||
    normalizeChatId(obj?.telegram_web_chat_id) ||
    normalizeChatId(obj?.telegram_chat_id) ||
    ""
  );
}

function validateEditForm(form) {
  const result = {
    valid: true,
    summary: [],
    root: {},
    details: {},
    provider: {},
    raw: {},
  };

  if (!form) return result;

  const add = (bucket, key, msg) => {
    result[bucket][key] = msg;
    result.summary.push(msg);
    result.valid = false;
  };

  if (isBlank(form.title)) add("root", "title", "Название услуги обязательно.");
  if (!isBlank(form.price)) {
    const n = parseFiniteNumber(form.price);
    if (n === null) add("root", "price", "Цена услуги должна быть числом.");
    else if (n < 0) add("root", "price", "Цена услуги не может быть отрицательной.");
  }

  const tg = getProviderTelegramFields(form);
  for (const [key, label] of [
    ["telegram_refused_chat_id", "TG refused chat id"],
    ["telegram_web_chat_id", "TG web chat id"],
    ["telegram_chat_id", "TG default chat id"],
  ]) {
    if (!isValidChatId(tg[key])) add("provider", key, `${label}: только цифры и optional минус спереди.`);
  }

  const rawDetails = safeJsonParse(form.rawDetailsText || "{}", null);
  if (!rawDetails || typeof rawDetails !== "object" || Array.isArray(rawDetails)) {
    add("raw", "details", "Raw details JSON должен быть объектом.");
  }

  const rawImages = safeJsonParse(form.rawImagesText || "[]", null);
  if (!Array.isArray(rawImages)) {
    add("raw", "images", "images JSON должен быть массивом.");
  }

  const rawAvailability = safeJsonParse(form.rawAvailabilityText || "[]", null);
  if (!Array.isArray(rawAvailability)) {
    add("raw", "availability", "availability JSON должен быть массивом.");
  }

  const details = form.details && typeof form.details === "object" && !Array.isArray(form.details)
    ? form.details
    : {};

  for (const key of ["netPrice", "grossPrice", "previousPrice"]) {
    if (!isBlank(details[key])) {
      const n = parseFiniteNumber(details[key]);
      if (n === null) add("details", key, `${key} должен быть числом.`);
      else if (n < 0) add("details", key, `${key} не может быть отрицательным.`);
    }
  }

  const dateKeys = {
    startDate: "Дата начала",
    endDate: "Дата конца",
    departureFlightDate: "Дата вылета",
    returnFlightDate: "Дата обратно",
    returnDate: "Дата возврата",
    expiration: "Срок актуальности",
  };

  for (const [key, label] of Object.entries(dateKeys)) {
    const raw = details[key];
    if (!isBlank(raw)) {
      const ts = Date.parse(String(raw));
      if (!Number.isFinite(ts)) add("details", key, `${label}: неверная дата.`);
    }
  }

  const comparePairs = [
    ["startDate", "endDate", "Дата конца не может быть раньше даты начала."],
    ["startDate", "returnDate", "Дата возврата не может быть раньше даты вылета."],
    ["departureFlightDate", "returnFlightDate", "Дата обратно не может быть раньше даты вылета."],
  ];
  for (const [leftKey, rightKey, msg] of comparePairs) {
    const left = details[leftKey];
    const right = details[rightKey];
    if (!isBlank(left) && !isBlank(right)) {
      const l = Date.parse(String(left));
      const r = Date.parse(String(right));
      if (Number.isFinite(l) && Number.isFinite(r) && r < l) {
        add("details", rightKey, msg);
      }
    }
  }

  const net = parseFiniteNumber(details.netPrice);
  const gross = parseFiniteNumber(details.grossPrice);
  if (net != null && gross != null && gross < net) {
    add("details", "grossPrice", "grossPrice не может быть меньше netPrice.");
  }

  return result;
}

function readUrlSort() {
  try {
    const sp = new URLSearchParams(window.location.search || "");
    const sortBy = (sp.get("sortBy") || "sort_date").toLowerCase();
    const sortOrder =
      (sp.get("sortOrder") || "asc").toLowerCase() === "desc" ? "desc" : "asc";

    const allowed = new Set(["created_at", "provider", "sort_date", "id"]);
    return {
      sortBy: allowed.has(sortBy) ? sortBy : "sort_date",
      sortOrder,
    };
  } catch {
    return { sortBy: "sort_date", sortOrder: "asc" };
  }
}

function writeUrlSort(sortBy, sortOrder) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("sortBy", sortBy);
    url.searchParams.set("sortOrder", sortOrder);
    window.history.replaceState({}, "", url.toString());
  } catch {
    // ignore
  }
}

function SortBadge({ active, dir }) {
  if (!active) return null;
  return (
    <span
      className={classNames(
        "ml-2 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        dir === "asc"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-indigo-200 bg-indigo-50 text-indigo-700"
      )}
    >
      {dir === "asc" ? "ASC" : "DESC"}
    </span>
  );
}

function Badge({ children, tone = "gray" }) {
  const tones = {
    gray: "bg-gray-100 text-gray-700 border-gray-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
  };

  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone] || tones.gray
      )}
    >
      {children}
    </span>
  );
}


function categoryHumanLabel(category) {
  const map = {
    refused_tour: "Отказной тур",
    author_tour: "Авторский тур",
    refused_hotel: "Отказной отель",
    refused_flight: "Авиабилет",
    refused_ticket: "Билет",
    refused_event_ticket: "Билет",
  };
  return map[category] || category || "Отказ";
}

function categoryAccent(category) {
  if (category === "refused_tour") return "from-orange-50 to-amber-50 border-orange-100 text-orange-700";
  if (category === "author_tour") return "from-emerald-50 to-teal-50 border-emerald-100 text-emerald-700";
  if (category === "refused_hotel") return "from-sky-50 to-cyan-50 border-sky-100 text-sky-700";
  if (category === "refused_flight") return "from-violet-50 to-fuchsia-50 border-violet-100 text-violet-700";
  return "from-slate-50 to-gray-50 border-slate-100 text-slate-700";
}

function getEditorTabs(editForm, validation) {
  const imageCount = Array.isArray(editForm?.images)
    ? editForm.images.length
    : 0;

  const proofCount = Array.isArray(editForm?.details?.proofImages)
    ? editForm.details.proofImages.length
    : 0;

  const mainErrors = Object.keys(validation?.root || {}).length;
  const detailErrors = Object.keys(validation?.details || {}).length;
  const providerErrors = Object.keys(validation?.provider || {}).length;
  const rawErrors = Object.keys(validation?.raw || {}).length;

  return [
    { id: "main", label: "Основное", icon: "✏️", errorCount: mainErrors },
    { id: "details", label: "Параметры услуги", icon: "🧭", errorCount: detailErrors },
    { id: "images", label: "Фото", icon: "📷", count: imageCount },
    { id: "proof", label: "Подтверждение", icon: "🔐", count: proofCount },
    { id: "provider", label: "Поставщик", icon: "👤", errorCount: providerErrors },
    { id: "technical", label: "Техническое", icon: "⚙️", errorCount: rawErrors },
  ];
}

function serviceMainTitle(it) {
  return (
    it?.title ||
    it?.details?.hotel ||
    it?.details?.hotelName ||
    it?.details?.eventName ||
    it?.details?.flightName ||
    "Без названия"
  );
}

function serviceRouteText(it) {
  const d = it?.details || {};
  const from = d.directionFrom || d.fromCity || d.departureCity || d.cityFrom || d.from || "";
  const to = d.directionTo || d.toCity || d.arrivalCity || d.cityTo || d.to || "";
  const country = d.directionCountry || d.country || d.destinationCountry || "";
  const city = d.city || d.destinationCity || "";
  if (from && to) return `${from} → ${to}`;
  if (country && city) return `${country}, ${city}`;
  return country || city || it?.direction || "—";
}

function serviceDateText(it) {
  const d = it?.details || {};
  const start = d.startDate || d.departureDate || d.checkIn || d.checkin || d.dateFrom || it?.startDate || it?.startDateForSort;
  const end = d.endDate || d.returnDate || d.checkOut || d.checkout || d.dateTo || it?.endDate;
  const fmt = (v) => {
    if (!v) return "";
    const dt = new Date(v);
    if (Number.isNaN(dt.getTime())) return String(v).slice(0, 10);
    return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
  };
  const a = fmt(start);
  const b = fmt(end);
  if (a && b) return `${a} → ${b}`;
  return a || b || "—";
}

function servicePeopleCount(it) {
  const d = it?.details || {};
  const candidates = [
    d.peopleCount,
    d.personCount,
    d.persons,
    d.people,
    d.adults,
    d.guests,
    d.pax,
  ];
  for (const value of candidates) {
    const n = parseFiniteNumber(value);
    if (n && n > 0) return Math.max(1, Math.round(n));
  }
  return 1;
}

function formatMoney(value, currency = "USD") {
  const n = parseFiniteNumber(value);
  if (n === null) return "";
  const rounded = Math.round(n * 100) / 100;
  return `${rounded.toLocaleString("ru-RU")} ${currency || "USD"}`;
}

function servicePriceSummary(it) {
  const d = it?.details || {};
  const currency = d.currency || it?.currency || "USD";
  const gross = d.grossPrice ?? it?.price;
  const packageText = formatMoney(gross, currency);
  const people = servicePeopleCount(it);
  const perPerson = people > 1 && parseFiniteNumber(gross) !== null
    ? formatMoney(parseFiniteNumber(gross) / people, currency)
    : "";

  if (!packageText) {
    return { primary: "Цена не указана", secondary: "нужно заполнить", tone: "amber" };
  }

  const category = String(it?.category || "");
  const unit =
    category === "refused_hotel"
      ? "за номер/период"
      : category === "refused_flight"
      ? "за билет"
      : category === "refused_ticket" || category === "refused_event_ticket"
      ? "за билет"
      : `за пакет${people > 1 ? ` / ${people} чел.` : ""}`;

  return {
    primary: `${packageText} ${unit}`,
    secondary: perPerson ? `за 1 человека: ${perPerson}` : "за 1 человека: не рассчитывается",
    tone: "green",
  };
}

function hasServicePrice(it) {
  const d = it?.details || {};
  return parseFiniteNumber(d.grossPrice ?? it?.price) !== null;
}

function hasServiceImages(it) {
  const d = it?.details || {};
  const arrays = [
    it?.images,
    d.images,
    d.photos,
    d.photoUrls,
    d.proofImages,
  ];
  if (arrays.some((arr) => Array.isArray(arr) && arr.some((x) => !isBlank(x)))) return true;

  const singles = [
    it?.image,
    it?.imageUrl,
    it?.photo,
    it?.photoUrl,
    d.image,
    d.imageUrl,
    d.photo,
    d.photoUrl,
    d.mainImage,
    d.coverImage,
  ];
  return singles.some((x) => !isBlank(x));
}

function getServiceQualityFlags(it, tgOk) {
  const flags = [];
  if (!it?.isActual) flags.push({ key: "actual", label: "неактуально", tone: "red", action: "details" });
  if (!hasServicePrice(it)) flags.push({ key: "price", label: "нет цены", tone: "amber", action: "details" });
  if (!hasServiceImages(it)) flags.push({ key: "photo", label: "нет фото", tone: "amber", action: "images" });
  if (!tgOk) flags.push({ key: "tg", label: "нет TG", tone: "red", action: "tg" });
  return flags;
}

function isServiceReadyForPublishing(it) {
  const effectiveTg =
    it?.provider?.telegram_refused_chat_id ||
    it?.provider?.telegram_web_chat_id ||
    it?.provider?.telegram_chat_id ||
    it?.provider?.chatId ||
    "";
  return !!it?.isActual && getServiceQualityFlags(it, !!effectiveTg).length === 0;
}

function QualityFlagButton({ flag, onClick }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
    red: "border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
    green: "border-green-200 bg-green-50 text-green-700 hover:bg-green-100",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition",
        tones[flag?.tone] || tones.amber
      )}
      title="Открыть место исправления"
    >
      {flag?.label || "проверить"}
    </button>
  );
}

function daysUntilText(dateValue) {
  if (!dateValue) return { text: "без даты", tone: "gray", days: null };
  const dt = new Date(dateValue);
  if (Number.isNaN(dt.getTime())) return { text: "дата?", tone: "gray", days: null };
  const now = new Date();
  const diff = Math.ceil((dt.getTime() - now.getTime()) / 86400000);
  if (diff < 0) return { text: "просрочено", tone: "red", days: diff };
  if (diff === 0) return { text: "сегодня", tone: "red", days: diff };
  if (diff <= 2) return { text: `${diff} дн.`, tone: "red", days: diff };
  if (diff <= 5) return { text: `${diff} дн.`, tone: "amber", days: diff };
  return { text: `${diff} дн.`, tone: "green", days: diff };
}

function StatCard({ label, value, hint, tone = "slate" }) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-950",
    green: "border-emerald-200 bg-emerald-50/70 text-emerald-950",
    amber: "border-amber-200 bg-amber-50/70 text-amber-950",
    red: "border-red-200 bg-red-50/70 text-red-950",
    blue: "border-blue-200 bg-blue-50/70 text-blue-950",
  };
  return (
    <div className={classNames("rounded-2xl border p-4 shadow-sm", tones[tone] || tones.slate)}>
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-black tracking-[-0.04em]">{value}</div>
      {hint ? <div className="mt-1 text-xs font-medium text-slate-500">{hint}</div> : null}
    </div>
  );
}

function QuickChip({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "rounded-full border px-3 py-1.5 text-xs font-bold transition",
        active
          ? "border-orange-200 bg-orange-50 text-orange-700 shadow-sm"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      {children}
    </button>
  );
}

function quickFilterLabel(value) {
  const map = {
    all: "все на странице",
    ready: "готовые",
    urgent: "срочные",
    no_answer: "без ответа",
    no_tg: "без Telegram",
    no_price: "без цены",
    no_photo: "без фото",
  };
  return map[value] || "текущий фильтр";
}

function RefusedEmptyState({ quickFilter, onReset }) {
  const hasQuickFilter = quickFilter && quickFilter !== "all";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
      <div className="font-bold text-slate-900">
        {hasQuickFilter ? `По фильтру "${quickFilterLabel(quickFilter)}" ничего нет` : "Нет данных"}
      </div>
      <div className="mt-1">
        {hasQuickFilter
          ? "Значит, в этой очереди сейчас нет проблемных услуг на текущей странице."
          : "Попробуйте обновить список или поменять основные фильтры."}
      </div>
      {hasQuickFilter ? (
        <button
          type="button"
          onClick={onReset}
          className="mt-3 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          Показать все
        </button>
      ) : null}
    </div>
  );
}

function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  fullscreen = false,
  headerExtra = null,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className={classNames(
          "absolute inset-0 flex items-center justify-center",
          fullscreen ? "p-0" : "p-4"
        )}
      >
        <div
          className={classNames(
            "flex w-full flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl",
            fullscreen
              ? "h-full max-h-full rounded-none"
              : "max-w-6xl rounded-2xl"
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
            <div className="min-w-0">
              <div className="truncate text-base font-black text-slate-950">
                {title}
              </div>

              {subtitle ? (
                <div className="mt-1 truncate text-xs font-medium text-slate-500">
                  {subtitle}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-3">
              {headerExtra}

              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-xl text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                aria-label="Закрыть"
                title="Закрыть"
              >
                ×
              </button>
            </div>
          </div>

          <div
            className={classNames(
              "min-h-0 flex-1 overflow-auto",
              fullscreen ? "bg-slate-50 p-5" : "max-h-[78vh] p-5"
            )}
          >
            {children}
          </div>

          {footer ? (
            <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 shadow-[0_-8px_24px_rgba(15,23,42,0.04)]">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
function Field({ label, children, hint, error }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <div className="mt-1">{children}</div>
      {error ? (
        <div className="mt-1 text-[11px] text-red-600">{error}</div>
      ) : hint ? (
        <div className="mt-1 text-[11px] text-gray-500">{hint}</div>
      ) : null}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text", invalid = false, disabled = false }) {
  return (
    <input
      type={type}
      className={classNames(
        "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2",
        invalid
          ? "border-red-300 bg-red-50/40 focus:ring-red-100"
          : "border-gray-200 focus:ring-gray-200",
        disabled ? "bg-gray-50 text-gray-500" : ""
      )}
      value={value ?? ""}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

function TextArea({ value, onChange, rows = 4, placeholder, invalid = false }) {
  return (
    <textarea
      rows={rows}
      className={classNames(
        "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2",
        invalid
          ? "border-red-300 bg-red-50/40 focus:ring-red-100"
          : "border-gray-200 focus:ring-gray-200"
      )}
      value={value ?? ""}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}

function SelectInput({ value, onChange, options, invalid = false, disabled = false }) {
  return (
    <select
      className={classNames(
        "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2",
        invalid
          ? "border-red-300 bg-red-50/40 focus:ring-red-100"
          : "border-gray-200 focus:ring-gray-200",
        disabled ? "bg-gray-50 text-gray-500" : ""
      )}
      value={value ?? ""}
      onChange={onChange}
      disabled={disabled}
    >
      {options.map((opt) => (
        <option key={`${opt.value}`} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function CheckboxField({ label, checked, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800">
      <input type="checkbox" checked={!!checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function normalizeImagesArray(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const candidate = item.url || item.src || item.path || item.location || item.href || "";
        return String(candidate || "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 20);
}

function syncEditFormImages(prev, nextImages) {
  const normalized = normalizeImagesArray(nextImages);
  return {
    ...(prev || {}),
    images: normalized,
    rawImagesText: JSON.stringify(normalized, null, 2),
  };
}

function syncEditFormProofImages(prev, nextImages) {
  const normalized = normalizeImagesArray(nextImages);
  const nextDetails = {
    ...((prev && prev.details && typeof prev.details === "object") ? prev.details : {}),
    proofImages: normalized,
  };
  return {
    ...(prev || {}),
    details: nextDetails,
    rawDetailsText: JSON.stringify(nextDetails, null, 2),
  };
}

function createEditFormFromService(service) {
  const details =
    service?.details && typeof service.details === "object" && !Array.isArray(service.details)
      ? { ...service.details }
      : {};

  const category = String(service?.category || "").toLowerCase();

  if (category === "refused_flight") {
    if (!details.departureFlightDate && details.startDate) {
      details.departureFlightDate = details.startDate;
    }
    if (!details.returnFlightDate && (details.returnDate || details.endDate)) {
      details.returnFlightDate = details.returnDate || details.endDate;
    }
    if (!details.startDate && details.departureFlightDate) {
      details.startDate = details.departureFlightDate;
    }
    if (!details.endDate && (details.returnDate || details.returnFlightDate)) {
      details.endDate = details.returnDate || details.returnFlightDate;
    }

    details.departureFlightDate = toDateTimeLocal(details.departureFlightDate || details.startDate);
    details.returnFlightDate = toDateTimeLocal(details.returnFlightDate || details.returnDate || details.endDate);
    details.startDate = toDateTimeLocal(details.startDate || details.departureFlightDate);
    details.endDate = toDateTimeLocal(details.endDate || details.returnDate || details.returnFlightDate);
    details.returnDate = toDateTimeLocal(details.returnDate || details.returnFlightDate || details.endDate);
    details.flightType = details.flightType || (details.oneWay === false || details.returnDate ? "round_trip" : "one_way");
    details.oneWay = details.oneWay ?? (details.flightType !== "round_trip");
    details.netPrice = toNumericString(details.netPrice ?? service?.price);
    details.grossPrice = toNumericString(details.grossPrice ?? service?.price);
  }

  if (["refused_tour", "author_tour", "refused_hotel", "refused_ticket", "refused_event_ticket", "visa_support"].includes(category)) {
    if (details.startDate) details.startDate = toDateTimeLocal(details.startDate);
    if (details.endDate) details.endDate = toDateTimeLocal(details.endDate);
    if (details.departureFlightDate) details.departureFlightDate = toDateTimeLocal(details.departureFlightDate);
    if (details.returnFlightDate) details.returnFlightDate = toDateTimeLocal(details.returnFlightDate);
    if (details.returnDate) details.returnDate = toDateTimeLocal(details.returnDate);
    if (details.expiration) details.expiration = toDateTimeLocal(details.expiration);
    details.netPrice = toNumericString(details.netPrice ?? service?.price);
    details.grossPrice = toNumericString(details.grossPrice ?? service?.price);
    details.previousPrice = toNumericString(details.previousPrice);
  }

  const images = Array.isArray(service?.images) ? service.images : [];
  const availability = Array.isArray(service?.availability)
    ? service.availability
    : [];

  const providerTelegram = getProviderTelegramFields(service);

  return {
    id: service?.id || null,
    provider_id: service?.provider_id || null,
    provider_name: service?.provider_name || service?.provider_company_name || "",
    description: service?.description || "",
    title: service?.title || "",
    category: service?.category || "",
    price:
      service?.price === null || typeof service?.price === "undefined"
        ? ""
        : String(service.price),
    vehicle_model: service?.vehicle_model || "",
    images,
    availability,
    rawImagesText: JSON.stringify(images, null, 2),
    rawAvailabilityText: JSON.stringify(availability, null, 2),
    details,
    rawDetailsText: JSON.stringify(details, null, 2),
    ...providerTelegram,
  };
}

function renderDetailFields(editForm, setEditForm, extra = {}) {
  const category = String(editForm?.category || "").toLowerCase();
  const details = editForm?.details || {};
  const hotelOptions = Array.isArray(extra.hotelOptions) ? extra.hotelOptions : [];
  const hotelLoading = !!extra.hotelLoading;
  const onHotelSearch = typeof extra.onHotelSearch === "function" ? extra.onHotelSearch : null;
  const validation = extra.validation || {};
  const detailErrors = validation?.details || {};

  const updateDetailsField = (key, value) => {
    setEditForm((prev) => {
      const prevDetails = prev?.details || {};
      const nextDetails = { ...prevDetails, [key]: value };
      const next = {
        ...prev,
        details: nextDetails,
        rawDetailsText: JSON.stringify(nextDetails, null, 2),
      };

      if (key === "grossPrice") {
        next.price = value;
      }

      const prevCategory = String(prev?.category || "").toLowerCase();

      if (prevCategory === "refused_flight") {
        if (key === "departureFlightDate") nextDetails.startDate = value;
        if (key === "returnFlightDate") {
          nextDetails.endDate = value;
          nextDetails.returnDate = value;
        }
        if (key === "startDate") nextDetails.departureFlightDate = value;
        if (key === "returnDate") {
          nextDetails.returnFlightDate = value;
          nextDetails.endDate = value;
        }
        if (key === "flightType") {
          const oneWay = value !== "round_trip";
          nextDetails.oneWay = oneWay;
          if (oneWay) {
            nextDetails.returnDate = "";
            nextDetails.returnFlightDate = "";
            nextDetails.endDate = "";
          }
        }
        if (key === "oneWay") {
          nextDetails.flightType = value ? "one_way" : "round_trip";
          if (value) {
            nextDetails.returnDate = "";
            nextDetails.returnFlightDate = "";
            nextDetails.endDate = "";
          }
        }
      }

      if (["refused_tour", "author_tour"].includes(prevCategory)) {
        if (key === "hotelName" && !nextDetails.hotel) nextDetails.hotel = value;
        if (key === "roomCategory") nextDetails.accommodationCategory = value;
      }

      if (prevCategory === "refused_hotel") {
        if (key === "accommodationCategory") nextDetails.roomCategory = value;
        if (key === "roomCategory") nextDetails.accommodationCategory = value;
        if (key === "hotelName" && !nextDetails.hotel) nextDetails.hotel = value;
      }

      return next;
    });
  };

  const updateCheckbox = (key) => (e) => updateDetailsField(key, e.target.checked);
  const updateText = (key) => (e) => updateDetailsField(key, e.target.value);

  const dateField = (key, label) => (
    <Field label={label} key={key} error={detailErrors?.[key]}>
      <TextInput
        type="datetime-local"
        value={details?.[key] || ""}
        onChange={updateText(key)}
        invalid={!!detailErrors?.[key]}
      />
    </Field>
  );

  const textField = (key, label, placeholder = "") => (
    <Field label={label} key={key} error={detailErrors?.[key]}>
      <TextInput
        value={details?.[key] || ""}
        onChange={updateText(key)}
        placeholder={placeholder}
        invalid={!!detailErrors?.[key]}
      />
    </Field>
  );

  const selectField = (key, label, options) => (
    <Field label={label} key={key} error={detailErrors?.[key]}>
      <SelectInput
        value={details?.[key] || ""}
        onChange={updateText(key)}
        options={options}
        invalid={!!detailErrors?.[key]}
      />
    </Field>
  );

  const hotelField = (key = "hotel", label = "Отель") => (
    <Field label={label} key={key} hint={hotelLoading ? "Поиск..." : ""} error={detailErrors?.[key]}>
      <>
        <input
          list="admin-hotel-options"
          className={classNames("w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2", detailErrors?.[key] ? "border-red-300 bg-red-50/40 focus:ring-red-100" : "border-gray-200 focus:ring-gray-200")}
          value={details?.[key] || ""}
          onChange={(e) => {
            updateDetailsField(key, e.target.value);
            if (onHotelSearch) onHotelSearch(e.target.value);
          }}
          placeholder="Найдите отель или введите вручную"
        />
        <datalist id="admin-hotel-options">
          {hotelOptions.map((h, idx) => {
            const labelText = [h.name, h.city, h.country].filter(Boolean).join(" • ");
            return (
              <option key={`${h.id || h.name || "hotel"}-${idx}`} value={h.name || ""}>
                {labelText}
              </option>
            );
          })}
        </datalist>
      </>
    </Field>
  );

  if (category === "author_tour") {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {textField("directionCountry", "Страна / направление")}
        {textField("directionFrom", "Город старта")}
        {textField("directionTo", "Город финиша")}
        {dateField("startDate", "Дата начала")}
        {dateField("endDate", "Дата конца")}
        {textField("duration", "Длительность")}
        {selectField("tourFormat", "Формат тура", [
          { value: "", label: "Не указано" },
          { value: "group", label: "Групповой" },
          { value: "private", label: "Индивидуальный" },
          { value: "custom", label: "Под запрос" },
        ])}
        {textField("minPax", "Мин. человек")}
        {textField("maxPax", "Макс. человек")}
        {textField("guideLanguage", "Язык гида")}
        {textField("meetingPoint", "Место встречи")}
        {textField("transport", "Транспорт")}
        {textField("netPrice", "Цена нетто")}
        {textField("grossPrice", "Цена продажи")}
        {textField("previousPrice", "Предыдущая цена")}
        {dateField("expiration", "Срок актуальности")}
        <div className="md:col-span-3">
          <Field label="Программа тура" error={detailErrors?.program}>
            <TextArea value={details?.program || ""} onChange={updateText("program")} rows={5} invalid={!!detailErrors?.program} />
          </Field>
        </div>
        <div className="md:col-span-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Что включено" error={detailErrors?.included}>
            <TextArea value={details?.included || ""} onChange={updateText("included")} rows={4} invalid={!!detailErrors?.included} />
          </Field>
          <Field label="Что не включено" error={detailErrors?.notIncluded}>
            <TextArea value={details?.notIncluded || ""} onChange={updateText("notIncluded")} rows={4} invalid={!!detailErrors?.notIncluded} />
          </Field>
        </div>
        <div className="md:col-span-3">
          <Field label="Условия отмены / важные условия">
            <TextArea value={details?.cancellationPolicy || ""} onChange={updateText("cancellationPolicy")} rows={3} />
          </Field>
        </div>
        <div className="md:col-span-3 flex flex-wrap gap-2">
          <CheckboxField label="Даты по запросу" checked={details?.flexibleDates} onChange={updateCheckbox("flexibleDates")} />
          <CheckboxField label="Гид включён" checked={details?.guideIncluded} onChange={updateCheckbox("guideIncluded")} />
          <CheckboxField label="Транспорт включён" checked={details?.transportIncluded} onChange={updateCheckbox("transportIncluded")} />
          <CheckboxField label="Актуально" checked={details?.isActive} onChange={updateCheckbox("isActive")} />
        </div>
      </div>
    );
  }

  if (category === "refused_tour") {
    const dateOnlyValue = (value) => String(value || "").slice(0, 10);

    const updateDateOnly = (key) => (e) => {
      const value = String(e.target.value || "").trim();
      updateDetailsField(key, value ? `${value}T00:00` : "");
    };

    const dateOnlyInput = (key, label) => (
      <Field label={label} key={key} error={detailErrors?.[key]}>
        <TextInput
          type="date"
          value={dateOnlyValue(details?.[key])}
          onChange={updateDateOnly(key)}
          invalid={!!detailErrors?.[key]}
        />
      </Field>
    );

    const selectWithCurrent = (key, label, options) => {
      const current = String(details?.[key] || "").trim();
      const hasCurrent = options.some((opt) => String(opt.value) === current);
      const finalOptions = hasCurrent || !current
        ? options
        : [{ value: current, label: current }, ...options];

      return (
        <Field label={label} key={key} error={detailErrors?.[key]}>
          <SelectInput
            value={current}
            onChange={updateText(key)}
            options={finalOptions}
            invalid={!!detailErrors?.[key]}
          />
        </Field>
      );
    };

    const startDate = Date.parse(details?.startDate || "");
    const endDate = Date.parse(details?.endDate || "");
    const nightsCount =
      Number.isFinite(startDate) && Number.isFinite(endDate) && endDate > startDate
        ? Math.round((endDate - startDate) / 86400000)
        : null;

    const margin = calcMargin(details);

    return (
      <div className="space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4">
            <div className="text-sm font-black text-slate-950">Маршрут</div>
            <div className="mt-1 text-xs text-slate-500">
              Направление и города, которые будут показаны в карточке услуги.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {textField("directionCountry", "Страна направления", "Например: Кыргызстан")}
            {textField("directionFrom", "Город вылета", "Например: Ташкент")}
            {textField("directionTo", "Город прибытия", "Например: Иссык-Куль")}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-black text-slate-950">Даты тура</div>
              <div className="mt-1 text-xs text-slate-500">
                Основные даты поездки и отдельные даты рейсов.
              </div>
            </div>

            {nightsCount ? (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                {nightsCount} ноч.
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {dateOnlyInput("startDate", "Дата начала")}
            {dateOnlyInput("endDate", "Дата окончания")}
            {dateOnlyInput("departureFlightDate", "Дата рейса вылета")}
            {dateOnlyInput("returnFlightDate", "Дата рейса обратно")}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4">
            <div className="text-sm font-black text-slate-950">Отель и размещение</div>
            <div className="mt-1 text-xs text-slate-500">
              Отель, категория номера, размещение и питание.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="md:col-span-3">
              <Field label="Отель" error={detailErrors?.hotel || detailErrors?.hotelName}>
                <input
                  list="admin-hotel-options"
                  className={classNames(
                    "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2",
                    detailErrors?.hotel || detailErrors?.hotelName
                      ? "border-red-300 bg-red-50/40 focus:ring-red-100"
                      : "border-gray-200 focus:ring-gray-200"
                  )}
                  value={details?.hotel || details?.hotelName || ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEditForm((prev) => {
                      const nextDetails = {
                        ...(prev?.details || {}),
                        hotel: value,
                        hotelName: value,
                      };
                      return {
                        ...prev,
                        details: nextDetails,
                        rawDetailsText: JSON.stringify(nextDetails, null, 2),
                      };
                    });
                    if (onHotelSearch) onHotelSearch(value);
                  }}
                  placeholder="Найдите отель или введите вручную"
                />
                <datalist id="admin-hotel-options">
                  {hotelOptions.map((h, idx) => {
                    const labelText = [h.name, h.city, h.country].filter(Boolean).join(" • ");
                    return (
                      <option key={`${h.id || h.name || "hotel"}-${idx}`} value={h.name || ""}>
                        {labelText}
                      </option>
                    );
                  })}
                </datalist>
              </Field>
            </div>

            <Field label="Категория номера" error={detailErrors?.accommodationCategory || detailErrors?.roomCategory}>
              <TextInput
                value={details?.accommodationCategory || details?.roomCategory || ""}
                onChange={(e) => {
                  const value = e.target.value;
                  setEditForm((prev) => {
                    const nextDetails = {
                      ...(prev?.details || {}),
                      accommodationCategory: value,
                      roomCategory: value,
                    };
                    return {
                      ...prev,
                      details: nextDetails,
                      rawDetailsText: JSON.stringify(nextDetails, null, 2),
                    };
                  });
                }}
                placeholder="Например: Standard Room"
                invalid={!!(detailErrors?.accommodationCategory || detailErrors?.roomCategory)}
              />
            </Field>

            {textField("accommodation", "Размещение", "Например: 2 ADT")}

            {selectWithCurrent("food", "Питание", [
              { value: "", label: "Не указано" },
              { value: "RO", label: "RO — без питания" },
              { value: "BB", label: "BB — завтраки" },
              { value: "HB", label: "HB — завтрак и ужин" },
              { value: "FB", label: "FB — полный пансион" },
              { value: "AI", label: "AI — всё включено" },
              { value: "UAI", label: "UAI — ультра всё включено" },
            ])}

            {selectWithCurrent("transfer", "Трансфер", [
              { value: "", label: "Не указано" },
              { value: "included", label: "Включён" },
              { value: "group", label: "Групповой" },
              { value: "individual", label: "Индивидуальный" },
              { value: "none", label: "Не включён" },
            ])}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-black text-slate-950">Стоимость</div>
              <div className="mt-1 text-xs text-slate-500">
                Цена продажи синхронизируется с основной ценой услуги.
              </div>
            </div>

            {margin !== null ? (
              <span className={classNames(
                "rounded-full border px-3 py-1 text-xs font-bold",
                margin >= 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
              )}>
                Маржа: {margin}
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {textField("netPrice", "Цена нетто")}
            {textField("grossPrice", "Цена продажи")}
            {textField("previousPrice", "Предыдущая цена")}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4">
            <div className="text-sm font-black text-slate-950">Рейс и актуальность</div>
            <div className="mt-1 text-xs text-slate-500">
              Детали перелёта и срок, до которого предложение считается актуальным.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
            <Field label="Детали рейса" error={detailErrors?.flightDetails}>
              <TextArea
                value={details?.flightDetails || ""}
                onChange={updateText("flightDetails")}
                rows={5}
                invalid={!!detailErrors?.flightDetails}
              />
            </Field>

            <div className="space-y-3">
              {dateField("expiration", "Срок актуальности")}

              <div className="flex flex-wrap gap-2">
                <CheckboxField label="Можно менять" checked={details?.changeable} onChange={updateCheckbox("changeable")} />
                <CheckboxField label="Виза включена" checked={details?.visaIncluded} onChange={updateCheckbox("visaIncluded")} />
                <CheckboxField label="Страховка включена" checked={details?.insuranceIncluded} onChange={updateCheckbox("insuranceIncluded")} />
                <CheckboxField label="Раннее заселение" checked={details?.earlyCheckIn} onChange={updateCheckbox("earlyCheckIn")} />
                <CheckboxField label="Arrival Fast Track" checked={details?.arrivalFastTrack} onChange={updateCheckbox("arrivalFastTrack")} />
                <CheckboxField label="Актуально" checked={details?.isActive} onChange={updateCheckbox("isActive")} />
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (category === "refused_hotel") {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {textField("directionCountry", "Страна")}
        {textField("directionTo", "Город")}
        <div className="md:col-span-3">{hotelField("hotel", "Отель")}</div>
        {textField("hotelName", "Hotel name / legacy")}
        {dateField("startDate", "Дата заезда")}
        {dateField("endDate", "Дата выезда")}
        {textField("accommodationCategory", "Категория номера")}
        {textField("roomCategory", "Room category / legacy")}
        {textField("accommodation", "Размещение")}
        {textField("food", "Питание")}
        {textField("transfer", "Трансфер")}
        {textField("netPrice", "Цена нетто")}
        {textField("grossPrice", "Цена продажи")}
        {textField("previousPrice", "Предыдущая цена")}
        {dateField("expiration", "Срок актуальности")}
        <div className="md:col-span-3 flex flex-wrap gap-2">
          <CheckboxField label="Можно менять" checked={details?.changeable} onChange={updateCheckbox("changeable")} />
          <CheckboxField label="Страховка включена" checked={details?.insuranceIncluded} onChange={updateCheckbox("insuranceIncluded")} />
          <CheckboxField label="Раннее заселение" checked={details?.earlyCheckIn} onChange={updateCheckbox("earlyCheckIn")} />
          <CheckboxField label="Arrival Fast Track" checked={details?.arrivalFastTrack} onChange={updateCheckbox("arrivalFastTrack")} />
          <CheckboxField label="Актуально" checked={details?.isActive} onChange={updateCheckbox("isActive")} />
        </div>
      </div>
    );
  }

  if (category === "refused_flight") {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {textField("directionCountry", "Страна направления")}
        {textField("directionFrom", "Город вылета")}
        {textField("directionTo", "Город прибытия")}
        {selectField("flightType", "Тип перелёта", [
          { value: "", label: "Не выбрано" },
          { value: "one_way", label: "One way" },
          { value: "round_trip", label: "Round trip" },
        ])}
        {dateField("startDate", "Дата вылета")}
        {dateField("returnDate", "Дата возврата")}
        {dateField("departureFlightDate", "Дата вылета / legacy")}
        {dateField("returnFlightDate", "Дата обратно / legacy")}
        {textField("airline", "Авиакомпания")}
        {textField("ticketType", "Тип билета")}
        {textField("fareClass", "Класс тарифа")}
        {textField("baggage", "Багаж")}
        {textField("netPrice", "Цена нетто")}
        {textField("grossPrice", "Цена продажи")}
        {textField("previousPrice", "Предыдущая цена")}
        {dateField("expiration", "Срок актуальности")}
        <div className="md:col-span-3">
          <Field label="Детали рейса" error={detailErrors?.flightDetails}>
            <TextArea value={details?.flightDetails || ""} onChange={updateText("flightDetails")} rows={3} invalid={!!detailErrors?.flightDetails} />
          </Field>
        </div>
        <div className="md:col-span-3 flex flex-wrap gap-2">
          <CheckboxField label="В одну сторону" checked={details?.oneWay} onChange={updateCheckbox("oneWay")} />
          <CheckboxField label="Можно менять" checked={details?.changeable} onChange={updateCheckbox("changeable")} />
          <CheckboxField label="Страховка включена" checked={details?.insuranceIncluded} onChange={updateCheckbox("insuranceIncluded")} />
          <CheckboxField label="Arrival Fast Track" checked={details?.arrivalFastTrack} onChange={updateCheckbox("arrivalFastTrack")} />
          <CheckboxField label="Актуально" checked={details?.isActive} onChange={updateCheckbox("isActive")} />
        </div>
      </div>
    );
  }

  if (["refused_ticket", "refused_event_ticket"].includes(category)) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {textField("eventName", "Название события")}
        {textField("eventCategory", "Категория события")}
        {textField("directionCountry", "Страна")}
        {textField("directionTo", "Город")}
        {textField("location", "Локация")}
        {dateField("startDate", "Дата события")}
        {textField("ticketType", "Тип билета")}
        {textField("seatInfo", "Место / сектор")}
        {textField("ticketDetails", "Детали билета")}
        {textField("netPrice", "Цена нетто")}
        {textField("grossPrice", "Цена продажи")}
        {textField("previousPrice", "Предыдущая цена")}
        {dateField("expiration", "Срок актуальности")}
        <div className="md:col-span-3 flex flex-wrap gap-2">
          <CheckboxField label="Можно менять" checked={details?.changeable} onChange={updateCheckbox("changeable")} />
          <CheckboxField label="Актуально" checked={details?.isActive} onChange={updateCheckbox("isActive")} />
        </div>
      </div>
    );
  }

  if (category === "visa_support") {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {textField("visaCountry", "Страна визы")}
        {textField("visaType", "Тип визы")}
        {textField("processingTime", "Срок оформления")}
        {textField("netPrice", "Цена нетто")}
        {textField("grossPrice", "Цена продажи")}
        {textField("previousPrice", "Предыдущая цена")}
        {dateField("expiration", "Срок актуальности")}
        <div className="md:col-span-3">
          <Field label="Описание" error={detailErrors?.description}>
            <TextArea value={details?.description || ""} onChange={updateText("description")} rows={4} invalid={!!detailErrors?.description} />
          </Field>
        </div>
        <div className="md:col-span-3 flex flex-wrap gap-2">
          <CheckboxField label="Актуально" checked={details?.isActive} onChange={updateCheckbox("isActive")} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
      Для категории <span className="font-mono">{category || "—"}</span> визуальные поля не настроены.
      Ниже доступен полный редактор <span className="font-mono">details JSON</span>.
    </div>
  );
}


export default function AdminRefusedActual() {
  const token = useMemo(() => getAuthToken(), []);

  const base = useMemo(() => {
    const env = normalizeApiBase(getEnvApiBase());
    const rt = normalizeApiBase(getRuntimeApiBase());
    const fallback = normalizeApiBase(getProductionApiFallback());
    return env || rt || fallback || "";
  }, []);

  const baseSource = useMemo(() => {
    if (normalizeApiBase(getEnvApiBase())) return "env";
    if (normalizeApiBase(getRuntimeApiBase())) return "runtime";
    if (normalizeApiBase(getProductionApiFallback())) return "fallback";
    return "missing";
  }, []);

  const apiPrefix = useMemo(() => computeApiPrefix(base), [base]);
  const apiPath = (p) => `${apiPrefix}${p.startsWith("/") ? p : `/${p}`}`;

  const http = useMemo(() => {
    const inst = axios.create({
      baseURL: base || "",
      withCredentials: true,
      timeout: 20000,
      validateStatus: () => true,
    });

    inst.interceptors.request.use((config) => {
      const t = getAuthToken();
      if (t) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${t}`;
      }
      return config;
    });

    return inst;
  }, [base]);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [actuality, setActuality] = useState("actual");
  const [visibility, setVisibility] = useState("active");

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);

  const initialSort = useMemo(() => readUrlSort(), []);
  const [sortBy, setSortBy] = useState(initialSort.sortBy);
  const [sortOrder, setSortOrder] = useState(initialSort.sortOrder);

  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [unlockCfgLoading, setUnlockCfgLoading] = useState(false);
  const [unlockCfgSaving, setUnlockCfgSaving] = useState(false);
  const [unlockIsPaid, setUnlockIsPaid] = useState(true);
  const [unlockPrice, setUnlockPrice] = useState("10000");
  const [unlockUpdatedAt, setUnlockUpdatedAt] = useState(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsItem, setDetailsItem] = useState(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [editForm, setEditForm] = useState(null);
  const [originalEditForm, setOriginalEditForm] = useState(null);
  const [saveAndCloseRequested, setSaveAndCloseRequested] = useState(false);
  const [editTab, setEditTab] = useState("main");
  const [hotelQuery, setHotelQuery] = useState("");
  const [hotelOptions, setHotelOptions] = useState([]);
  const [hotelLoading, setHotelLoading] = useState(false);
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [imageUploadBusy, setImageUploadBusy] = useState(false);
  const [proofImageUrlDraft, setProofImageUrlDraft] = useState("");
  const [proofImageUploadBusy, setProofImageUploadBusy] = useState(false);
  const [previewGallery, setPreviewGallery] = useState([]);
  const [previewIndex, setPreviewIndex] = useState(-1);
  const [previewImageTitle, setPreviewImageTitle] = useState("");

  const previewImageSrc = useMemo(() => {
    if (!Array.isArray(previewGallery) || previewIndex < 0 || previewIndex >= previewGallery.length) return "";
    return String(previewGallery[previewIndex] || "");
  }, [previewGallery, previewIndex]);

  const editValidation = useMemo(() => validateEditForm(editForm), [editForm]);
  const hasUnsavedEditChanges = useMemo(() => {
    if (!editForm || !originalEditForm) return false;

    try {
      return JSON.stringify(editForm) !== JSON.stringify(originalEditForm);
    } catch {
      return false;
    }
  }, [editForm, originalEditForm]);

  const editorTabs = useMemo(
    () => getEditorTabs(editForm, editValidation),
    [editForm, editValidation]
  );

  const [sendingId, setSendingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkSending, setBulkSending] = useState(false);
  const [inlineEditId, setInlineEditId] = useState(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineError, setInlineError] = useState("");
  const [inlineForm, setInlineForm] = useState({
    telegram_refused_chat_id: "",
    telegram_web_chat_id: "",
    telegram_chat_id: "",
  });

  const [viewMode, setViewMode] = useState("table");
  const [quickFilter, setQuickFilter] = useState("all");
  const [actionMenuOpen, setActionMenuOpen] = useState(null);

  const pageCount = useMemo(() => {
    const c = Math.ceil((total || 0) / (limit || 1));
    return Math.max(c, 1);
  }, [total, limit]);


  const pageStats = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    const now = Date.now();
    let actualCount = 0;
    let inactiveCount = 0;
    let tgMissingCount = 0;
    let noAnswerCount = 0;
    let noPriceCount = 0;
    let noPhotoCount = 0;
    let readyCount = 0;
    let urgentCount = 0;
    let tourCount = 0;
    let authorTourCount = 0;
    let hotelCount = 0;
    let flightCount = 0;

    for (const it of list) {
      if (it?.isActual) actualCount += 1;
      else inactiveCount += 1;

      if (it?.category === "refused_tour") tourCount += 1;
      if (it?.category === "author_tour") authorTourCount += 1;
      if (it?.category === "refused_hotel") hotelCount += 1;
      if (it?.category === "refused_flight") flightCount += 1;

      const effectiveTg =
        it?.provider?.telegram_refused_chat_id ||
        it?.provider?.telegram_web_chat_id ||
        it?.provider?.telegram_chat_id ||
        it?.provider?.chatId ||
        "";
      if (!effectiveTg) tgMissingCount += 1;

      const meta = it?.meta || {};
      if (meta.lastSentAt && !meta.lastAnswer) noAnswerCount += 1;
      if (!hasServicePrice(it)) noPriceCount += 1;
      if (!hasServiceImages(it)) noPhotoCount += 1;
      if (isServiceReadyForPublishing(it)) readyCount += 1;

      const d = new Date(it?.expirationAt || it?.expiration_at || it?.startDateForSort || "");
      if (!Number.isNaN(d.getTime()) && d.getTime() >= now && d.getTime() - now <= 2 * 86400000) {
        urgentCount += 1;
      }
    }

    return {
      shown: list.length,
      actualCount,
      inactiveCount,
      tgMissingCount,
      noAnswerCount,
      noPriceCount,
      noPhotoCount,
      readyCount,
      urgentCount,
      tourCount,
      authorTourCount,
      hotelCount,
      flightCount,
    };
  }, [items]);

  const visibleItems = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    if (quickFilter === "urgent") {
      return list.filter((it) => {
        const u = daysUntilText(it?.expirationAt || it?.expiration_at || it?.startDateForSort);
        return u.tone === "red" || u.tone === "amber";
      });
    }
    if (quickFilter === "no_tg") {
      return list.filter((it) => {
        const effectiveTg =
          it?.provider?.telegram_refused_chat_id ||
          it?.provider?.telegram_web_chat_id ||
          it?.provider?.telegram_chat_id ||
          it?.provider?.chatId ||
          "";
        return !effectiveTg;
      });
    }
    if (quickFilter === "no_answer") {
      return list.filter((it) => it?.meta?.lastSentAt && !it?.meta?.lastAnswer);
    }
    if (quickFilter === "no_price") {
      return list.filter((it) => !hasServicePrice(it));
    }
    if (quickFilter === "no_photo") {
      return list.filter((it) => !hasServiceImages(it));
    }
    if (quickFilter === "ready") {
      return list.filter((it) => isServiceReadyForPublishing(it));
    }
    return list;
  }, [items, quickFilter]);

  const visibleItemIds = useMemo(
    () => visibleItems.map((it) => Number(it.id)).filter((id) => Number.isFinite(id)),
    [visibleItems]
  );

  const selectableVisibleIds = useMemo(
    () =>
      visibleItems
        .filter((it) => {
          const deleted = !!it.deletedAt || String(it.status || "").toLowerCase() === "deleted";
          return !deleted;
        })
        .map((it) => Number(it.id))
        .filter((id) => Number.isFinite(id)),
    [visibleItems]
  );

  const askableSelectedIds = useMemo(
    () =>
      selectedIds
        .map((id) => Number(id))
        .filter((id) => {
          if (!Number.isFinite(id) || !selectableVisibleIds.includes(id)) return false;
          const it = visibleItems.find((row) => Number(row.id) === id);
          const effectiveTg =
            it?.provider?.telegram_refused_chat_id ||
            it?.provider?.telegram_web_chat_id ||
            it?.provider?.telegram_chat_id ||
            it?.provider?.chatId ||
            "";
          return !!effectiveTg;
        }),
    [selectedIds, selectableVisibleIds, visibleItems]
  );

  const extendableSelectedIds = useMemo(
    () =>
      selectedIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && selectableVisibleIds.includes(id)),
    [selectedIds, selectableVisibleIds]
  );

  const selectedVisibleCount = useMemo(
    () => selectableVisibleIds.filter((id) => selectedIds.includes(id)).length,
    [selectableVisibleIds, selectedIds]
  );

  const allVisibleSelected =
    selectableVisibleIds.length > 0 && selectedVisibleCount === selectableVisibleIds.length;

  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  const canUse = useMemo(() => !!token, [token]);

  const baseLooksMissing = useMemo(() => {
    if (base) return false;
    const host = (window?.location?.hostname || "").toLowerCase();
    return host && host !== "localhost" && host !== "127.0.0.1";
  }, [base]);

  function showToast(kind, text) {
    const entry = { kind, text, at: Date.now() };
    setToast(entry);
    setTimeout(() => {
      setToast((t) => (t?.at === entry.at ? null : t));
    }, 2800);
  }

  function closePreview() {
    setPreviewGallery([]);
    setPreviewIndex(-1);
    setPreviewImageTitle("");
  }

  function openPreview(images, index = 0, title = "Просмотр изображения") {
    const list = Array.isArray(images)
      ? images.map((x) => String(x || "")).filter(Boolean)
      : [];
    if (!list.length) return;
    const safeIndex = Math.min(Math.max(Number(index) || 0, 0), list.length - 1);
    setPreviewGallery(list);
    setPreviewIndex(safeIndex);
    setPreviewImageTitle(title);
  }

  function goPreview(step) {
    setPreviewIndex((prev) => {
      if (!Array.isArray(previewGallery) || !previewGallery.length) return -1;
      const next = prev + step;
      if (next < 0 || next >= previewGallery.length) return prev;
      return next;
    });
  }

  function ensureJsonOrThrow(resp, where = "") {
    const statusCode = resp?.status;
    const contentType = resp?.headers?.["content-type"];
    const data = resp?.data;

    if (!statusCode || statusCode < 200 || statusCode >= 300) {
      const msg =
        data?.message ||
        data?.error ||
        (typeof data === "string" ? data.slice(0, 120) : null) ||
        `HTTP ${statusCode || "?"}`;
      const err = new Error(
        `${msg} (status=${statusCode || "?"}${where ? `, ${where}` : ""})`
      );
      err.__resp = resp;
      throw err;
    }

    if (isProbablyHtmlPayload(data, contentType)) {
      const err = new Error(
        `API вернул HTML вместо JSON (${where || "request"}). Проверь VITE_API_BASE_URL или window.frontend.API_BASE.`
      );
      err.__resp = resp;
      throw err;
    }

    if (!data || typeof data !== "object") {
      const err = new Error(
        `Bad response (${where || "request"}): ожидали JSON-объект`
      );
      err.__resp = resp;
      throw err;
    }

    return data;
  }

  async function loadContactUnlockSettings() {
    setUnlockCfgLoading(true);
    try {
      const resp = await http.get(apiPath("/admin/billing/contact-unlock-settings"));
      const data = ensureJsonOrThrow(resp, "loadContactUnlockSettings");

      if (!data?.ok) {
        throw new Error(data?.message || "Не удалось загрузить настройки");
      }

      setUnlockIsPaid(Boolean(data.is_paid));
      setUnlockPrice(String(Math.round(Number(data.price ?? 0) / 100)));
      setUnlockUpdatedAt(data.updated_at || null);
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg || "Ошибка загрузки настроек открытия контактов");
    } finally {
      setUnlockCfgLoading(false);
    }
  }

  async function saveContactUnlockSettings() {
    const priceNum = Math.max(0, Math.trunc(Number(unlockPrice || 0)));

    if (!Number.isFinite(priceNum)) {
      showToast("err", "❌ Некорректная цена");
      return;
    }

    setUnlockCfgSaving(true);
    setError("");

    try {
      const resp = await http.put(apiPath("/admin/billing/contact-unlock-settings"), {
        is_paid: unlockIsPaid,
        price: Math.round(priceNum * 100),
      });

      const data = ensureJsonOrThrow(resp, "saveContactUnlockSettings");

      if (!data?.ok) {
        throw new Error(data?.message || "Не удалось сохранить настройки");
      }

      setUnlockIsPaid(Boolean(data.is_paid));
      setUnlockPrice(String(Math.round(Number(data.price ?? priceNum) / 100)));
      setUnlockUpdatedAt(data.updated_at || null);

      showToast(
        "ok",
        data?.is_paid
          ? "✅ Открытие контактов переведено в платный режим"
          : "✅ Открытие контактов переведено в бесплатный режим"
      );
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
    } finally {
      setUnlockCfgSaving(false);
    }
  }

  const thClass = (field) =>
    classNames(
      "px-3 py-2 text-left font-medium select-none",
      "cursor-pointer hover:text-blue-700",
      sortBy === field ? "bg-blue-50/60 text-blue-900" : ""
    );

  const tdClass = (field) =>
    classNames("px-3 py-2", sortBy === field ? "bg-blue-50/30" : "");

  const iconClass = (field) =>
    classNames(sortBy === field ? "text-blue-700" : "text-gray-400", "ml-1");

  function toggleSort(field) {
    setPage(1);
    setSortBy((prev) => {
      const nextBy = field;
      const nextOrder =
        prev === nextBy ? (sortOrder === "asc" ? "desc" : "asc") : "asc";
      setSortOrder(nextOrder);
      writeUrlSort(nextBy, nextOrder);
      return nextBy;
    });
  }

  const sortIcon = (field) =>
    sortBy === field ? (sortOrder === "asc" ? "▲" : "▼") : "";

  async function loadList(nextPage = page) {
    setLoading(true);
    setError("");
    try {
      const showDeleted = visibility === "active" ? "0" : "1";
      const effectiveStatus = visibility === "deleted" ? "deleted" : status || "";

      const resp = await http.get(apiPath("/admin/refused/actual"), {
        params: {
          category: category || "",
          status: effectiveStatus,
          q: q || "",
          page: nextPage,
          limit,
          actuality,
          showDeleted,
          sortBy,
          sortOrder,
        },
      });

      const data = ensureJsonOrThrow(resp, "loadList");
      if (!data?.success) throw new Error(data?.message || "Bad response");

      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total || 0));
    } catch (e) {
      const info = extractAxiosError(e);
      const resp = e?.__resp;
      const ct = resp?.headers?.["content-type"];
      const data = resp?.data;

      let msg = info.msg;
      if (isProbablyHtmlPayload(data, ct)) {
        msg +=
          " → Настрой API_BASE: VITE_API_BASE_URL или window.frontend.API_BASE.";
      } else if (info.snippet) {
        msg = `${msg}. Ответ: ${info.snippet}`;
      }

      setError(msg);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(1);
  }, [category, status, actuality, visibility, limit, sortBy, sortOrder]);

  useEffect(() => {
    if (!canUse) return;
    loadList(1);
    loadContactUnlockSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse, category, status, actuality, visibility, limit, sortBy, sortOrder]);

  useEffect(() => {
    if (!canUse) return;
    loadList(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);


  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => visibleItemIds.includes(id)));
  }, [visibleItemIds]);

  async function openDetails(id) {
    setDetailsOpen(true);
    setDetailsLoading(true);
    setDetailsItem(null);
    setError("");
    try {
      const resp = await http.get(apiPath(`/admin/refused/${id}`));
      const data = ensureJsonOrThrow(resp, "openDetails");
      if (!data?.success) throw new Error(data?.message || "Bad response");
      setDetailsItem(data.item || null);
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg || "Ошибка загрузки деталей");
      setDetailsItem(null);
    } finally {
      setDetailsLoading(false);
    }
  }

    async function openEdit(id, initialTab = "main") {
      setEditOpen(true);
      setEditLoading(true);
      setEditError("");
      setEditForm(null);
      setOriginalEditForm(null);
      setSaveAndCloseRequested(false);
      setEditTab(initialTab || "main");
      setHotelQuery("");
      setHotelOptions([]);
      setImageUrlDraft("");
      setProofImageUrlDraft("");

      try {
        const resp = await http.get(apiPath(`/admin/services/${id}`));
        const data = ensureJsonOrThrow(resp, "openEdit");

        const nextForm = createEditFormFromService(data || {});

        setEditForm(nextForm);
        setOriginalEditForm(nextForm);
      } catch (e) {
        const info = extractAxiosError(e);
        setEditError(
          info.msg || "Ошибка загрузки услуги для редактирования"
        );
      } finally {
        setEditLoading(false);
      }
    }

    function handleQualityFlagClick(item, flag) {
      if (!item || !flag) return;
      if (flag.action === "tg") {
        openInlineEdit(item);
        return;
      }
      openEdit(item.id, flag.action || "main");
    }

    function closeEditEditor() {
    if (editSaving) return;

    if (hasUnsavedEditChanges) {
      const confirmed = window.confirm(
        "Есть несохранённые изменения.\n\nЗакрыть редактор и потерять изменения?"
      );

      if (!confirmed) return;
    }

    closePreview();
    setEditOpen(false);
    setEditForm(null);
    setOriginalEditForm(null);
    setSaveAndCloseRequested(false);
    setEditError("");
  }

  function cancelEditEditor() {
    closeEditEditor();
  }

  function updateEditRoot(field, value) {
    setEditForm((prev) => ({ ...(prev || {}), [field]: value }));
  }

  function handleRawDetailsChange(value) {
    setEditForm((prev) => {
      const next = { ...(prev || {}), rawDetailsText: value };
      const parsed = safeJsonParse(value, null);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        next.details = parsed;
      }
      return next;
    });
  }

  function handleRawImagesChange(value) {
    setEditForm((prev) => ({ ...(prev || {}), rawImagesText: value }));
  }

  function applyImagesToEditForm(nextImages) {
    setEditForm((prev) => syncEditFormImages(prev, nextImages));
  }

  function handleMakePrimaryImage(index) {
    setEditForm((prev) => {
      const current = normalizeImagesArray(
        prev?.images ||
          safeJsonParse(prev?.rawImagesText || "[]", [])
      );

      if (
        index <= 0 ||
        index >= current.length
      ) {
        return prev;
      }

      const nextImages = [...current];
      const [selectedImage] = nextImages.splice(index, 1);
      nextImages.unshift(selectedImage);

      return syncEditFormImages(prev, nextImages);
    });
  }

  function handleRemoveImage(index) {
    setEditForm((prev) => {
      const current = normalizeImagesArray(prev?.images || safeJsonParse(prev?.rawImagesText || "[]", []));
      const nextImages = current.filter((_, idx) => idx !== index);
      return syncEditFormImages(prev, nextImages);
    });
  }

  async function handleAddImagesFromFiles(event) {
    const files = Array.from(event?.target?.files || []);
    if (!files.length) return;

    setEditError("");
    setImageUploadBusy(true);

    try {
      const dataUrls = [];
      for (const file of files) {
        if (!String(file?.type || "").startsWith("image/")) continue;
        dataUrls.push(await fileToDataUrl(file));
      }

      if (!dataUrls.length) {
        throw new Error("Выбери изображения");
      }

      setEditForm((prev) => {
        const current = normalizeImagesArray(prev?.images || safeJsonParse(prev?.rawImagesText || "[]", []));
        const nextImages = [...current, ...dataUrls].slice(0, 20);
        return syncEditFormImages(prev, nextImages);
      });
    } catch (e) {
      setEditError(e?.message || "Не удалось добавить изображения");
    } finally {
      setImageUploadBusy(false);
      if (event?.target) event.target.value = "";
    }
  }

  function handleAddImageByUrl() {
    const value = String(imageUrlDraft || "").trim();
    if (!value) return;

    setEditForm((prev) => {
      const current = normalizeImagesArray(prev?.images || safeJsonParse(prev?.rawImagesText || "[]", []));
      const nextImages = [...current, value].slice(0, 20);
      return syncEditFormImages(prev, nextImages);
    });
    setImageUrlDraft("");
  }

  function handleRemoveProofImage(index) {
    setEditForm((prev) => {
      const current = normalizeImagesArray(prev?.details?.proofImages || []);
      const nextImages = current.filter((_, idx) => idx !== index);
      return syncEditFormProofImages(prev, nextImages);
    });
  }

  async function handleAddProofImagesFromFiles(event) {
    const files = Array.from(event?.target?.files || []);
    if (!files.length) return;

    setEditError("");
    setProofImageUploadBusy(true);

    try {
      const dataUrls = [];
      for (const file of files) {
        if (!String(file?.type || "").startsWith("image/")) continue;
        dataUrls.push(await fileToDataUrl(file));
      }

      if (!dataUrls.length) throw new Error("Выбери изображения");

      setEditForm((prev) => {
        const current = normalizeImagesArray(prev?.details?.proofImages || []);
        const nextImages = [...current, ...dataUrls].slice(0, 20);
        return syncEditFormProofImages(prev, nextImages);
      });
    } catch (e) {
      setEditError(e?.message || "Не удалось добавить proof-изображения");
    } finally {
      setProofImageUploadBusy(false);
      if (event?.target) event.target.value = "";
    }
  }

  function handleAddProofImageByUrl() {
    const value = String(proofImageUrlDraft || "").trim();
    if (!value) return;

    setEditForm((prev) => {
      const current = normalizeImagesArray(prev?.details?.proofImages || []);
      const nextImages = [...current, value].slice(0, 20);
      return syncEditFormProofImages(prev, nextImages);
    });
    setProofImageUrlDraft("");
  }

  function handleRawAvailabilityChange(value) {
    setEditForm((prev) => ({ ...(prev || {}), rawAvailabilityText: value }));
  }

  async function saveEdit({ closeAfterSave = false } = {}) {
    if (!editForm?.id) return;

    const validation = validateEditForm(editForm);

    if (!validation.valid) {
      if (Object.keys(validation.root || {}).length > 0) {
        setEditTab("main");
      } else if (Object.keys(validation.details || {}).length > 0) {
        setEditTab("details");
      } else if (Object.keys(validation.provider || {}).length > 0) {
        setEditTab("provider");
      } else if (Object.keys(validation.raw || {}).length > 0) {
        setEditTab("technical");
      }

      setEditError(
        validation.summary[0] ||
          "Исправь ошибки перед сохранением"
      );
      return;
    }

    let parsedDetails = {};
    let parsedImages = [];
    let parsedAvailability = [];

    try {
      parsedDetails = safeJsonParse(
        editForm.rawDetailsText || "{}",
        {}
      );

      parsedImages = safeJsonParse(
        editForm.rawImagesText || "[]",
        []
      );

      parsedAvailability = safeJsonParse(
        editForm.rawAvailabilityText || "[]",
        []
      );
    } catch (e) {
      setEditError(e?.message || "Невалидный JSON");
      return;
    }

    setEditSaving(true);
    setSaveAndCloseRequested(closeAfterSave);
    setEditError("");

    try {
      const nextForm = {
        ...editForm,
        details: parsedDetails,
        images: Array.isArray(parsedImages)
          ? parsedImages
          : [],
        availability: Array.isArray(parsedAvailability)
          ? parsedAvailability
          : [],
        rawDetailsText: JSON.stringify(
          parsedDetails,
          null,
          2
        ),
        rawImagesText: JSON.stringify(
          Array.isArray(parsedImages)
            ? parsedImages
            : [],
          null,
          2
        ),
        rawAvailabilityText: JSON.stringify(
          Array.isArray(parsedAvailability)
            ? parsedAvailability
            : [],
          null,
          2
        ),
      };

      const payload = {
        title: nextForm?.title || "",
        description: nextForm?.description || "",
        category: nextForm?.category || "",
        price:
          nextForm?.price === null ||
          typeof nextForm?.price === "undefined"
            ? null
            : nextForm.price,
        vehicle_model: nextForm?.vehicle_model || "",
        images: Array.isArray(nextForm?.images)
          ? nextForm.images
          : [],
        availability: Array.isArray(nextForm?.availability)
          ? nextForm.availability
          : [],
        details:
          nextForm?.details &&
          typeof nextForm.details === "object" &&
          !Array.isArray(nextForm.details)
            ? nextForm.details
            : {},
        telegram_refused_chat_id: normalizeChatId(
          nextForm?.telegram_refused_chat_id
        ),
        telegram_web_chat_id: normalizeChatId(
          nextForm?.telegram_web_chat_id
        ),
        telegram_chat_id: normalizeChatId(
          nextForm?.telegram_chat_id
        ),
      };

      const resp = await http.put(
        apiPath(`/admin/services/${editForm.id}`),
        payload
      );

      const data = ensureJsonOrThrow(resp, "saveEdit");

      if (!data?.ok) {
        throw new Error(
          data?.message || "Не удалось сохранить услугу"
        );
      }

      const savedForm = createEditFormFromService({
        ...(data?.service || nextForm),
        telegram_refused_chat_id:
          nextForm.telegram_refused_chat_id,
        telegram_web_chat_id:
          nextForm.telegram_web_chat_id,
        telegram_chat_id:
          nextForm.telegram_chat_id,
        provider_id: nextForm.provider_id,
        provider_name: nextForm.provider_name,
      });

      setEditForm(savedForm);
      setOriginalEditForm(savedForm);

      showToast(
        "ok",
        `✅ Услуга #${editForm.id} сохранена`
      );

      await loadList(page);

      if (detailsItem?.id === editForm.id) {
        await openDetails(editForm.id);
      }

      if (closeAfterSave) {
        closePreview();
        setEditOpen(false);
        setEditForm(null);
        setOriginalEditForm(null);
      }
    } catch (e) {
      const info = extractAxiosError(e);

      setEditError(
        info.msg || "Ошибка сохранения услуги"
      );
    } finally {
      setEditSaving(false);
      setSaveAndCloseRequested(false);
    }
  }

  async function searchHotels(name) {
    const q = String(name || "").trim();
    setHotelQuery(q);

    if (q.length < 2) {
      setHotelOptions([]);
      return;
    }

    setHotelLoading(true);
    try {
      const resp = await http.get(apiPath("/hotels/search"), {
        params: { name: q, limit: 8 },
      });
      const data = ensureJsonOrThrow(resp, "searchHotels");
      const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setHotelOptions(rows);
    } catch {
      setHotelOptions([]);
    } finally {
      setHotelLoading(false);
    }
  }

   function openInlineEdit(item) {
    const provider = item?.provider || {};
    setInlineEditId(item?.id || null);
    setInlineError("");
    setInlineForm({
      telegram_refused_chat_id: normalizeChatId(provider?.telegram_refused_chat_id || ""),
      telegram_web_chat_id: normalizeChatId(provider?.telegram_web_chat_id || ""),
      telegram_chat_id: normalizeChatId(
        provider?.telegram_chat_id || provider?.chatId || ""
      ),
    });
  }

  function cancelInlineEdit() {
    if (inlineSaving) return;
    setInlineEditId(null);
    setInlineError("");
    setInlineForm({
      telegram_refused_chat_id: "",
      telegram_web_chat_id: "",
      telegram_chat_id: "",
    });
  }

  function changeInlineField(field, value) {
    setInlineForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

async function saveInlineEdit(item) {
    if (!item?.id) return;

    const tgFields = [
      ["telegram_refused_chat_id", inlineForm.telegram_refused_chat_id],
      ["telegram_web_chat_id", inlineForm.telegram_web_chat_id],
      ["telegram_chat_id", inlineForm.telegram_chat_id],
    ];

    for (const [field, value] of tgFields) {
      if (!isValidChatId(value)) {
        setInlineError(`${field}: только цифры и optional "-" в начале`);
        return;
      }
    }

    setInlineSaving(true);
    setInlineError("");

    try {
      const payload = {
        title: item?.title || "",
        description: item?.description || "",
        category: item?.category || "",
        price:
          item?.price === null || typeof item?.price === "undefined"
            ? null
            : item.price,
        vehicle_model: item?.vehicle_model || "",
        images: Array.isArray(item?.images) ? item.images : [],
        availability: Array.isArray(item?.availability) ? item.availability : [],
        details:
          item?.details && typeof item.details === "object" && !Array.isArray(item.details)
            ? item.details
            : {},
        telegram_refused_chat_id: normalizeChatId(inlineForm.telegram_refused_chat_id),
        telegram_web_chat_id: normalizeChatId(inlineForm.telegram_web_chat_id),
        telegram_chat_id: normalizeChatId(inlineForm.telegram_chat_id),
      };

      const resp = await http.put(apiPath(`/admin/services/${item.id}`), payload);
      const data = ensureJsonOrThrow(resp, "saveInlineEdit");

      if (!data?.ok) {
        throw new Error(data?.message || "Не удалось сохранить TG");
      }

      showToast("ok", `✅ TG для услуги #${item.id} сохранён`);
      setInlineEditId(null);
      await loadList(page);

      if (detailsItem?.id === item.id) {
        await openDetails(item.id);
      }
    } catch (e) {
      const info = extractAxiosError(e);
      setInlineError(info.msg || "Ошибка сохранения TG");
    } finally {
      setInlineSaving(false);
    }
  }

  async function askActual(id, force = false) {
    setSendingId(id);
    setError("");
    try {
      const resp = await http.post(apiPath(`/admin/refused/${id}/ask-actual`), null, {
        params: { force: force ? "1" : "0" },
      });

      const data = ensureJsonOrThrow(resp, "askActual");
      if (!data?.success) {
        if (data?.locked && data?.meta?.lockUntil) {
          showToast("warn", `⏳ Заблокировано до ${formatDate(data.meta.lockUntil)}`);
          return;
        }
        throw new Error(data?.message || "Не удалось отправить");
      }

      if (data?.sent || data?.ok) {
        showToast("ok", `✅ Отправлено, chatId=${data?.chatId || "—"}`);
      } else {
        showToast(
          "warn",
          `⚠️ Не отправлено: ${data?.tg?.error || data?.message || "unknown"}`
        );
      }

      await loadList(page);
      if (detailsItem?.id === id) {
        await openDetails(id);
      }
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
    } finally {
      setSendingId(null);
    }
  }


  function toggleSelectOne(id) {
    const n = Number(id);
    if (!Number.isFinite(n)) return;
    setSelectedIds((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]
    );
  }

  function toggleSelectVisible() {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        return prev.filter((id) => !selectableVisibleIds.includes(id));
      }
      return Array.from(new Set([...prev, ...selectableVisibleIds]));
    });
  }

  function resetFilters() {
    setCategory("");
    setStatus("");
    setQ("");
    setActuality("actual");
    setVisibility("active");
    setQuickFilter("all");
    setSelectedIds([]);
    setPage(1);
  }

  async function askActualSelected(force = false) {
    const ids = askableSelectedIds;

    if (!ids.length) {
      showToast("warn", "Выберите услуги с TG chatId на текущей странице");
      return;
    }

    setBulkSending(true);
    setError("");
    try {
      const resp = await http.post(
        apiPath(`/admin/refused/ask-actual/bulk`),
        { ids, force: force ? "1" : "0" },
        { params: { force: force ? "1" : "0" } }
      );
      const data = ensureJsonOrThrow(resp, "askActualSelected");
      if (!data?.success) {
        throw new Error(data?.message || "Не удалось отправить выбранным");
      }

      showToast(
        data.sent > 0 ? "ok" : "warn",
        `📨 Выбрано: ${data.total || ids.length}. Отправлено: ${data.sent || 0}. Lock: ${data.locked || 0}. Без TG: ${data.noChat || 0}. Ошибки: ${data.failed || 0}.`
      );

      setSelectedIds([]);
      await loadList(page);
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
    } finally {
      setBulkSending(false);
    }
  }

  async function extendSelected() {
    const ids = extendableSelectedIds;
    if (!ids.length) {
      showToast("warn", "Выберите активные услуги на текущей странице");
      return;
    }

    setBulkSending(true);
    setError("");
    try {
      let ok = 0;
      let failed = 0;
      for (const id of ids) {
        const resp = await http.post(apiPath(`/admin/refused/${id}/extend`));
        const data = ensureJsonOrThrow(resp, `extendSelected:${id}`);
        if (data?.success) ok += 1;
        else failed += 1;
      }

      showToast(
        failed ? "warn" : "ok",
        `Продлено: ${ok}. Ошибки: ${failed}.`
      );

      setSelectedIds([]);
      await loadList(page);
      if (detailsItem?.id && ids.includes(Number(detailsItem.id))) {
        await openDetails(detailsItem.id);
      }
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
    } finally {
      setBulkSending(false);
    }
  }

  async function extendService(id) {
    setSendingId(id);
    setError("");
    try {
      const resp = await http.post(apiPath(`/admin/refused/${id}/extend`));
      const data = ensureJsonOrThrow(resp, "extendService");
      if (!data?.success) {
        throw new Error(data?.message || "Не удалось продлить");
      }

      showToast("ok", "✅ Продлено на 7 дней");
      await loadList(page);

      if (detailsItem?.id === id) {
        await openDetails(id);
      }
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
    } finally {
      setSendingId(null);
    }
  }

  async function deleteService(id) {
    const ok = window.confirm(`Удалить услугу #${id}?`);
    if (!ok) return;

    setSendingId(id);
    setError("");
    try {
      const resp = await http.delete(apiPath(`/admin/refused/${id}`));
      const data = ensureJsonOrThrow(resp, "deleteService");
      if (!data?.success) {
        throw new Error(data?.message || "Не удалось удалить");
      }

      showToast("ok", "✅ Услуга удалена");

      if (detailsItem?.id === id) {
        await openDetails(id);
      }
      await loadList(page);
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
    } finally {
      setSendingId(null);
    }
  }

  async function restoreService(id) {
    setSendingId(id);
    setError("");
    try {
      const resp = await http.post(apiPath(`/admin/refused/${id}/restore`));
      const data = ensureJsonOrThrow(resp, "restoreService");
      if (!data?.success) {
        throw new Error(data?.message || "Не удалось восстановить");
      }

      showToast("ok", "✅ Услуга восстановлена");

      if (detailsItem?.id === id) {
        await openDetails(id);
      }
      await loadList(page);
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
    } finally {
      setSendingId(null);
    }
  }

  const categories = [
    { value: "", label: "Все отказные и авторские" },
    { value: "refused_tour", label: "Отказной тур" },
    { value: "author_tour", label: "Авторский тур" },
    { value: "refused_hotel", label: "Отказной отель" },
    { value: "refused_flight", label: "Отказной авиабилет" },
    { value: "refused_ticket", label: "Отказной билет" },
  ];

  const statuses = [
    { value: "", label: "На витрине (published/approved)" },
    { value: "published", label: "published" },
    { value: "approved", label: "approved" },
    { value: "draft", label: "draft" },
    { value: "rejected", label: "rejected" },
    { value: "archived", label: "archived" },
  ];

  const actualityOptions = [
    { value: "all", label: "Все" },
    { value: "actual", label: "Только актуальные" },
    { value: "inactive", label: "Только неактуальные" },
  ];

  const visibilityOptions = [
    { value: "active", label: "Активные" },
    { value: "deleted", label: "Удалённые" },
    { value: "all", label: "Все" },
  ];

const sortLabel = useMemo(() => {
  const name =
    sortBy === "id"
      ? "ID"
      : sortBy === "created_at"
      ? "Дата создания"
      : sortBy === "provider"
      ? "Провайдер"
      : "Дата (сорт)";
    const arrow = sortOrder === "asc" ? "↑" : "↓";
    return `${name} ${arrow}`;
  }, [sortBy, sortOrder]);

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Контроль отказных предложений</h1>
          <p className="mt-1 text-sm text-gray-600">
            Рабочая очередь для проверки актуальности, продления, публикации и редактирования отказных услуг.
          </p>
        </div>

        {toast ? (
          <div
            className={classNames(
              "rounded-xl border px-4 py-2 text-sm shadow-sm",
              toast.kind === "ok" && "border-green-200 bg-green-50 text-green-800",
              toast.kind === "warn" && "border-amber-200 bg-amber-50 text-amber-900",
              toast.kind === "err" && "border-red-200 bg-red-50 text-red-800"
            )}
          >
            {toast.text}
          </div>
        ) : null}
      </div>

      {!canUse ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
          Не найден JWT токен в localStorage/sessionStorage. Админ-страница требует авторизацию.
        </div>
      ) : null}

      {canUse && baseLooksMissing ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div className="font-semibold">API_BASE не настроен</div>
          <div className="mt-1 text-sm">
            Сейчас base пустой, а домен не localhost — запросы уйдут на фронтенд и вернут HTML.
            <div className="mt-2">
              Настрой env: <span className="font-mono">VITE_API_BASE_URL=https://api.travella.uz</span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Что сделать сейчас</div>
            <div className="mt-1 text-sm text-slate-600">
              Сначала срочные и без ответа, потом услуги без Telegram, цены или фото. Готовые можно двигать в публикацию.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
            <button
              type="button"
              onClick={() => setQuickFilter("ready")}
              className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-left hover:bg-emerald-100"
            >
              <div className="text-2xl font-black text-emerald-950">{pageStats.readyCount}</div>
              <div className="text-xs font-bold text-emerald-700">готовые</div>
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter("urgent")}
              className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-left hover:bg-red-100"
            >
              <div className="text-2xl font-black text-red-950">{pageStats.urgentCount}</div>
              <div className="text-xs font-bold text-red-700">срочные</div>
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter("no_answer")}
              className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100"
            >
              <div className="text-2xl font-black text-amber-950">{pageStats.noAnswerCount}</div>
              <div className="text-xs font-bold text-amber-700">без ответа</div>
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter("no_tg")}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100"
            >
              <div className="text-2xl font-black text-slate-950">{pageStats.tgMissingCount}</div>
              <div className="text-xs font-bold text-slate-600">без Telegram</div>
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter("no_price")}
              className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-left hover:bg-orange-100"
            >
              <div className="text-2xl font-black text-orange-950">{pageStats.noPriceCount}</div>
              <div className="text-xs font-bold text-orange-700">без цены</div>
            </button>
            <button
              type="button"
              onClick={() => setQuickFilter("no_photo")}
              className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-left hover:bg-violet-100"
            >
              <div className="text-2xl font-black text-violet-950">{pageStats.noPhotoCount}</div>
              <div className="text-xs font-bold text-violet-700">без фото</div>
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickFilter("all");
                setActuality("inactive");
              }}
              className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-left hover:bg-blue-100"
            >
              <div className="text-2xl font-black text-blue-950">{pageStats.inactiveCount}</div>
              <div className="text-xs font-bold text-blue-700">неактуальные</div>
            </button>
          </div>
        </div>
      </div>

      <details className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer select-none text-sm font-semibold text-gray-900">
          Диагностика подключения
          <span className={classNames(
            "ml-2 rounded-full px-2 py-0.5 text-xs font-bold",
            baseSource === "missing"
              ? "bg-red-50 text-red-700"
              : baseSource === "fallback"
              ? "bg-amber-50 text-amber-700"
              : "bg-green-50 text-green-700"
          )}>
            {baseSource === "missing" ? "API не задан" : baseSource === "fallback" ? "запасной API" : "API задан"}
          </span>
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] font-bold uppercase text-slate-400">API base</div>
            <div className="mt-1 break-all font-mono text-xs text-slate-800">{base || "—"}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] font-bold uppercase text-slate-400">Prefix</div>
            <div className="mt-1 font-mono text-xs text-slate-800">{apiPrefix || "—"}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="text-[11px] font-bold uppercase text-slate-400">Источник</div>
            <div className="mt-1 text-xs font-bold text-slate-800">
              {baseSource === "env" ? "VITE_API_BASE_URL" : baseSource === "runtime" ? "window.frontend.API_BASE" : baseSource === "fallback" ? "production fallback" : "не найден"}
            </div>
          </div>
        </div>
      </details>

      <details className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer select-none text-sm font-semibold text-gray-900">
          Инструменты: открытие контактов
          <span className="ml-2 text-xs font-normal text-gray-500">
            {unlockIsPaid ? `платно • ${unlockPrice || 0} сум` : "бесплатно"}
            {unlockUpdatedAt ? ` • обновлено: ${formatDate(unlockUpdatedAt)}` : ""}
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">Открытие контактов</div>
            <div className="mt-1 text-xs text-gray-500">
              Этот переключатель влияет и на сайт, и на Telegram-бот.
              {unlockUpdatedAt ? ` Обновлено: ${formatDate(unlockUpdatedAt)}` : ""}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-end">
            <div>
              <label className="text-xs font-medium text-gray-600">Режим</label>
              <select
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
                value={unlockIsPaid ? "paid" : "free"}
                onChange={(e) => setUnlockIsPaid(e.target.value === "paid")}
                disabled={unlockCfgLoading || unlockCfgSaving}
              >
                <option value="paid">Платно</option>
                <option value="free">Бесплатно</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">Цена (сум)</label>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                value={unlockPrice}
                onChange={(e) => setUnlockPrice(e.target.value)}
                disabled={!unlockIsPaid || unlockCfgLoading || unlockCfgSaving}
                placeholder="10000"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={loadContactUnlockSettings}
                disabled={unlockCfgLoading || unlockCfgSaving}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {unlockCfgLoading ? "Загрузка…" : "Обновить"}
              </button>

              <button
                onClick={saveContactUnlockSettings}
                disabled={unlockCfgLoading || unlockCfgSaving}
                className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {unlockCfgSaving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      </details>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Всего по фильтру" value={total} hint={`на странице: ${pageStats.shown}`} tone="blue" />
        <StatCard label="Готовые" value={pageStats.readyCount} hint="можно публиковать" tone={pageStats.readyCount ? "green" : "slate"} />
        <StatCard label="Актуальные" value={pageStats.actualCount} hint="в текущей выдаче" tone="green" />
        <StatCard label="Неактуальные" value={pageStats.inactiveCount} hint="нужно проверить" tone={pageStats.inactiveCount ? "amber" : "slate"} />
        <StatCard label="Срочные" value={pageStats.urgentCount} hint="сегодня / до 5 дней" tone={pageStats.urgentCount ? "red" : "slate"} />
        <StatCard label="Без TG" value={pageStats.tgMissingCount} hint="нельзя спросить" tone={pageStats.tgMissingCount ? "red" : "slate"} />
        <StatCard label="Без ответа" value={pageStats.noAnswerCount} hint="после запроса" tone={pageStats.noAnswerCount ? "amber" : "slate"} />
        <StatCard label="Без фото" value={pageStats.noPhotoCount} hint="нужно оформить" tone={pageStats.noPhotoCount ? "amber" : "slate"} />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <QuickChip active={quickFilter === "all"} onClick={() => setQuickFilter("all")}>Все на странице</QuickChip>
              <QuickChip active={quickFilter === "ready"} onClick={() => setQuickFilter("ready")}>Готовые</QuickChip>
              <QuickChip active={quickFilter === "urgent"} onClick={() => setQuickFilter("urgent")}>Срочные</QuickChip>
              <QuickChip active={quickFilter === "no_answer"} onClick={() => setQuickFilter("no_answer")}>Без ответа</QuickChip>
              <QuickChip active={quickFilter === "no_tg"} onClick={() => setQuickFilter("no_tg")}>Без Telegram</QuickChip>
              <QuickChip active={quickFilter === "no_price"} onClick={() => setQuickFilter("no_price")}>Без цены</QuickChip>
              <QuickChip active={quickFilter === "no_photo"} onClick={() => setQuickFilter("no_photo")}>Без фото</QuickChip>
            </div>
            <div className="mt-2 text-xs font-medium text-slate-500">
              Показано после быстрых фильтров: <span className="font-bold text-slate-900">{visibleItems.length}</span> из {pageStats.shown}
              {quickFilter !== "all" ? <span className="ml-2 text-orange-700">активен быстрый фильтр</span> : null}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Сбросить фильтры
            </button>
            <div className="inline-flex w-full rounded-2xl border border-slate-200 bg-slate-50 p-1 sm:w-auto">
              <button
                type="button"
                onClick={() => setViewMode("table")}
                className={classNames(
                  "flex-1 rounded-xl px-4 py-2 text-sm font-bold transition sm:flex-none",
                  viewMode === "table" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"
                )}
              >
                Таблица
              </button>
              <button
                type="button"
                onClick={() => setViewMode("cards")}
                className={classNames(
                  "flex-1 rounded-xl px-4 py-2 text-sm font-bold transition sm:flex-none",
                  viewMode === "cards" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-900"
                )}
              >
                Карточки
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
          <div className="md:col-span-3">
            <label className="text-xs font-medium text-gray-600">Категория</label>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.value || "all"} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-medium text-gray-600">Статус</label>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={visibility === "deleted"}
            >
              {statuses.map((s) => (
                <option key={s.value || "default"} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-medium text-gray-600">Видимость</label>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
            >
              {visibilityOptions.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-medium text-gray-600">Актуальность</label>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              value={actuality}
              onChange={(e) => setActuality(e.target.value)}
            >
              {actualityOptions.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-8">
            <label className="text-xs font-medium text-gray-600">Поиск</label>
            <div className="mt-1 flex gap-2">
              <input
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="hotel, direction, provider, phone, username..."
              />
              <button
                onClick={() => {
                  setPage(1);
                  loadList(1);
                }}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                disabled={loading}
              >
                Найти
              </button>
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-medium text-gray-600">Лимит</label>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {[20, 30, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2 flex items-center justify-end gap-3 pt-1">
            <button
              onClick={() => loadList(page)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
              disabled={loading}
            >
              Обновить
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-600">
            Сортировка:{" "}
            <span className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-gray-800">
              {sortLabel}
            </span>
          </div>
        </div>

        {viewMode === "cards" ? (
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {loading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Загрузка…</div>
            ) : visibleItems.length ? (
              visibleItems.map((it) => {
                const effectiveTg =
                  it?.provider?.telegram_refused_chat_id ||
                  it?.provider?.telegram_web_chat_id ||
                  it?.provider?.telegram_chat_id ||
                  it?.provider?.chatId ||
                  "";
                const tgOk = !!effectiveTg;
                const actual = !!it.isActual;
                const deleted = !!it.deletedAt || String(it.status || "").toLowerCase() === "deleted";
                const urgency = daysUntilText(it?.expirationAt || it?.expiration_at || it?.startDateForSort);
                const meta = it.meta || {};
                const price = servicePriceSummary(it);
                const qualityFlags = getServiceQualityFlags(it, tgOk);
                return (
                  <div key={it.id} className={classNames("overflow-hidden rounded-3xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", actual ? "border-slate-200" : "border-red-100")}>
                    <div className={classNames("border-b bg-gradient-to-br p-4", categoryAccent(it.category))}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-black uppercase tracking-[0.16em]">{categoryHumanLabel(it.category)} #{it.id}</div>
                          <div className="mt-2 line-clamp-2 text-lg font-black tracking-[-0.03em] text-slate-950">{serviceMainTitle(it)}</div>
                        </div>
                        <Badge tone={actual ? "green" : "red"}>{actual ? "актуален" : "неактуален"}</Badge>
                      </div>
                    </div>

                    <div className="space-y-3 p-4">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-2xl bg-slate-50 p-3">
                          <div className="text-[11px] font-bold uppercase text-slate-400">Маршрут</div>
                          <div className="mt-1 font-bold text-slate-900">{serviceRouteText(it)}</div>
                        </div>
                        <div className="rounded-2xl bg-slate-50 p-3">
                          <div className="text-[11px] font-bold uppercase text-slate-400">Даты</div>
                          <div className="mt-1 font-bold text-slate-900">{serviceDateText(it)}</div>
                        </div>
                      </div>

                      <div className={classNames(
                        "rounded-2xl border p-3",
                        price.tone === "amber" ? "border-amber-100 bg-amber-50" : "border-emerald-100 bg-emerald-50"
                      )}>
                        <div className="text-[11px] font-bold uppercase text-slate-500">Цена для продажи</div>
                        <div className="mt-1 font-black text-slate-950">{price.primary}</div>
                        <div className="mt-0.5 text-xs font-bold text-slate-600">{price.secondary}</div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge tone={urgency.tone}>{urgency.text}</Badge>
                        {tgOk ? <Badge tone="green">TG OK</Badge> : null}
                        {qualityFlags.map((flag) => (
                          <QualityFlagButton
                            key={flag.key}
                            flag={flag}
                            onClick={() => handleQualityFlagClick(it, flag)}
                          />
                        ))}
                        {meta.lastSentAt ? <Badge tone="blue">спросили</Badge> : null}
                        {meta.lastAnswer ? <Badge tone="green">ответ: {String(meta.lastAnswer)}</Badge> : null}
                        {deleted ? <Badge tone="amber">deleted</Badge> : null}
                      </div>

                      <div className="rounded-2xl border border-slate-100 bg-white p-3">
                        <div className="text-[11px] font-bold uppercase text-slate-400">Провайдер</div>
                        <div className="mt-1 font-bold text-slate-900">{it?.provider?.companyName || it?.provider?.name || "—"}</div>
                        <div className="mt-0.5 text-xs text-slate-500">
                          {it?.provider?.phone ? `📞 ${it.provider.phone}` : ""}
                          {it?.provider?.telegramUsername ? ` • @${it.provider.telegramUsername}` : ""}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button onClick={() => openDetails(it.id)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50">Детали</button>
                        <button onClick={() => openEdit(it.id)} className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100">Редактировать</button>
                        {!deleted ? (
                          <>
                            <button onClick={() => askActual(it.id, false)} disabled={!tgOk || sendingId === it.id} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50">Спросить</button>
                            <button onClick={() => extendService(it.id)} disabled={sendingId === it.id} className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50">+7 дней</button>
                          </>
                        ) : (
                          <button onClick={() => restoreService(it.id)} disabled={sendingId === it.id} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50">Восстановить</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <RefusedEmptyState quickFilter={quickFilter} onReset={resetFilters} />
            )}
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between">
              <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-800">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected;
                  }}
                  onChange={toggleSelectVisible}
                  disabled={!selectableVisibleIds.length || bulkSending}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Выбрать все на странице
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                  Выбрано: {selectedIds.length}
                </span>
                <button
                  type="button"
                  onClick={() => askActualSelected(false)}
                  disabled={!askableSelectedIds.length || bulkSending}
                  className={classNames(
                    "rounded-xl border px-3 py-2 text-xs font-bold",
                    !askableSelectedIds.length || bulkSending
                      ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                      : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                  )}
                  title={!askableSelectedIds.length ? "Среди выбранных нет услуг с Telegram chatId" : "Спросить актуальность выбранных услуг"}
                >
                  {bulkSending ? "Отправка…" : `Спросить с TG (${askableSelectedIds.length})`}
                </button>
                <button
                  type="button"
                  onClick={extendSelected}
                  disabled={!extendableSelectedIds.length || bulkSending}
                  className={classNames(
                    "rounded-xl border px-3 py-2 text-xs font-bold",
                    !extendableSelectedIds.length || bulkSending
                      ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                      : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                  )}
                  title="Продлить выбранные активные услуги на 7 дней"
                >
                  {bulkSending ? "Продление…" : `Продлить +7 (${extendableSelectedIds.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  disabled={!selectedIds.length || bulkSending}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Снять выбор
                </button>
              </div>
            </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-[1480px] w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 text-gray-700">
              <tr>
                <th className="w-12 px-3 py-2 text-left font-medium">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    onChange={toggleSelectVisible}
                    disabled={!selectableVisibleIds.length || bulkSending}
                    className="h-4 w-4 rounded border-slate-300"
                    title="Выбрать все на странице"
                  />
                </th>
                <th
                  className={thClass("id")}
                  onClick={() => toggleSort("id")}
                  title="Сортировать по ID"
                >
                  ID
                  <span className={iconClass("id")}>{sortIcon("id")}</span>
                  <SortBadge active={sortBy === "id"} dir={sortOrder} />
                </th>
                <th className="px-3 py-2 text-left font-medium">Категория</th>
                <th className="px-3 py-2 text-left font-medium">Название</th>
                <th className="px-3 py-2 text-left font-medium">Цена</th>
                <th
                  className={thClass("created_at")}
                  onClick={() => toggleSort("created_at")}
                  title="Сортировать по дате создания"
                >
                  Дата создания
                  <span className={iconClass("created_at")}>{sortIcon("created_at")}</span>
                  <SortBadge active={sortBy === "created_at"} dir={sortOrder} />
                </th>
                <th
                  className={thClass("sort_date")}
                  onClick={() => toggleSort("sort_date")}
                  title="Сортировать по ближайшей дате услуги"
                >
                  Дата (сорт)
                  <span className={iconClass("sort_date")}>{sortIcon("sort_date")}</span>
                  <SortBadge active={sortBy === "sort_date"} dir={sortOrder} />
                </th>
                <th
                  className={thClass("provider")}
                  onClick={() => toggleSort("provider")}
                  title="Сортировать по провайдеру"
                >
                  Провайдер
                  <span className={iconClass("provider")}>{sortIcon("provider")}</span>
                  <SortBadge active={sortBy === "provider"} dir={sortOrder} />
                </th>
                <th className="px-3 py-2 text-left font-medium">TG</th>
                <th className="px-3 py-2 text-left font-medium">Проверка</th>
                <th className="px-3 py-2 text-left font-medium">Meta</th>
                <th className="px-3 py-2 text-left font-medium">Действия</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td className="px-3 py-3 text-gray-600" colSpan={12}>
                    Загрузка…
                  </td>
                </tr>
              ) : visibleItems.length ? (
                visibleItems.map((it) => {
                  const effectiveTg =
                    it?.provider?.telegram_refused_chat_id ||
                    it?.provider?.telegram_web_chat_id ||
                    it?.provider?.telegram_chat_id ||
                    it?.provider?.chatId ||
                    "";

                  const tgOk = !!effectiveTg;
                  const actual = !!it.isActual;
                  const deleted =
                    !!it.deletedAt || String(it.status || "").toLowerCase() === "deleted";

                  const meta = it.meta || {};
                  const lockUntil = meta.lockUntil;
                  const lastSentAt = meta.lastSentAt;
                  const lastAnswer = meta.lastAnswer;
                  const lastSentBy = String(meta.lastSentBy || "").toLowerCase();
                  const price = servicePriceSummary(it);
                  const qualityFlags = getServiceQualityFlags(it, tgOk);

                  const sentBadge =
                    lastSentBy === "job"
                      ? {
                          text: "AUTO",
                          cls: "border-violet-200 bg-violet-50 text-violet-700",
                        }
                      : lastSentBy === "admin"
                      ? {
                          text: "ADMIN",
                          cls: "border-sky-200 bg-sky-50 text-sky-700",
                        }
                      : null;

                  return (
                    <tr key={it.id} className="bg-white hover:bg-gray-50">
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(Number(it.id))}
                          onChange={() => toggleSelectOne(it.id)}
                          disabled={deleted || bulkSending}
                          className="h-4 w-4 rounded border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                          title={deleted ? "Удалённые не выбираются" : "Выбрать услугу"}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-900">{it.id}</td>

                      <td className="whitespace-nowrap px-3 py-2">
                        <Badge tone="blue">{categoryHumanLabel(it.category)}</Badge>
                        <div className="mt-1 font-mono text-[11px] text-slate-500">{it.category || "—"}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={actual ? "green" : "red"}>{actual ? "actual" : "inactive"}</Badge>
                          {deleted ? <Badge tone="amber">deleted</Badge> : null}
                        </div>
                      </td>

                      <td className="px-3 py-2 align-top">
                        {qualityFlags.length ? (
                          <div className="flex flex-wrap gap-1">
                            {qualityFlags.map((flag) => (
                              <QualityFlagButton
                                key={flag.key}
                                flag={flag}
                                onClick={() => handleQualityFlagClick(it, flag)}
                              />
                            ))}
                          </div>
                        ) : (
                          <Badge tone="green">готово</Badge>
                        )}
                      </td>

                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">
                          {short(it.title || it.details?.hotel || it.details?.hotelName || "—", 70)}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-600">
                          status: <span className="font-mono">{it.status}</span>
                        </div>
                        <div className="mt-1 text-xs font-medium text-slate-600">
                          {serviceRouteText(it)} · {serviceDateText(it)}
                        </div>
                      </td>

                      <td className="px-3 py-2 align-top">
                        <div className={classNames(
                          "rounded-xl border px-2 py-1 text-xs",
                          price.tone === "amber"
                            ? "border-amber-100 bg-amber-50 text-amber-950"
                            : "border-emerald-100 bg-emerald-50 text-emerald-950"
                        )}>
                          <span className="font-bold">{price.primary}</span>
                          <span className={classNames("ml-1", price.tone === "amber" ? "text-amber-700" : "text-emerald-700")}>{price.secondary}</span>
                        </div>
                      </td>

                      <td className={classNames(tdClass("created_at"), "whitespace-nowrap")}>
                        {it.createdAt ? (
                          <div className="text-gray-900">{formatDate(it.createdAt)}</div>
                        ) : (
                          <div className="text-gray-500">—</div>
                        )}
                      </td>

                      <td className={classNames(tdClass("sort_date"), "whitespace-nowrap")}>
                        {it.startDateForSort ? (
                          <div className="text-gray-900">{formatDate(it.startDateForSort)}</div>
                        ) : (
                          <div className="text-gray-500">—</div>
                        )}
                      </td>

                      <td className={tdClass("provider")}>
                        <div className="font-medium text-gray-900">
                          {it?.provider?.companyName || it?.provider?.name || "—"}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-600">
                          {it?.provider?.phone ? `📞 ${it.provider.phone}` : ""}
                          {it?.provider?.telegramUsername ? ` • @${it.provider.telegramUsername}` : ""}
                        </div>
                      </td>

                      <td className="px-3 py-2 align-top">
                        {inlineEditId === it.id ? (
                          <div className="min-w-[320px] space-y-2">
                            <div>
                              <div className="text-[11px] text-gray-500">refused</div>
                              <input
                                className={classNames(
                                  "mt-1 w-full rounded-lg border px-2 py-1.5 font-mono text-xs outline-none focus:ring-2",
                                  !isValidChatId(inlineForm.telegram_refused_chat_id)
                                    ? "border-red-300 bg-red-50/40 focus:ring-red-100"
                                    : "border-gray-200 focus:ring-gray-200"
                                )}
                                value={inlineForm.telegram_refused_chat_id}
                                onChange={(e) =>
                                  changeInlineField("telegram_refused_chat_id", e.target.value)
                                }
                                placeholder="telegram_refused_chat_id"
                                disabled={inlineSaving}
                              />
                            </div>

                            <div>
                              <div className="text-[11px] text-gray-500">web</div>
                              <input
                                className={classNames(
                                  "mt-1 w-full rounded-lg border px-2 py-1.5 font-mono text-xs outline-none focus:ring-2",
                                  !isValidChatId(inlineForm.telegram_web_chat_id)
                                    ? "border-red-300 bg-red-50/40 focus:ring-red-100"
                                    : "border-gray-200 focus:ring-gray-200"
                                )}
                                value={inlineForm.telegram_web_chat_id}
                                onChange={(e) =>
                                  changeInlineField("telegram_web_chat_id", e.target.value)
                                }
                                placeholder="telegram_web_chat_id"
                                disabled={inlineSaving}
                              />
                            </div>

                            <div>
                              <div className="text-[11px] text-gray-500">default</div>
                              <input
                                className={classNames(
                                  "mt-1 w-full rounded-lg border px-2 py-1.5 font-mono text-xs outline-none focus:ring-2",
                                  !isValidChatId(inlineForm.telegram_chat_id)
                                    ? "border-red-300 bg-red-50/40 focus:ring-red-100"
                                    : "border-gray-200 focus:ring-gray-200"
                                )}
                                value={inlineForm.telegram_chat_id}
                                onChange={(e) => changeInlineField("telegram_chat_id", e.target.value)}
                                placeholder="telegram_chat_id"
                                disabled={inlineSaving}
                              />
                            </div>

                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-[11px] text-gray-700">
                              Effective:{" "}
                              <span className="font-mono">
                                {getEffectiveProviderChatId(inlineForm) || "—"}
                              </span>
                            </div>

                            {inlineError ? (
                              <div className="text-[11px] text-red-600">{inlineError}</div>
                            ) : null}

                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => saveInlineEdit(it)}
                                disabled={inlineSaving}
                                className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1 text-xs text-green-700 hover:bg-green-100 disabled:opacity-60"
                              >
                                {inlineSaving ? "..." : "Сохранить"}
                              </button>
                              <button
                                onClick={cancelInlineEdit}
                                disabled={inlineSaving}
                                className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs hover:bg-gray-50 disabled:opacity-60"
                              >
                                Отмена
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <Badge tone={tgOk ? "green" : "red"}>
                              {tgOk ? "chatId OK" : "нет chatId"}
                            </Badge>

                            <div className="mt-1 font-mono text-xs text-gray-600">
                              {effectiveTg || "—"}
                            </div>

                            <button
                              onClick={() => openInlineEdit(it)}
                              className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs text-sky-700 hover:bg-sky-100"
                            >
                              TG inline edit
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2">
                        <div className="text-xs text-gray-700">
                          sent:{" "}
                          <span className="font-mono">{lastSentAt ? formatDate(lastSentAt) : "—"}</span>
                          {lastSentAt && sentBadge ? (
                            <span
                              className={classNames(
                                "ml-1 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                                sentBadge.cls
                              )}
                            >
                              {sentBadge.text}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-gray-700">
                          answer: <span className="font-mono">{lastAnswer ? String(lastAnswer) : "—"}</span>
                        </div>
                        <div className="text-xs text-gray-700">
                          lock: <span className="font-mono">{lockUntil ? formatDate(lockUntil) : "—"}</span>
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openDetails(it.id)}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
                          >
                            Детали
                          </button>

                          <button
                            onClick={() => openEdit(it.id)}
                            className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs text-violet-700 hover:bg-violet-100"
                          >
                            Редактировать
                          </button>

                          {!deleted ? (
                            <>
                              <button
                                onClick={() => askActual(it.id, false)}
                                disabled={!tgOk || sendingId === it.id}
                                className={classNames(
                                  "rounded-lg border px-3 py-1.5 text-xs",
                                  !tgOk || sendingId === it.id
                                    ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                                    : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                )}
                                title={!tgOk ? "У провайдера нет telegram chatId" : "Спросить актуальность"}
                              >
                                {sendingId === it.id ? "Отправка…" : "Спросить"}
                              </button>

                              <button
                                onClick={() => askActual(it.id, true)}
                                disabled={!tgOk || sendingId === it.id}
                                className={classNames(
                                  "rounded-lg border px-3 py-1.5 text-xs",
                                  !tgOk || sendingId === it.id
                                    ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                                    : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                                )}
                                title="Принудительно, даже если lockUntil не прошёл"
                              >
                                Force
                              </button>

                              <button
                                onClick={() => extendService(it.id)}
                                disabled={sendingId === it.id}
                                className={classNames(
                                  "rounded-lg border px-3 py-1.5 text-xs",
                                  sendingId === it.id
                                    ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                                    : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                                )}
                                title="Продлить на 7 дней"
                              >
                                Продлить
                              </button>

                              <button
                                onClick={() => deleteService(it.id)}
                                disabled={sendingId === it.id}
                                className={classNames(
                                  "rounded-lg border px-3 py-1.5 text-xs",
                                  sendingId === it.id
                                    ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                                    : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                )}
                                title="Удалить услугу"
                              >
                                Удалить
                              </button>

                              <a
                                href={`/dashboard?from=admin&service=${it.id}`}
                                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
                                target="_blank"
                                rel="noreferrer"
                              >
                                На сайте
                              </a>
                            </>
                          ) : (
                            <button
                              onClick={() => restoreService(it.id)}
                              disabled={sendingId === it.id}
                              className={classNames(
                                "rounded-lg border px-3 py-1.5 text-xs",
                                sendingId === it.id
                                  ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                                  : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                              )}
                              title="Восстановить услугу"
                            >
                              Восстановить
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-3 py-3 text-gray-600" colSpan={12}>
                    <RefusedEmptyState quickFilter={quickFilter} onReset={resetFilters} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
          </>
        )}

        <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-gray-600">
            Всего: <span className="font-medium text-gray-900">{total}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              ← Назад
            </button>
            <div className="text-sm text-gray-700">
              Стр. <span className="font-medium text-gray-900">{page}</span> из{" "}
              <span className="font-medium text-gray-900">{pageCount}</span>
            </div>
            <button
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || loading}
            >
              Вперёд →
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={detailsOpen}
        title={detailsItem ? `Отказ #${detailsItem.id} — ${detailsItem.category}` : "Детали отказа"}
        onClose={() => setDetailsOpen(false)}
        footer={
          detailsItem ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-gray-600">
                Провайдер:{" "}
                <span className="font-medium text-gray-900">
                  {detailsItem?.provider?.companyName || detailsItem?.provider?.name || "—"}
                </span>
                {(
                  detailsItem?.provider?.telegram_refused_chat_id ||
                  detailsItem?.provider?.telegram_web_chat_id ||
                  detailsItem?.provider?.telegram_chat_id ||
                  detailsItem?.provider?.chatId
                ) ? (
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    chatId: {
                      detailsItem?.provider?.telegram_refused_chat_id ||
                      detailsItem?.provider?.telegram_web_chat_id ||
                      detailsItem?.provider?.telegram_chat_id ||
                      detailsItem?.provider?.chatId
                    }
                  </span>
                ) : null}
              </div>

              {String(detailsItem?.status || "").toLowerCase() === "deleted" || detailsItem?.deletedAt ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => restoreService(detailsItem.id)}
                    className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100"
                    disabled={sendingId === detailsItem.id}
                  >
                    Восстановить
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => openEdit(detailsItem.id)}
                    className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-700 hover:bg-violet-100"
                  >
                    Редактировать
                  </button>

                  <button
                    onClick={() => askActual(detailsItem.id, false)}
                    className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100"
                    disabled={
                      !(
                        detailsItem?.provider?.telegram_refused_chat_id ||
                        detailsItem?.provider?.telegram_web_chat_id ||
                        detailsItem?.provider?.telegram_chat_id ||
                        detailsItem?.provider?.chatId
                      ) || sendingId === detailsItem.id
                    }
                  >
                    Спросить
                  </button>

                  <button
                    onClick={() => askActual(detailsItem.id, true)}
                    className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 hover:bg-amber-100"
                    disabled={
                      !(
                        detailsItem?.provider?.telegram_refused_chat_id ||
                        detailsItem?.provider?.telegram_web_chat_id ||
                        detailsItem?.provider?.telegram_chat_id ||
                        detailsItem?.provider?.chatId
                      ) || sendingId === detailsItem.id
                    }
                  >
                    Force
                  </button>

                  <button
                    onClick={() => extendService(detailsItem.id)}
                    className="rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700 hover:bg-green-100"
                    disabled={sendingId === detailsItem.id}
                  >
                    Продлить
                  </button>

                  <button
                    onClick={() => deleteService(detailsItem.id)}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100"
                    disabled={sendingId === detailsItem.id}
                  >
                    Удалить
                  </button>
                </div>
              )}
            </div>
          ) : null
        }
      >
        {detailsLoading ? (
          <div className="text-sm text-gray-600">Загрузка…</div>
        ) : detailsItem ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="rounded-2xl border border-gray-200 p-4 md:col-span-5">
              <div className="text-sm font-semibold text-gray-900">Основное</div>
              <div className="mt-3 space-y-2 text-sm text-gray-800">
                <div>
                  <span className="text-gray-600">ID:</span>{" "}
                  <span className="font-mono">{detailsItem.id}</span>
                </div>
                <div>
                  <span className="text-gray-600">Категория:</span>{" "}
                  <span className="font-mono">{detailsItem.category}</span>
                </div>
                <div>
                  <span className="text-gray-600">Статус:</span>{" "}
                  <span className="font-mono">{detailsItem.status}</span>
                </div>
                <div>
                  <span className="text-gray-600">Удалена:</span>{" "}
                  <Badge
                    tone={
                      String(detailsItem?.status || "").toLowerCase() === "deleted" ||
                      detailsItem?.deletedAt
                        ? "amber"
                        : "green"
                    }
                  >
                    {String(detailsItem?.status || "").toLowerCase() === "deleted" || detailsItem?.deletedAt
                      ? "да"
                      : "нет"}
                  </Badge>
                </div>
                <div>
                  <span className="text-gray-600">Актуален:</span>{" "}
                  <Badge tone={detailsItem.isActual ? "green" : "red"}>
                    {detailsItem.isActual ? "да" : "нет"}
                  </Badge>
                </div>
                <div>
                  <span className="text-gray-600">Дата (сорт):</span>{" "}
                  <span className="font-mono">
                    {detailsItem.startDateForSort ? formatDate(detailsItem.startDateForSort) : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Title:</span>{" "}
                  <span>{detailsItem.title || "—"}</span>
                </div>
                <div>
                  <span className="text-gray-600">Deleted at:</span>{" "}
                  <span className="font-mono">
                    {detailsItem.deletedAt ? formatDate(detailsItem.deletedAt) : "—"}
                  </span>
                </div>
              </div>

              <div className="mt-4 border-t border-gray-200 pt-4">
                <div className="text-sm font-semibold text-gray-900">Провайдер</div>
                <div className="mt-3 space-y-2 text-sm text-gray-800">
                  <div>
                    <span className="text-gray-600">Компания/имя:</span>{" "}
                    <span>
                      {detailsItem?.provider?.companyName || detailsItem?.provider?.name || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Телефон:</span>{" "}
                    <span className="font-mono">{detailsItem?.provider?.phone || "—"}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Username:</span>{" "}
                    <span className="font-mono">
                      {detailsItem?.provider?.telegramUsername
                        ? `@${detailsItem.provider.telegramUsername}`
                        : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">chatId:</span>{" "}
                    <span className="font-mono">
                      {detailsItem?.provider?.telegram_refused_chat_id ||
                        detailsItem?.provider?.telegram_web_chat_id ||
                        detailsItem?.provider?.telegram_chat_id ||
                        detailsItem?.provider?.chatId ||
                        "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 p-4 md:col-span-7">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900">details (JSON)</div>
                <button
                  onClick={() => openEdit(detailsItem.id)}
                  className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs text-violet-700 hover:bg-violet-100"
                >
                  Открыть редактор
                </button>
              </div>
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                {JSON.stringify(detailsItem.details || {}, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-600">Нет данных.</div>
        )}
      </Modal>

      {Boolean(previewImageSrc) ? (
        <div className="fixed inset-0 z-[120]">
          <div className="absolute inset-0 bg-black/75" onClick={closePreview} aria-hidden="true" />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-6xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
                <div>
                  <div className="text-base font-semibold text-gray-900">{previewImageTitle || "Просмотр изображения"}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {Array.isArray(previewGallery) && previewGallery.length
                      ? `${previewIndex + 1} из ${previewGallery.length}`
                      : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={previewImageSrc}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Открыть в новой вкладке
                  </a>
                  <button
                    type="button"
                    onClick={closePreview}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Закрыть
                  </button>
                </div>
              </div>

              <div className="relative bg-black/5 p-4">
                <div className="flex max-h-[78vh] items-center justify-center overflow-hidden rounded-2xl bg-black/5">
                  <img
                    src={previewImageSrc}
                    alt={previewImageTitle || "preview"}
                    className="max-h-[74vh] w-full object-contain"
                  />
                </div>

                {Array.isArray(previewGallery) && previewGallery.length > 1 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => goPreview(-1)}
                      disabled={previewIndex <= 0}
                      className="absolute left-6 top-1/2 -translate-y-1/2 rounded-full border border-gray-200 bg-white/95 px-3 py-2 text-sm shadow disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => goPreview(1)}
                      disabled={previewIndex >= previewGallery.length - 1}
                      className="absolute right-6 top-1/2 -translate-y-1/2 rounded-full border border-gray-200 bg-white/95 px-3 py-2 text-sm shadow disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      →
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        open={editOpen}
        fullscreen
        title={
          editForm?.id
            ? `Редактирование услуги #${editForm.id}`
            : "Редактирование услуги"
        }
        subtitle={
          editForm
            ? [
                categoryHumanLabel(editForm.category),
                editForm.provider_name
                  ? `Поставщик: ${editForm.provider_name}`
                  : null,
              ]
                .filter(Boolean)
                .join(" • ")
            : ""
        }
        onClose={closeEditEditor}
        headerExtra={
          editForm ? (
            <div className="flex items-center gap-2">
              {hasUnsavedEditChanges ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Есть изменения
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Сохранено
                </span>
              )}

              <span
                className={classNames(
                  "hidden rounded-full border bg-gradient-to-r px-3 py-1.5 text-xs font-bold md:inline-flex",
                  categoryAccent(editForm.category)
                )}
              >
                {categoryHumanLabel(editForm.category)}
              </span>
            </div>
          ) : null
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              {!editValidation.valid ? (
                <div className="text-sm font-bold text-red-700">
                  ⚠ {editValidation.summary.length}{" "}
                  {editValidation.summary.length === 1
                    ? "ошибка мешает"
                    : "ошибки мешают"}{" "}
                  сохранить
                </div>
              ) : hasUnsavedEditChanges ? (
                <div className="text-sm font-bold text-amber-700">
                  ● Есть несохранённые изменения
                </div>
              ) : (
                <div className="text-sm font-bold text-emerald-700">
                  ✓ Все изменения сохранены
                </div>
              )}

              <div className="mt-1 text-xs text-slate-500">
                Изменения применяются к услуге, карточке сайта и данным Telegram.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={cancelEditEditor}
                disabled={editSaving}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Закрыть
              </button>

              <button
                type="button"
                onClick={() => saveEdit({ closeAfterSave: false })}
                disabled={
                  editLoading ||
                  editSaving ||
                  !editForm ||
                  !editValidation.valid ||
                  !hasUnsavedEditChanges
                }
                className="rounded-xl border border-violet-200 bg-violet-50 px-5 py-2.5 text-sm font-bold text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editSaving && !saveAndCloseRequested
                  ? "Сохраняю…"
                  : "Сохранить"}
              </button>

              <button
                type="button"
                onClick={() => saveEdit({ closeAfterSave: true })}
                disabled={
                  editLoading ||
                  editSaving ||
                  !editForm ||
                  !editValidation.valid ||
                  !hasUnsavedEditChanges
                }
                className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {editSaving && saveAndCloseRequested
                  ? "Сохраняю…"
                  : "Сохранить и закрыть"}
              </button>
            </div>
          </div>
        }
      >
        {editLoading ? (
          <div className="text-sm text-gray-600">Загрузка…</div>
      ) : editForm ? (
        <div className="mx-auto max-w-[1600px] space-y-5">
            {editError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {editError}
              </div>
            ) : null}

            {!editError && !editValidation.valid ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="font-semibold">Проверь поля перед сохранением</div>
                <ul className="mt-2 list-disc pl-5">
                  {editValidation.summary.slice(0, 8).map((msg, idx) => (
                    <li key={`edit-warning-${idx}`}>{msg}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="sticky top-0 z-20 -mx-5 -mt-5 border-b border-slate-200 bg-slate-50/95 px-5 py-3 backdrop-blur">
              <div className="mx-auto flex max-w-[1600px] gap-2 overflow-x-auto">
                {editorTabs.map((tab) => {
                  const active = editTab === tab.id;
                  const hasErrors = Number(tab.errorCount || 0) > 0;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setEditTab(tab.id)}
                      className={classNames(
                        "inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-bold transition",
                        active
                          ? "border-slate-950 bg-slate-950 text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950"
                      )}
                    >
                      <span>{tab.icon}</span>
                      <span>{tab.label}</span>

                      {hasErrors ? (
                        <span
                          className={classNames(
                            "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-black",
                            active
                              ? "bg-red-500 text-white"
                              : "bg-red-100 text-red-700"
                          )}
                        >
                          {tab.errorCount}
                        </span>
                      ) : Number(tab.count || 0) > 0 ? (
                        <span
                          className={classNames(
                            "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-black",
                            active
                              ? "bg-white/20 text-white"
                              : "bg-slate-100 text-slate-600"
                          )}
                        >
                          {tab.count}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {editTab === "main" ? (
              <>
            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="text-sm font-semibold text-gray-900">Общие поля услуги</div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="ID">
                  <TextInput value={String(editForm.id || "")} onChange={() => {}} disabled />
                </Field>

                <Field label="Категория">
                  <TextInput value={editForm.category} onChange={() => {}} disabled />
                </Field>

                <Field label="Цена (services.price)" error={editValidation.root?.price}>
                  <TextInput
                    value={editForm.price}
                    onChange={(e) => updateEditRoot("price", e.target.value)}
                    placeholder="Например: 1200"
                    invalid={!!editValidation.root?.price}
                  />
                </Field>

                <div className="md:col-span-3">
                  <Field label="Название" error={editValidation.root?.title}>
                    <TextInput
                      value={editForm.title}
                      onChange={(e) => updateEditRoot("title", e.target.value)}
                      placeholder="Название услуги"
                      invalid={!!editValidation.root?.title}
                    />
                  </Field>
                </div>

                <div className="md:col-span-3">
                  <Field label="Описание">
                    <TextArea
                      value={editForm.description}
                      onChange={(e) => updateEditRoot("description", e.target.value)}
                      rows={4}
                      placeholder="Описание услуги"
                    />
                  </Field>
                </div>

                <div className="md:col-span-3">
                  <Field label="Модель транспорта / vehicle_model">
                    <TextInput
                      value={editForm.vehicle_model}
                      onChange={(e) => updateEditRoot("vehicle_model", e.target.value)}
                      placeholder="Для transport-услуг, если используется"
                    />
                  </Field>
                </div>
              </div>
            </div>
              </>
            ) : null}

            {editTab === "provider" ? (
              <>
            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900">TG / chat id провайдера</div>
                <div className="text-xs text-gray-500">
                  Приоритет: <span className="font-mono">telegram_refused_chat_id</span> → <span className="font-mono">telegram_web_chat_id</span> → <span className="font-mono">telegram_chat_id</span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="TG refused chat id" error={editValidation.provider?.telegram_refused_chat_id}>
                  <TextInput
                    value={editForm.telegram_refused_chat_id || ""}
                    onChange={(e) => updateEditRoot("telegram_refused_chat_id", e.target.value)}
                    placeholder="Например: 5267265997"
                    invalid={!!editValidation.provider?.telegram_refused_chat_id}
                  />
                </Field>

                <Field label="TG web chat id" error={editValidation.provider?.telegram_web_chat_id}>
                  <TextInput
                    value={editForm.telegram_web_chat_id || ""}
                    onChange={(e) => updateEditRoot("telegram_web_chat_id", e.target.value)}
                    placeholder="Например: 5267265997"
                    invalid={!!editValidation.provider?.telegram_web_chat_id}
                  />
                </Field>

                <Field label="TG default chat id" error={editValidation.provider?.telegram_chat_id}>
                  <TextInput
                    value={editForm.telegram_chat_id || ""}
                    onChange={(e) => updateEditRoot("telegram_chat_id", e.target.value)}
                    placeholder="Например: 5267265997"
                    invalid={!!editValidation.provider?.telegram_chat_id}
                  />
                </Field>

                <div className="md:col-span-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
                  <div>
                    Provider ID: <span className="font-mono">{editForm.provider_id || "—"}</span>
                    {editForm.provider_name ? (
                      <span className="ml-2">• {editForm.provider_name}</span>
                    ) : null}
                  </div>
                  <div className="mt-1">
                    Effective TG: <span className="font-mono">{getEffectiveProviderChatId(editForm) || "—"}</span>
                  </div>
                </div>
              </div>
            </div>
              </>
            ) : null}

            {editTab === "details" ? (
              <>
            <div className="rounded-2xl border border-gray-200 p-4">
              {hotelQuery ? (
                <div className="mb-3 text-right text-xs text-gray-500">
                  Поиск отеля: {hotelQuery}
                </div>
              ) : null}
              <div>{renderDetailFields(editForm, setEditForm, {
                hotelOptions,
                hotelLoading,
                onHotelSearch: searchHotels,
                validation: editValidation,
              })}</div>

              {(() => {
                const margin = calcMargin(editForm?.details || {});
                const net = Number(editForm?.details?.netPrice || 0);
                const gross = Number(editForm?.details?.grossPrice || 0);

                if (!Number.isFinite(net) || !Number.isFinite(gross)) return null;

                return (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-sm font-semibold text-amber-900">Маржа</div>
                    <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="rounded-xl bg-white px-3 py-2 text-sm">
                        <div className="text-gray-500">Net</div>
                        <div className="font-semibold text-gray-900">{net || 0}</div>
                      </div>
                      <div className="rounded-xl bg-white px-3 py-2 text-sm">
                        <div className="text-gray-500">Gross</div>
                        <div className="font-semibold text-gray-900">{gross || 0}</div>
                      </div>
                      <div className="rounded-xl bg-white px-3 py-2 text-sm">
                        <div className="text-gray-500">Margin</div>
                        <div className={`font-semibold ${margin >= 0 ? "text-green-700" : "text-red-700"}`}>
                          {margin >= 0 ? "+" : ""}
                          {margin}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setEditForm((prev) => {
                      const nextDetails = { ...(prev?.details || {}), isActive: true };
                      return {
                        ...prev,
                        details: nextDetails,
                        rawDetailsText: JSON.stringify(nextDetails, null, 2),
                      };
                    })
                  }
                  className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 hover:bg-green-100"
                >
                  Сделать актуальным
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setEditForm((prev) => {
                      const nextDetails = { ...(prev?.details || {}), isActive: false };
                      return {
                        ...prev,
                        details: nextDetails,
                        rawDetailsText: JSON.stringify(nextDetails, null, 2),
                      };
                    })
                  }
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
                >
                  Сделать неактуальным
                </button>
              </div>
            </div>
              </>
            ) : null}

            {editTab === "images" ? (
              <>
              <div className="rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                  <div className="text-sm font-semibold text-gray-900">
                    Фотографии карточки{" "}
                    <span className="text-xs font-normal text-gray-500">
                      ({Array.isArray(editForm.images) ? editForm.images.length : 0})
                    </span>
                  </div>

                  <div
                    className={classNames(
                      "mt-1 text-xs",
                      editValidation.raw?.images
                        ? "text-red-600"
                        : "text-gray-500"
                    )}
                  >
                    {editValidation.raw?.images ||
                      "Показываются клиентам на сайте и в Telegram. Первое изображение является главным."}
                  </div>
                  </div>
                  <div className="text-xs text-gray-500">Максимум 20 изображений</div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <label className={classNames(
                    "inline-flex cursor-pointer items-center rounded-xl border px-3 py-2 text-sm",
                    imageUploadBusy ? "border-gray-200 bg-gray-50 text-gray-400" : "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
                  )}>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleAddImagesFromFiles}
                      disabled={imageUploadBusy}
                    />
                    {imageUploadBusy ? "Загрузка..." : "Добавить файлы"}
                  </label>

                  <div className="flex min-w-[260px] flex-1 items-center gap-2">
                    <TextInput
                      value={imageUrlDraft}
                      onChange={(e) => setImageUrlDraft(e.target.value)}
                      placeholder="https://... или data:image/..."
                    />
                    <button
                      type="button"
                      onClick={handleAddImageByUrl}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      Добавить ссылку
                    </button>
                  </div>
                </div>

                {Array.isArray(editForm.images) && editForm.images.length ? (
                  <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                    {editForm.images.map((src, idx) => (
                        <div
                          key={`${idx}-${String(src).slice(0, 30)}`}
                          className={classNames(
                            "overflow-hidden rounded-2xl border bg-white transition",
                            idx === 0
                              ? "border-emerald-300 ring-2 ring-emerald-100"
                              : "border-gray-200"
                          )}
                        >
                          <div className="relative aspect-[4/3] bg-gray-100">
                            {idx === 0 ? (
                              <div className="absolute left-2 top-2 z-10 rounded-full bg-emerald-600 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow">
                                Главное фото
                              </div>
                            ) : null}

                            <button
                              type="button"
                              onClick={() => {
                                openPreview(
                                  editForm.images,
                                  idx,
                                  "Фотографии карточки"
                                );
                              }}
                              className="block h-full w-full cursor-zoom-in"
                            >
                              <img
                                src={src}
                                alt={`service-${idx + 1}`}
                                className="h-full w-full object-cover"
                              />
                            </button>
                          </div>

                          <div className="border-t border-gray-100 p-2">
                            <div className="truncate text-[11px] text-gray-500">
                              {String(src).startsWith("data:image/")
                                ? `data:image #${idx + 1}`
                                : short(String(src), 48)}
                            </div>

                            <div className="mt-2 grid grid-cols-1 gap-2">
                              {idx !== 0 ? (
                                <button
                                  type="button"
                                  onClick={() => handleMakePrimaryImage(idx)}
                                  className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                                >
                                  Сделать главным
                                </button>
                              ) : (
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-700">
                                  Используется в карточке
                                </div>
                              )}

                              <button
                                type="button"
                                onClick={() => handleRemoveImage(idx)}
                                className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
                              >
                                Удалить
                              </button>
                            </div>
                          </div>
                        </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                    Пока нет изображений.
                  </div>
                )}

                <div className="mt-4">
                  <div className="text-xs font-medium text-gray-700">images (JSON array)</div>
                  <textarea
                    rows={8}
                    className={classNames(
                      "mt-2 w-full rounded-xl px-3 py-2 font-mono text-xs outline-none focus:ring-2",
                      editValidation.raw?.images
                        ? "border border-red-300 bg-red-50/40 focus:ring-red-100"
                        : "border border-gray-200 bg-gray-50 focus:ring-gray-200"
                    )}
                    value={editForm.rawImagesText || "[]"}
                    onChange={(e) => handleRawImagesChange(e.target.value)}
                  />
                </div>
              </div>
              </>
            ) : null}

            {editTab === "proof" ? (
              <>
            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                <div className="text-sm font-semibold text-gray-900">
                  Подтверждение услуги{" "}
                  <span className="text-xs font-normal text-gray-500">
                    ({Array.isArray(editForm?.details?.proofImages)
                      ? editForm.details.proofImages.length
                      : 0})
                  </span>
                </div>

                <div className="mt-1 text-xs text-gray-500">
                  Эти изображения используются для проверки услуги и не показываются клиентам в публичной карточке.
                </div>
                </div>
                <div className="text-xs text-gray-500">Максимум 20 изображений</div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className={classNames(
                  "inline-flex cursor-pointer items-center rounded-xl border px-3 py-2 text-sm",
                  proofImageUploadBusy ? "border-gray-200 bg-gray-50 text-gray-400" : "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
                )}>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleAddProofImagesFromFiles}
                    disabled={proofImageUploadBusy}
                  />
                  {proofImageUploadBusy ? "Загрузка..." : "Добавить файлы"}
                </label>

                <div className="flex min-w-[260px] flex-1 items-center gap-2">
                  <TextInput
                    value={proofImageUrlDraft}
                    onChange={(e) => setProofImageUrlDraft(e.target.value)}
                    placeholder="https://... или data:image/..."
                  />
                  <button
                    type="button"
                    onClick={handleAddProofImageByUrl}
                    className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Добавить ссылку
                  </button>
                </div>
              </div>

              {Array.isArray(editForm?.details?.proofImages) && editForm.details.proofImages.length ? (
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {editForm.details.proofImages.map((src, idx) => (
                    <div key={`proof-${idx}-${String(src).slice(0, 30)}`} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                      <div className="aspect-[4/3] bg-gray-100">
                        <button
                            type="button"
                            onClick={() => {
                              openPreview(editForm?.details?.proofImages || [], idx, "Изображения пруфа");
                            }}
                            className="block h-full w-full cursor-zoom-in"
                          >
                            <img src={src} alt={`proof-${idx + 1}`} className="h-full w-full object-cover" />
                          </button>
                      </div>
                      <div className="border-t border-gray-100 p-2">
                        <div className="truncate text-[11px] text-gray-500">
                          {String(src).startsWith("data:image/") ? `proof data:image #${idx + 1}` : short(String(src), 48)}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveProofImage(idx)}
                          className="mt-2 w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                  Пока нет proof-изображений.
                </div>
              )}
            </div>
              </>
            ) : null}

            {editTab === "technical" ? (
              <>
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 p-4">
                <div className="text-sm font-semibold text-gray-900">availability (JSON array)</div>
                <div className={classNames("mt-3 text-xs", editValidation.raw?.availability ? "text-red-600" : "text-gray-500")}>
                  {editValidation.raw?.availability || "Пока редактируется как сырой JSON-массив."}
                </div>
                <textarea
                  rows={10}
                  className={classNames(
                    "mt-3 w-full rounded-xl px-3 py-2 font-mono text-xs outline-none focus:ring-2",
                    editValidation.raw?.availability
                      ? "border border-red-300 bg-red-50/40 focus:ring-red-100"
                      : "border border-gray-200 bg-gray-50 focus:ring-gray-200"
                  )}
                  value={editForm.rawAvailabilityText || "[]"}
                  onChange={(e) => handleRawAvailabilityChange(e.target.value)}
                />
              </div>
            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-900">Raw details JSON</div>
                <button
                  onClick={() =>
                    handleRawDetailsChange(JSON.stringify(editForm.details || {}, null, 2))
                  }
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
                >
                  Синхронизировать из формы
                </button>
              </div>
              <div className={classNames("mt-2 text-xs", editValidation.raw?.details ? "text-red-600" : "text-gray-500")}>
                {editValidation.raw?.details || "Здесь можно править любые редкие поля, которых нет в визуальной форме выше."}
              </div>
              <textarea
                rows={18}
                className={classNames(
                  "mt-3 w-full rounded-xl px-3 py-2 font-mono text-xs outline-none focus:ring-2",
                  editValidation.raw?.details
                    ? "border border-red-300 bg-red-50/40 focus:ring-red-100"
                    : "border border-gray-200 bg-gray-50 focus:ring-gray-200"
                )}
                value={editForm.rawDetailsText || "{}"}
                onChange={(e) => handleRawDetailsChange(e.target.value)}
              />
            </div>
              </div>
              </>
            ) : null}          </div>
        ) : (
          <div className="text-sm text-gray-600">Нет данных для редактирования.</div>
        )}
      </Modal>
    </div>
  );
}
