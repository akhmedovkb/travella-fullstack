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

    const allowed = new Set(["created_at", "provider", "sort_date"]);
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

function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-6xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <div className="text-base font-semibold text-gray-900">{title}</div>
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Закрыть
            </button>
          </div>
          <div className="max-h-[78vh] overflow-auto p-5">{children}</div>
          {footer ? (
            <div className="border-t border-gray-200 bg-gray-50 px-5 py-4">
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

  if (["refused_tour", "author_tour"].includes(category)) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {textField("directionCountry", "Страна направления")}
        {textField("directionFrom", "Город вылета")}
        {textField("directionTo", "Город прибытия")}
        {dateField("startDate", "Дата начала")}
        {dateField("endDate", "Дата конца")}
        {dateField("departureFlightDate", "Дата рейса вылета")}
        {dateField("returnFlightDate", "Дата рейса обратно")}
        <div className="md:col-span-3">{hotelField("hotel", "Отель")}</div>
        {textField("hotelName", "Hotel name / legacy")}
        {textField("accommodationCategory", "Категория номера")}
        {textField("roomCategory", "Room category / legacy")}
        {textField("accommodation", "Размещение")}
        {textField("food", "Питание")}
        {textField("transfer", "Трансфер")}
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
          <CheckboxField label="Можно менять" checked={details?.changeable} onChange={updateCheckbox("changeable")} />
          <CheckboxField label="Виза включена" checked={details?.visaIncluded} onChange={updateCheckbox("visaIncluded")} />
          <CheckboxField label="Страховка включена" checked={details?.insuranceIncluded} onChange={updateCheckbox("insuranceIncluded")} />
          <CheckboxField label="Раннее заселение" checked={details?.earlyCheckIn} onChange={updateCheckbox("earlyCheckIn")} />
          <CheckboxField label="Arrival Fast Track" checked={details?.arrivalFastTrack} onChange={updateCheckbox("arrivalFastTrack")} />
          <CheckboxField label="Актуально" checked={details?.isActive} onChange={updateCheckbox("isActive")} />
        </div>
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
    return env || rt || "";
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

  const [sendingId, setSendingId] = useState(null);
  const [inlineEditId, setInlineEditId] = useState(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineError, setInlineError] = useState("");
  const [inlineForm, setInlineForm] = useState({
    telegram_refused_chat_id: "",
    telegram_web_chat_id: "",
    telegram_chat_id: "",
  });

  const pageCount = useMemo(() => {
    const c = Math.ceil((total || 0) / (limit || 1));
    return Math.max(c, 1);
  }, [total, limit]);

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

  async function openEdit(id) {
    setEditOpen(true);
    setEditLoading(true);
    setEditError("");
    setEditForm(null);
    setHotelQuery("");
    setHotelOptions([]);
    setImageUrlDraft("");
    setProofImageUrlDraft("");
    try {
      const resp = await http.get(apiPath(`/admin/services/${id}`));
      const data = ensureJsonOrThrow(resp, "openEdit");
      setEditForm(createEditFormFromService(data || {}));
    } catch (e) {
      const info = extractAxiosError(e);
      setEditError(info.msg || "Ошибка загрузки услуги для редактирования");
    } finally {
      setEditLoading(false);
    }
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

  async function saveEdit() {
    if (!editForm?.id) return;

    const validation = validateEditForm(editForm);
    if (!validation.valid) {
      setEditError(validation.summary[0] || "Исправь ошибки перед сохранением");
      return;
    }

    let parsedDetails = {};
    let parsedImages = [];
    let parsedAvailability = [];
    try {
      parsedDetails = safeJsonParse(editForm.rawDetailsText || "{}", {});
      parsedImages = safeJsonParse(editForm.rawImagesText || "[]", []);
      parsedAvailability = safeJsonParse(editForm.rawAvailabilityText || "[]", []);
    } catch (e) {
      setEditError(e?.message || "Невалидный JSON");
      return;
    }

    setEditSaving(true);
    setEditError("");

    try {
      const nextForm = {
        ...editForm,
        details: parsedDetails,
        images: Array.isArray(parsedImages) ? parsedImages : [],
        availability: Array.isArray(parsedAvailability) ? parsedAvailability : [],
        rawDetailsText: JSON.stringify(parsedDetails, null, 2),
        rawImagesText: JSON.stringify(Array.isArray(parsedImages) ? parsedImages : [], null, 2),
        rawAvailabilityText: JSON.stringify(Array.isArray(parsedAvailability) ? parsedAvailability : [], null, 2),
      };
      const payload = {
        title: nextForm?.title || "",
        description: nextForm?.description || "",
        category: nextForm?.category || "",
        price:
          nextForm?.price === null || typeof nextForm?.price === "undefined"
            ? null
            : nextForm.price,
        vehicle_model: nextForm?.vehicle_model || "",
        images: Array.isArray(nextForm?.images) ? nextForm.images : [],
        availability: Array.isArray(nextForm?.availability) ? nextForm.availability : [],
        details:
          nextForm?.details &&
          typeof nextForm.details === "object" &&
          !Array.isArray(nextForm.details)
            ? nextForm.details
            : {},
        telegram_refused_chat_id: normalizeChatId(nextForm?.telegram_refused_chat_id),
        telegram_web_chat_id: normalizeChatId(nextForm?.telegram_web_chat_id),
        telegram_chat_id: normalizeChatId(nextForm?.telegram_chat_id),
      };

      const resp = await http.put(
        apiPath(`/admin/services/${editForm.id}`),
        payload
      );
      const data = ensureJsonOrThrow(resp, "saveEdit");

      if (!data?.ok) {
        throw new Error(data?.message || "Не удалось сохранить услугу");
      }

      setEditForm(
        createEditFormFromService({
          ...(data?.service || nextForm),
          telegram_refused_chat_id: nextForm.telegram_refused_chat_id,
          telegram_web_chat_id: nextForm.telegram_web_chat_id,
          telegram_chat_id: nextForm.telegram_chat_id,
          provider_id: nextForm.provider_id,
          provider_name: nextForm.provider_name,
        })
      );
      setEditOpen(false);
      showToast("ok", `✅ Услуга #${editForm.id} сохранена`);
      await loadList(page);

      if (detailsItem?.id === editForm.id) {
        await openDetails(editForm.id);
      }
    } catch (e) {
      const info = extractAxiosError(e);
      setEditError(info.msg || "Ошибка сохранения услуги");
    } finally {
      setEditSaving(false);
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
    { value: "", label: "Все отказные" },
    { value: "refused_tour", label: "Отказной тур" },
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
      sortBy === "created_at"
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
          <h1 className="text-xl font-semibold text-gray-900">Все отказные услуги</h1>
          <p className="mt-1 text-sm text-gray-600">
            Список всех refused_* услуг. Можно фильтровать актуальные, неактуальные и удалённые,
            вручную спросить актуальность у поставщика, продлить, удалить, восстановить и теперь
            редактировать все поля услуги.
          </p>
          <div className="mt-2 text-xs text-gray-500">
            API base: <span className="font-mono">{base ? base : "— (не задан)"}</span>
            {" • "}
            prefix: <span className="font-mono">{apiPrefix || "—"}</span>
          </div>
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

      <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
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

        <div className="mt-4 overflow-auto rounded-xl border border-gray-200">
          <table className="min-w-[1180px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 text-gray-700">
              <tr>
                <th className="px-3 py-2 text-left font-medium">ID</th>
                <th className="px-3 py-2 text-left font-medium">Категория</th>
                <th className="px-3 py-2 text-left font-medium">Название</th>
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
                <th className="px-3 py-2 text-left font-medium">Meta</th>
                <th className="px-3 py-2 text-left font-medium">Действия</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td className="px-3 py-3 text-gray-600" colSpan={9}>
                    Загрузка…
                  </td>
                </tr>
              ) : items.length ? (
                items.map((it) => {
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
                      <td className="whitespace-nowrap px-3 py-2 text-gray-900">{it.id}</td>

                      <td className="whitespace-nowrap px-3 py-2">
                        <Badge tone="blue">{it.category}</Badge>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={actual ? "green" : "red"}>{actual ? "actual" : "inactive"}</Badge>
                          {deleted ? <Badge tone="amber">deleted</Badge> : null}
                        </div>
                      </td>

                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">
                          {short(it.title || it.details?.hotel || it.details?.hotelName || "—", 70)}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-600">
                          status: <span className="font-mono">{it.status}</span>
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
                  <td className="px-3 py-3 text-gray-600" colSpan={9}>
                    Нет данных.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

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
        title={editForm ? `Редактирование услуги #${editForm.id}` : "Редактирование услуги"}
        onClose={() => {
          if (editSaving) return;
          closePreview();
          setEditOpen(false);
        }}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-gray-500">
              Сохраняются общие поля услуги и весь объект <span className="font-mono">details</span>.
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  closePreview();
                  setEditOpen(false);
                }}
                disabled={editSaving}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                onClick={saveEdit}
                disabled={editLoading || editSaving || !editForm}
                className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-700 hover:bg-violet-100 disabled:opacity-60"
              >
                {editSaving ? "Сохранение…" : "Сохранить изменения"}
              </button>
            </div>
          </div>
        }
      >
        {editLoading ? (
          <div className="text-sm text-gray-600">Загрузка…</div>
        ) : editForm ? (
          <div className="space-y-5">
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

            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3"><div className="text-sm font-semibold text-gray-900">Быстрое редактирование details по категории</div>{hotelQuery ? <div className="text-xs text-gray-500">Поиск отеля: {hotelQuery}</div> : null}</div>
              <div className="mt-4">{renderDetailFields(editForm, setEditForm, {
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

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Изображения услуги <span className="text-xs font-normal text-gray-500">({Array.isArray(editForm.images) ? editForm.images.length : 0})</span></div>
                    <div className={classNames("mt-1 text-xs", editValidation.raw?.images ? "text-red-600" : "text-gray-500")}>
                      {editValidation.raw?.images || "Можно удалять текущие изображения, добавлять новые файлы или вставлять ссылку/data URL."}
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
                      <div key={`${idx}-${String(src).slice(0, 30)}`} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                        <div className="aspect-[4/3] bg-gray-100">
                          <button
                            type="button"
                            onClick={() => {
                              openPreview(editForm.images, idx, "Изображения услуги");
                            }}
                            className="block h-full w-full cursor-zoom-in"
                          >
                            <img src={src} alt={`service-${idx + 1}`} className="h-full w-full object-cover" />
                          </button>
                        </div>
                        <div className="border-t border-gray-100 p-2">
                          <div className="truncate text-[11px] text-gray-500">
                            {String(src).startsWith("data:image/") ? `data:image #${idx + 1}` : short(String(src), 48)}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveImage(idx)}
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
            </div>

            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Изображения пруфа <span className="text-xs font-normal text-gray-500">({Array.isArray(editForm?.details?.proofImages) ? editForm.details.proofImages.length : 0})</span></div>
                  <div className="mt-1 text-xs text-gray-500">Можно добавлять и удалять proofImages прямо из модалки.</div>
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
        ) : (
          <div className="text-sm text-gray-600">Нет данных для редактирования.</div>
        )}
      </Modal>
    </div>
  );
}
