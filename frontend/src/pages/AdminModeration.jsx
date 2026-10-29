// frontend/src/pages/AdminModeration.jsx
import React, { useEffect, useRef, useState, useId } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import axios from "axios";
import { CorrectionRequestDialog, CorrectionReview } from "../components/ServiceCorrections";
import ServiceProofComparison from "../components/ServiceProofComparison";
import { BadgeCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { tSuccess, tError, tInfo } from "../shared/toast";
import { getServiceUrgency } from "../utils/serviceUrgency";

import { validateModerationEditor, changedProviderContacts } from "../utils/moderationEditor";

import { nextModerationService, readQueueLocation, writeQueueLocation, queueRequestKey, fetchModerationQueue, createQueueRunner } from "../utils/moderationQueue";

const fmt = (n) => new Intl.NumberFormat().format(Number(n || 0));
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

const REJECT_REASON_OPTIONS = [
  { code: "NO_PROOF", label: "Нет proof/подтверждения", text: "Загрузите фото или документ, подтверждающий отказную услугу." },
  { code: "BAD_PROOF", label: "Proof нечитаемый", text: "Proof нечитаемый или не подтверждает данные услуги. Загрузите более понятное подтверждение." },
  { code: "NO_DATES", label: "Не хватает дат", text: "Укажите корректные даты услуги: вылет/заезд/дату мероприятия." },
  { code: "BAD_PRICE", label: "Нужно уточнить цену", text: "Проверьте цену и укажите, за одного человека/билет или за весь пакет." },
  { code: "HOTEL_DETAILS", label: "Отель и размещение", text: "Уточните название отеля, категорию номера и размещение гостей." },
  { code: "NO_PHOTO", label: "Фото карточки", text: "Добавьте публичное фото для карточки услуги. Подтверждение брони и личные документы загружайте только в proof." },
  { code: "MISSING_DETAILS", label: "Не хватает деталей", text: "Добавьте недостающие детали услуги, чтобы клиент мог принять решение." },
  { code: "WRONG_CATEGORY", label: "Неверная категория", text: "Услуга выбрана не в той категории. Исправьте категорию и отправьте повторно." },
  { code: "DUPLICATE", label: "Похоже на дубль", text: "Похожая услуга уже есть. Обновите существующую карточку или уточните отличие." },
  { code: "OTHER", label: "Другая причина", text: "Уточните данные услуги и отправьте её на модерацию повторно." },
];

function isRefusedCategory(cat) {
  return String(cat || "").toLowerCase().startsWith("refused_");
}

function isRefusedHotelCategory(cat) {
  return String(cat || "").toLowerCase() === "refused_hotel";
}

function parseDateLoose(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function calcNights(from, to) {
  const start = parseDateLoose(from);
  const end = parseDateLoose(to);
  if (!start || !end) return "";
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const b = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  return diff > 0 && diff < 90 ? diff : "";
}

function positiveInt(value) {
  const match = String(value ?? "").match(/\d+/);
  if (!match) return 0;
  const n = Number(match[0]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function hotelGuestCount(details = {}) {
  const d = normalizeDetails(details);
  const direct = positiveInt(pickFirst(d.peopleCount, d.persons, d.people, d.guests, d.pax));
  if (direct) return direct;
  const adt = positiveInt(pickFirst(d.adt, d.adults, d.accommodationADT));
  const chd = positiveInt(pickFirst(d.chd, d.children, d.accommodationCHD));
  const inf = positiveInt(pickFirst(d.inf, d.infants, d.accommodationINF));
  const total = adt + chd + inf;
  if (total) return total;
  const raw = String(pickFirst(d.accommodation, d.placement, d.room, d.roomType, d.roomCategory) || "").toUpperCase();
  if (/\bSGL\b|SINGLE|ОДНОМЕСТ/.test(raw)) return 1;
  if (/\bDBL\b|DOUBLE|TWIN|ДВУХМЕСТ/.test(raw)) return 2;
  if (/\bTRPL\b|\bTPL\b|TRIPLE|ТР[ЕЁ]ХМЕСТ/.test(raw)) return 3;
  if (/\bQDPL\b|QUAD|QUADRUPLE|ЧЕТЫР[ЕЁ]ХМЕСТ/.test(raw)) return 4;
  return 0;
}

function parseMoneyNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function formatDt(val) {
  if (!val) return "";
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function providerFrom(svc) {
  const p = svc?.provider || {};
  return {
    id: svc?.provider_id ?? p.id ?? null,
    name: svc?.provider_name ?? p.name ?? "—",
    type: svc?.provider_type ?? p.type ?? "",
  };
}

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

const INTERNAL_DETAIL_KEYS = new Set([
  "meta", "proofReviewedAt", "proofReviewedBy", "proofReviewStatus", "proofReviewNote",
  "moderation_rejected_at", "moderation_rejection_code", "createdAt", "updatedAt",
  "created_at", "updated_at", "submittedAt", "submitted_at",
]);

const QUICK_DETAIL_KEYS = new Set([
  "directionCountry", "country", "city", "location", "title", "directionFrom", "directionTo", "direction",
  "startDate", "departureDate", "departureFlightDate", "endDate", "returnFlightDate", "returnDate",
  "nights", "hotel", "eventName", "roomCategory", "accommodationCategory", "accommodation", "netPrice", "net_price",
  "grossPrice", "gross_price", "price", "pricePerPerson", "priceFor", "food",
  "flightDetails", "flight_details", "flight_info", "flightIncluded", "airTickets",
  "aviaTickets", "transferIncluded", "hasTransfer", "transfer", "insurance",
  "insuranceIncluded", "visa", "visaIncluded", "proofImages", "proofUrl", "telegramProofFileId",
]);

const DETAIL_LABELS = {
  title: "Название", price: "Базовая цена",
  netPrice: "Netto", net_price: "Netto", grossPrice: "Gross", gross_price: "Gross",
  images: "Фото карточки", proofImages: "Proof", proofReviewStatus: "Результат проверки proof", proofReviewNote: "Комментарий проверки",
  telegram_chat_id: "Контакт Telegram", telegram_refused_chat_id: "Контакт отказных услуг", telegram_web_chat_id: "Контакт Web bot",
  availability: "Доступность", vehicle_model: "Модель транспорта",
  adt: "Взрослых", adults: "Взрослых", chd: "Детей", children: "Детей",
  inf: "Младенцев", infants: "Младенцев", guests: "Гостей", persons: "Туристов",
  peopleCount: "Количество туристов", pax: "Количество мест", maxPax: "Максимум гостей",
  duration: "Продолжительность", durationDays: "Дней", durationHours: "Часов",
  airline: "Авиакомпания", flightNumber: "Номер рейса", flightType: "Тип перелёта",
  tripType: "Тип маршрута", oneWay: "В одну сторону", baggage: "Багаж",
  meal: "Питание", halal: "Халяль", roomType: "Тип номера",
  accommodationCategory: "Категория размещения", category: "Категория номера",
  eventDate: "Дата события", eventTime: "Время события", ticketTitle: "Название билета",
  city: "Город", country: "Страна", toCity: "Город назначения", fromCity: "Город отправления",
  currency: "Валюта", urgency: "Срочность", changeable: "Можно изменить",
  isActive: "Актуально", expiration: "Действует до", expiration_at: "Действует до",
  expiration_ts: "Действует до", included: "Что включено", excluded: "Что не включено",
  notes: "Примечание", comment: "Комментарий", description: "Описание",
};

function detailLabel(key) {
  if (DETAIL_LABELS[key]) return DETAIL_LABELS[key];
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
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

function formatDetailValue(value) {
  if (value === null || typeof value === "undefined") return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function detailsToRows(details) {
  const source = normalizeDetails(details);
  return Object.entries(source).map(([key, value]) => ({
    key,
    value: formatDetailValue(value),
  }));
}

function parseDetailValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^[\[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return value;
    }
  }
  return value;
}

function rowsToDetails(rows) {
  return rows.reduce((acc, row) => {
    const key = String(row?.key || "").trim();
    if (!key) return acc;
    acc[key] = parseDetailValue(row?.value);
    return acc;
  }, {});
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

function yesNoValue(value) {
  if (value === true) return true;
  const s = String(value ?? "").trim().toLowerCase();
  return ["true", "yes", "1", "да", "включено", "included"].includes(s);
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

function parsePositiveInt(value) {
  const n = Number.parseInt(String(value ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function inferPeopleCount(details) {
  const adt = parsePositiveInt(details.adt || details.adults || details.accommodationADT);
  const chd = parsePositiveInt(details.chd || details.children || details.accommodationCHD);
  const inf = parsePositiveInt(details.inf || details.infants || details.accommodationINF);
  const compositionCount = adt + chd + inf;
  if (compositionCount > 0) return compositionCount;

  const explicit = parsePositiveInt(
    pickFirst(
      details.peopleCount,
      details.persons,
      details.people,
      details.guests,
      details.pax,
      details.travellers,
      details.travelers,
      details.passengersCount
    )
  );
  if (explicit > 0) return explicit;

  const accommodation = String(
    pickFirst(details.accommodation, details.roomCategory, details.accommodationCategory, "") || ""
  ).toUpperCase();
  const adultMatches = accommodation.match(/\b(\d+)\s*(ADT|ADL|ADULT)\b/g) || [];
  const childMatches = accommodation.match(/\b(\d+)\s*(CHD|CHILD)\b/g) || [];
  const infantMatches = accommodation.match(/\b(\d+)\s*(INF|INFANT)\b/g) || [];
  const tokenCount = [...adultMatches, ...childMatches, ...infantMatches].reduce((sum, token) => {
    const n = parsePositiveInt(token);
    return sum + n;
  }, 0);
  if (tokenCount > 0) return tokenCount;

  if (/\bSGL\b/.test(accommodation)) return 1;
  if (/\bDBL\b|\bTWIN\b/.test(accommodation)) return 2;
  if (/\bTRPL\b/.test(accommodation)) return 3;
  return 0;
}

function calculatePerPersonPrice(details, formPrice) {
  const gross = parseMoneyValue(pickFirst(details.grossPrice, details.gross_price, details.price, formPrice));
  const people = inferPeopleCount(details);
  if (!gross || people <= 1) return null;
  return {
    amount: Math.round((gross / people) * 100) / 100,
    people,
  };
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

function ProofLightbox({ image, onClose }) {
  const closeButtonRef = useRef(null);
  useEffect(() => {
    if (!image) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [image]);
  if (!image) return null;

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="Просмотр подтверждения"
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
      className="fixed inset-0 z-[7000] bg-black/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-[95vw] max-h-[95vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-white text-black shadow-lg text-lg font-semibold"
          aria-label="Закрыть подтверждение"
          ref={closeButtonRef}
        >
          ×
        </button>
        <img
          src={image}
          alt=""
          className="max-w-[95vw] max-h-[95vh] object-contain rounded-2xl shadow-2xl bg-white"
        />
      </div>
    </div>,
    document.body
  );
}

function Card({
  item,
  tab,
  analysis,
  onEdit,
  onApprove,
  onReject,
  onRejectClick,
  onCorrectionClick,
  onUnpublish,
  onRebroadcast,
  actionBusy,
  t,
  onOpenProof,
  editorLoading,
  openingServiceId,
  focused,
}) {
  const s = item || {};
  const d = normalizeDetails(s.details);
  const images = normalizeImages(s.images);
  const publicImages = getPublicServiceImages(images, d);
  const proofImages = normalizeImages(d.proofImages);
  const hasProof = proofImages.length > 0;
  const cardAnalysis = analysis || analyzeModerationService(s);
  const issueKeys = new Set();
  const topIssues = [
    ...cardAnalysis.blockingIssues,
    ...cardAnalysis.missingRequired.map((item) => ({
      key: `missing-${item.key}`,
      title: `Нет: ${item.label}`,
      text: "",
      blocking: true,
    })),
    ...cardAnalysis.warningIssues,
  ].filter((issue) => {
    const semanticKey = String(issue?.key || "").replace(/^(no-|missing-)/, "");
    if (issueKeys.has(semanticKey)) return false;
    issueKeys.add(semanticKey);
    return true;
  }).slice(0, 4);
  const quickFixes = quickCorrectionOptions(cardAnalysis).slice(0, 5);

  const cover = publicImages[0] || "";

  const prov = providerFrom(s);
  const isRefused = isRefusedCategory(s.category);
  const isHotel = isRefusedHotelCategory(s.category);
  const createdAtLabel = formatDt(
    s.created_at ||
      s.createdAt ||
      s.submitted_at ||
      s.submittedAt ||
      s.updated_at ||
      s.updatedAt
  );

  const providerTypeLabel = (() => {
    const v = prov.type;
    if (!v) return "";
    const arr = Array.isArray(v)
      ? v
      : String(v).split(/[,\s|/]+/).filter(Boolean);
    return arr
      .map((k) => t(`provider.types.${k}`, { defaultValue: k }))
      .join(", ");
  })();

  const categoryLabel = s.category
    ? t(`service.categories.${s.category}`, {
        defaultValue: t(`service.types.${s.category}`, {
          defaultValue: t(s.category, { defaultValue: s.category }),
        }),
      })
    : "";

  const yesLabel = t("common.yes", { defaultValue: "Да" });
  const noLabel = t("common.no", { defaultValue: "Нет" });

  const displayTitle = pickFirst(
    s.title,
    d.title,
    d.hotel,
    d.eventName,
    d.ticketTitle,
    d.directionTo,
    t("moderation.no_title", { defaultValue: "(без названия)" })
  );

  const netPrice = pickFirst(d.netPrice, d.net_price, d.priceNet, d.price_net);
  const grossPrice = pickFirst(
    d.grossPrice,
    d.gross_price,
    d.price,
    s.price
  );
  const oldPrice = pickFirst(
    d.previousPrice,
    d.oldPrice,
    d.old_price,
    d.prevPrice
  );

  const dateFrom = isHotel
    ? pickFirst(d.checkIn, d.checkInDate, d.arrivalDate, d.startDate)
    : pickFirst(
        d.departureFlightDate,
        d.departureDate,
        d.startFlightDate,
        d.startDate,
        d.checkInDate,
        d.eventDate
      );

  const dateTo = isHotel
    ? pickFirst(d.checkOut, d.checkOutDate, d.departureDate, d.endDate)
    : pickFirst(
        d.returnFlightDate,
        d.endFlightDate,
        d.endDate,
        d.checkOutDate
      );

  const roomCategory = pickFirst(
    d.roomCategory,
    d.room_category,
    d.accommodationCategory,
    d.accommodation_category,
    d.category
  );

  const flightType = pickFirst(
    d.flightType,
    d.flight_type,
    d.tripType,
    d.trip_type
  );

  const prettyKeys = new Set([
    "title",
    "direction",
    "directionCountry",
    "directionFrom",
    "directionTo",
    "startDate",
    "endDate",
    "checkInDate",
    "checkOutDate",
    "eventDate",
    "hotel",
    "roomCategory",
    "room_category",
    "accommodation",
    "accommodationCategory",
    "accommodation_category",
    "food",
    "transfer",
    "changeable",
    "visaIncluded",
    "isActive",
    "expiration",
    "expiration_at",
    "expiration_ts",
    "departureFlightDate",
    "departureDate",
    "startFlightDate",
    "returnFlightDate",
    "endFlightDate",
    "flightType",
    "flight_type",
    "flightDetails",
    "flight_details",
    "flight_info",
    "netPrice",
    "net_price",
    "grossPrice",
    "gross_price",
    "previousPrice",
    "oldPrice",
    "old_price",
    "price",
    "image",
    "imageUrl",
    "cover",
    "coverImage",
    "photo",
    "photoUrl",
    "proofImages",
  ]);

  const hasExtraDetails =
    proofImages.length > 0 ||
    images.length > 0 ||
    d.directionCountry ||
    d.directionFrom ||
    d.directionTo ||
    dateFrom ||
    dateTo ||
    d.hotel ||
    roomCategory ||
    d.accommodation ||
    d.food ||
    d.transfer ||
    netPrice != null ||
    grossPrice != null ||
    oldPrice != null ||
    typeof d.changeable !== "undefined" ||
    typeof d.visaIncluded !== "undefined" ||
    typeof d.isActive !== "undefined" ||
    d.expiration ||
    d.expiration_at ||
    d.expiration_ts ||
    d.departureFlightDate ||
    d.departureDate ||
    d.startFlightDate ||
    d.returnFlightDate ||
    d.endFlightDate ||
    flightType ||
    d.flightDetails ||
    d.flight_details ||
    d.flight_info;
  const isPublishedTab = tab === "published";
  const telegramFailed = Number(s.telegram_failed_count || 0) > 0 &&
    String(s.last_moderation_action || "").toLowerCase() === "telegram_failed";
  const siteUrl = `https://travella.uz?service=${encodeURIComponent(s.id)}`;

  return (
    <div id={`moderation-service-${s.id}`} role="article" aria-label={`Услуга #${s.id}`} tabIndex={-1} className={`border rounded-lg p-4 bg-white shadow-sm flex flex-col relative outline-none ${focused ? "ring-2 ring-violet-400" : "focus:ring-2 focus:ring-violet-400"}`}>
      <div className="absolute top-3 right-3 z-10">
        {hasProof ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white text-[11px] font-semibold px-2.5 py-1 shadow">
            ✔ {t("moderation.proof_exists", { defaultValue: "Есть proof" })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-300 text-gray-800 text-[11px] font-semibold px-2.5 py-1">
            {t("moderation.proof_missing", { defaultValue: "Нет proof" })}
          </span>
        )}
      </div>

      <div className="flex gap-3 pr-24">
        <div className="w-24 h-16 bg-gray-100 rounded overflow-hidden shrink-0">
          {cover ? (
            <img src={cover} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] font-medium text-gray-500">
              Нет публичного фото
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">
            {isRefused ? `#${s.id} — ` : ""}
            {displayTitle}
          </div>

          <div className="text-xs text-gray-600">{categoryLabel}</div>

          {isRefused && createdAtLabel && (
            <div className="text-xs text-gray-500 mt-0.5">
              {t("moderation.created_at", { defaultValue: "Создан" })}:{" "}
              {createdAtLabel}
            </div>
          )}

          <div className="text-xs text-gray-600 mt-1">
            {t("moderation.supplier", { defaultValue: "Поставщик" })}:{" "}
            {prov.id ? (
              <Link
                to={`/profile/provider/${prov.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {prov.name}
              </Link>
            ) : (
              <span>{prov.name}</span>
            )}
            {providerTypeLabel ? ` (${providerTypeLabel})` : ""}
          </div>

          <div className="text-sm mt-1">
            {netPrice != null || grossPrice != null || oldPrice != null ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {netPrice != null && <span>Netto: {fmt(netPrice)}</span>}
                {grossPrice != null && <span>Gross: {fmt(grossPrice)}</span>}
                {oldPrice != null && <span>Old: {fmt(oldPrice)}</span>}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {s.description && (
        <div className="mt-3 text-sm text-gray-800 whitespace-pre-wrap">
          {s.description}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-700">
        {d.direction && (
          <div>
            {t("moderation.direction", { defaultValue: "Направление" })}:{" "}
            {d.direction}
          </div>
        )}
        {d.startDate && (
          <div>
            {t("moderation.start", { defaultValue: "Старт" })}: {d.startDate}
          </div>
        )}
        {d.endDate && (
          <div>
            {t("moderation.end", { defaultValue: "Конец" })}: {d.endDate}
          </div>
        )}
        {d.location && (
          <div>
            {t("moderation.location", { defaultValue: "Локация" })}:{" "}
            {d.location}
          </div>
        )}
        {d.eventName && (
          <div>
            {t("moderation.event", { defaultValue: "Событие" })}:{" "}
            {d.eventName}
          </div>
        )}
        {d.airline && (
          <div>
            {t("moderation.airline", { defaultValue: "Авиакомпания" })}:{" "}
            {d.airline}
          </div>
        )}
      </div>

      {proofImages.length > 0 && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs font-semibold text-emerald-700">
              {t("moderation.proof_images", {
                defaultValue: "Подтверждение подлинности",
              })}
            </div>
            <div className="text-[11px] text-emerald-700/80">
              {proofImages.length}{" "}
              {t("moderation.proof_count", { defaultValue: "фото" })}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {proofImages.slice(0, 6).map((img, idx) => (
              <button
                key={`${s.id}-proof-${idx}`}
                type="button"
                onClick={() => onOpenProof(img)}
                className="rounded-xl overflow-hidden border border-emerald-200 bg-white hover:opacity-90"
                title={t("moderation.open_proof", {
                  defaultValue: "Открыть подтверждение",
                })}
              >
                <img
                  src={img}
                  alt=""
                  className="w-24 h-20 object-cover bg-white"
                />
              </button>
            ))}

            {proofImages.length > 6 && (
              <div className="w-24 h-20 rounded-xl bg-emerald-700 text-white flex items-center justify-center text-sm font-semibold">
                +{proofImages.length - 6}
              </div>
            )}
          </div>
        </div>
      )}

      {hasExtraDetails && (
        <div className="mt-3 text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
          <div className="font-semibold mb-1">
            {t("moderation.details_block_title", {
              defaultValue: "Детали услуги",
            })}
          </div>

          {images.length > 0 && (
            <div className="mb-2">
              <div className="text-gray-500 mb-1">
                {t("moderation.photos", { defaultValue: "Фото" })}:
              </div>
              <div className="flex gap-2 flex-wrap">
                {images.slice(0, 6).map((img, idx) => (
                  <img
                    key={`${s.id}-img-${idx}`}
                    src={img}
                    alt=""
                    className="w-20 h-16 object-cover rounded border border-gray-200 bg-white"
                  />
                ))}
              </div>
            </div>
          )}

          {d.directionCountry && (
            <div>
              <span className="text-gray-500">
                {t("moderation.country", { defaultValue: "Страна" })}:{" "}
              </span>
              <span className="font-medium">{d.directionCountry}</span>
            </div>
          )}

          {(d.directionFrom || d.directionTo) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.route", { defaultValue: "Маршрут" })}:{" "}
              </span>
              <span className="font-medium">
                {d.directionFrom || "—"} → {d.directionTo || "—"}
              </span>
            </div>
          )}

          {(dateFrom || dateTo) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.dates", { defaultValue: "Даты" })}:{" "}
              </span>
              <span className="font-medium">
                {dateFrom || "—"} {dateTo && "→"} {dateTo || ""}
              </span>
            </div>
          )}

          {d.hotel && (
            <div>
              <span className="text-gray-500">
                {t("moderation.hotel", { defaultValue: "Отель" })}:{" "}
              </span>
              <span className="font-medium">{d.hotel}</span>
            </div>
          )}

          {roomCategory && (
            <div>
              <span className="text-gray-500">
                {t("moderation.room_category", {
                  defaultValue: "Категория номера",
                })}
                :{" "}
              </span>
              <span className="font-medium">{roomCategory}</span>
            </div>
          )}

          {d.accommodation && (
            <div>
              <span className="text-gray-500">
                {t("moderation.accommodation", {
                  defaultValue: "Размещение",
                })}
                :{" "}
              </span>
              <span className="font-medium">{d.accommodation}</span>
            </div>
          )}

          {d.food && (
            <div>
              <span className="text-gray-500">
                {t("moderation.food", { defaultValue: "Питание" })}:{" "}
              </span>
              <span className="font-medium">{d.food}</span>
            </div>
          )}

          {d.transfer && (
            <div>
              <span className="text-gray-500">
                {t("moderation.transfer", { defaultValue: "Трансфер" })}:{" "}
              </span>
              <span className="font-medium">{d.transfer}</span>
            </div>
          )}

          {(netPrice != null || grossPrice != null || oldPrice != null) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.prices", { defaultValue: "Цены" })}:{" "}
              </span>
              <span className="font-medium">
                {netPrice != null ? `Netto ${fmt(netPrice)}` : ""}
                {netPrice != null && grossPrice != null ? " / " : ""}
                {grossPrice != null ? `Gross ${fmt(grossPrice)}` : ""}
                {oldPrice != null ? ` / Old ${fmt(oldPrice)}` : ""}
              </span>
            </div>
          )}

          {typeof d.changeable !== "undefined" && (
            <div>
              <span className="text-gray-500">
                {t("moderation.changeable", {
                  defaultValue: "Можно вносить изменения",
                })}
                :{" "}
              </span>
              <span className="font-medium">
                {d.changeable ? yesLabel : noLabel}
              </span>
            </div>
          )}

          {typeof d.visaIncluded !== "undefined" && (
            <div>
              <span className="text-gray-500">
                {t("moderation.visa_included", {
                  defaultValue: "Виза включена",
                })}
                :{" "}
              </span>
              <span className="font-medium">
                {d.visaIncluded ? yesLabel : noLabel}
              </span>
            </div>
          )}

          {typeof d.isActive !== "undefined" && (
            <div>
              <span className="text-gray-500">
                {t("moderation.is_active", {
                  defaultValue: "Актуально",
                })}
                :{" "}
              </span>
              <span className="font-medium">
                {d.isActive ? yesLabel : noLabel}
              </span>
            </div>
          )}

          {(d.expiration || d.expiration_at || d.expiration_ts) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.expiration", {
                  defaultValue: "Таймер актуальности",
                })}
                :{" "}
              </span>
              <span className="font-medium">
                {pickFirst(d.expiration, d.expiration_at, d.expiration_ts)}
              </span>
            </div>
          )}

          {!isHotel && (d.departureFlightDate ||
            d.departureDate ||
            d.startFlightDate ||
            d.returnFlightDate ||
            d.endFlightDate) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.flight_dates", {
                  defaultValue: "Даты рейса",
                })}
                :{" "}
              </span>
              <span className="font-medium">
                {pickFirst(
                  d.departureFlightDate,
                  d.departureDate,
                  d.startFlightDate
                ) || "—"}{" "}
                {(d.returnFlightDate || d.endFlightDate) && "→"}{" "}
                {pickFirst(d.returnFlightDate, d.endFlightDate) || ""}
              </span>
            </div>
          )}

          {!isHotel && flightType && (
            <div>
              <span className="text-gray-500">
                {t("moderation.flight_type", {
                  defaultValue: "Тип перелёта",
                })}
                :{" "}
              </span>
              <span className="font-medium">{flightType}</span>
            </div>
          )}

          {!isHotel && (d.flightDetails || d.flight_details || d.flight_info) && (
            <div className="mt-1 rounded-md bg-white border border-gray-200 px-2 py-1.5 text-[11px] whitespace-pre-wrap leading-snug">
              <div className="font-semibold mb-1">
                {t("moderation.flight_details_title", {
                  defaultValue: "Детали рейса",
                })}
              </div>
              {String(
                d.flightDetails || d.flight_details || d.flight_info || ""
              ).replace(/\r\n/g, "\n")}
            </div>
          )}

          {Object.keys(d).some((k) => !prettyKeys.has(k) && !INTERNAL_DETAIL_KEYS.has(k)) && (
            <div className="mt-2 border-t border-gray-200 pt-1">
              <div className="text-[11px] font-semibold text-gray-500 mb-1">
                {t("moderation.other_fields", {
                  defaultValue: "Дополнительные параметры",
                })}
              </div>
              <div className="grid grid-cols-1 gap-1 text-[11px]">
                {Object.entries(d)
                  .filter(([key]) => !prettyKeys.has(key) && !INTERNAL_DETAIL_KEYS.has(key))
                  .slice(0, 10)
                  .map(([key, value]) => (
                    <div key={key} className="flex items-start justify-between gap-3 rounded-md bg-white px-2 py-1">
                      <div className="text-gray-500">
                        {detailLabel(key)}
                      </div>
                      <div className="max-w-[60%] break-words text-right font-medium">
                        {typeof value === "boolean"
                          ? value
                            ? yesLabel
                            : noLabel
                          : Array.isArray(value)
                          ? value.join(", ")
                          : typeof value === "object"
                          ? "Структурированные данные"
                          : String(value)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {s.rejected_reason && tab === "rejected" && (
        <div className="mt-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {t("moderation.rejected_reason", { defaultValue: "Причина" })}:{" "}
          {s.rejected_reason}
        </div>
      )}

      {s.last_moderation_action && (
        <div
          className={`mt-3 rounded-xl border p-2 text-xs ${
            cardAnalysis.hasCorrectionHistory
              ? "border-cyan-200 bg-cyan-50 text-cyan-800"
              : ["rejected","correction_requested"].includes(String(s.last_moderation_action).toLowerCase())
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold">
              {cardAnalysis.hasCorrectionHistory
                ? "Вернулась после исправления"
                : moderationActionLabel(s.last_moderation_action)}
            </span>
            {s.last_moderation_at && (
              <span className="opacity-75">{formatDt(s.last_moderation_at)}</span>
            )}
          </div>
          {s.last_moderation_reason_code && (
            <div className="mt-1 font-semibold">{s.last_moderation_reason_code}</div>
          )}
          {s.last_moderation_reason && (
            <div className="mt-1 max-h-10 overflow-hidden opacity-90">
              {s.last_moderation_reason}
            </div>
          )}
        </div>
      )}

      {isPublishedTab && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2">
            <div className="text-lg font-bold text-slate-950">{Number(s.views_count || 0)}</div>
            <div className="text-slate-500">просмотров</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2">
            <div className="text-lg font-bold text-emerald-800">{Number(s.contact_unlocks_count || 0)}</div>
            <div className="text-emerald-700">контактов</div>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-2 py-2">
            <div className="text-lg font-bold text-blue-800">{Number(s.quick_requests_count || 0)}</div>
            <div className="text-blue-700">заявок</div>
          </div>
        </div>
      )}

      {isPublishedTab && telegramFailed && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <div className="font-bold">Telegram отправка с ошибкой</div>
          <div className="mt-1 opacity-80">
            Нажмите “Повторить Telegram”, чтобы отправить карточку ещё раз.
          </div>
        </div>
      )}

      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Статус проверки
          </span>
          <span
            className={`rounded-full px-2 py-1 text-[11px] font-bold ${
              cardAnalysis.ready
                ? "bg-emerald-100 text-emerald-700"
                : "bg-rose-100 text-rose-700"
            }`}
          >
            {cardAnalysis.ready ? "Готово" : "Нужна правка"}
          </span>
        </div>
        {topIssues.length ? (
          <div className="flex flex-wrap gap-1.5">
            {topIssues.map((issue) => (
              <span
                key={issue.key}
                className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                  issue.blocking
                    ? "bg-rose-100 text-rose-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {issue.title}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-emerald-700">
            Обязательные поля заполнены, опасных ошибок нет.
          </div>
        )}
      </div>

      {tab === "pending" && quickFixes.length > 0 && (
        <div className="mt-3 rounded-xl border border-rose-100 bg-white p-2">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            Быстро запросить
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quickFixes.map((fix) => (
              <button
                key={fix.key}
                type="button"
                onClick={() =>
                  onCorrectionClick
                    ? onCorrectionClick(s, cardAnalysis, fix)
                    : onRejectClick
                    ? onRejectClick(s)
                    : onReject(s.id, fix.reason, fix.reasonCode)
                }
                disabled={actionBusy === s.id}
                className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {fix.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onEdit(s.id)}
          disabled={editorLoading}
          aria-busy={editorLoading && openingServiceId === s.id}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
        >
          {editorLoading && openingServiceId === s.id ? "Открываем…" : cardAnalysis.hasCorrectionHistory ? "Проверить повторно" : t("common.edit", { defaultValue: "Редактировать" })}
        </button>

        {!isPublishedTab && (
          <button
            type="button"
            onClick={() => onApprove(s.id)}
            disabled={actionBusy === s.id}
            className={`px-3 py-1.5 rounded text-sm disabled:opacity-60 ${
              cardAnalysis.ready
                ? "bg-emerald-600 text-white font-bold shadow-sm hover:bg-emerald-700"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
            }`}
          >
            {actionBusy === s.id
              ? t("common.saving", { defaultValue: "Сохранение..." })
              : tab === "rejected"
              ? t("moderation.confirm", { defaultValue: "Подтвердить" })
              : cardAnalysis.ready
              ? "Опубликовать"
              : "Опубликовать после проверки"}
          </button>
        )}

        {isPublishedTab && (
          <>
            <a
              href={siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded bg-slate-900 text-white text-sm hover:bg-black"
            >
              Открыть на сайте
            </a>
            <button
              type="button"
              onClick={() => onRebroadcast(s)}
              disabled={actionBusy === `rebroadcast:${s.id}`}
              className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
            >
              {actionBusy === `rebroadcast:${s.id}` ? "Отправляем..." : "Повторить Telegram"}
            </button>
          </>
        )}

        {tab === "pending" && (
          <button
            type="button"
            onClick={() =>
              onCorrectionClick
                ? onCorrectionClick(s, cardAnalysis)
                : onRejectClick
                ? onRejectClick(s)
                : onReject(s.id, "Нужно исправить данные услуги")
            }
            disabled={actionBusy === s.id}
            className="px-3 py-1.5 rounded bg-rose-600 text-white text-sm hover:bg-rose-700 disabled:opacity-60"
          >
            Запросить исправление
          </button>
        )}

        {item.status === "published" && (
          <button
            type="button"
            onClick={() => onUnpublish(s.id)}
            disabled={actionBusy === s.id}
            className="px-3 py-1.5 rounded bg-gray-200 text-gray-800 text-sm hover:bg-gray-300 disabled:opacity-60"
          >
            {t("moderation.unpublish", { defaultValue: "Unpublish" })}
          </button>
        )}
      </div>
    </div>
  );
}

function collectEditorImages(images, draft) {
  const urls = String(draft || "").split(/\r?\n|,/).map((url) => url.trim()).filter(Boolean);
  const invalid = urls.find((url) => !/^https?:\/\/\S+$/i.test(url));
  if (invalid) throw new Error(`Некорректная ссылка: ${invalid}`);
  const result = [...new Set([...(Array.isArray(images) ? images : []), ...urls])];
  if (result.length > 20) throw new Error("Для одной услуги можно добавить не более 20 изображений.");
  return result;
}

function EditSection({ title, children, id }) {
  return (
    <div id={id} className="min-w-0 scroll-mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-semibold text-gray-900">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder = "", textarea = false, rows = 2, error }) {
  const fieldId = useId();
  const commonProps = {
    id: fieldId,
    "aria-label": label,
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? `${fieldId}-error` : undefined,
    value,
    onChange: (e) => onChange(e.target.value),
    placeholder,
    className: "min-w-0 w-full border rounded-lg px-3 py-2 text-sm bg-white",
  };

  return (
    <label className="block min-w-0">
      <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
        {label}
      </span>
      {textarea ? <textarea {...commonProps} rows={rows} /> : <input {...commonProps} type="text" />}
      {error && <span id={`${fieldId}-error`} role="alert" className="mt-1 block text-xs font-medium text-rose-700">{error}</span>}
    </label>
  );
}

function ToggleChip({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
        active
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
      }`}
    >
      {active ? "✓ " : "+ "}
      {label}
    </button>
  );
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
    ["rejected","correction_requested"].includes(String(svc.last_moderation_action || "").toLowerCase()) &&
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

function moderationActionLabel(action) {
  const normalized = String(action || "").toLowerCase();
  if (normalized === "approved_clean") return "Одобрено без предупреждений";
  if (normalized === "approved_with_warnings") return "Одобрено с предупреждениями";
  if (normalized === "telegram_sent") return "Telegram отправлен";
  if (normalized === "telegram_failed") return "Telegram не отправлен";
  if (normalized === "approved") return "Одобрено";
  if (["rejected","correction_requested"].includes(normalized)) return "Запрошено исправление";
  if (normalized === "unpublished") return "Снято";
  return action || "";
}

function quickCorrectionOptions(analysis) {
  const hasIssue = (key) =>
    analysis.dangerIssues.some((issue) => issue.key === key) ||
    analysis.missingRequired.some((item) => item.key === key);
  const options = [];

  if (hasIssue("no-proof")) {
    options.push({
      key: "no-proof",
      label: "Нет proof",
      reasonCode: "NO_PROOF",
      reason:
        "Пожалуйста, загрузите proof/подтверждение подлинности предложения: фото брони, скрин отеля/авиа/поставщика или другой документ. После этого отправьте карточку на модерацию повторно.",
    });
  }

  if (hasIssue("no-photo") || hasIssue("photo")) {
    options.push({
      key: "no-photo",
      label: "Нет фото",
      reasonCode: "MISSING_DETAILS",
      reason:
        "Пожалуйста, добавьте фото для карточки. Без фото предложение хуже выглядит в канале и на сайте. После добавления отправьте карточку на модерацию повторно.",
    });
  }

  if (hasIssue("no-contact") || hasIssue("contact")) {
    options.push({
      key: "no-contact",
      label: "Нет контакта",
      reasonCode: "MISSING_DETAILS",
      reason:
        "Пожалуйста, укажите Telegram контакт поставщика. Клиент должен понимать, с кем связаться по этому предложению. После исправления отправьте карточку на модерацию повторно.",
    });
  }

  if (hasIssue("gross-below-net") || hasIssue("price")) {
    options.push({
      key: "bad-price",
      label: "Плохая цена",
      reasonCode: "BAD_PRICE",
      reason:
        "Пожалуйста, проверьте цену. Укажите корректные Netto/Gross и обязательно уточните, цена указана за 1 человека/билет или за весь пакет. После исправления отправьте карточку на модерацию повторно.",
    });
  }

  if (hasIssue("past-date") || hasIssue("date")) {
    options.push({
      key: "bad-date",
      label: "Даты прошли",
      reasonCode: "NO_DATES",
      reason:
        "Пожалуйста, проверьте даты предложения: дата начала/вылета/заезда не должна быть в прошлом. После исправления отправьте карточку на модерацию повторно.",
    });
  }

  return options;
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

function QueuePanel({ items, filter, onFilterChange, metricsOverride, query, onQueryChange, sort, onSortChange }) {
  const metrics = metricsOverride || getQueueMetrics(items);
  const filters = [
    { key: "all", label: "Все", count: metrics.total, tone: "slate" },
    { key: "ready", label: "Готовы", count: metrics.ready, tone: "emerald" },
    { key: "needFix", label: "Нужно исправить", count: metrics.needFix, tone: "rose" },
    { key: "afterCorrection", label: "После исправления", count: metrics.afterCorrection, tone: "cyan" },
    { key: "no-proof", label: "Нет proof", count: metrics.noProof, tone: "amber" },
    { key: "no-photo", label: "Нет фото", count: metrics.noPhoto, tone: "violet" },
    { key: "no-contact", label: "Нет контакта", count: metrics.noContact, tone: "pink" },
    { key: "gross-below-net", label: "Цена", count: metrics.badPrice, tone: "orange" },
    { key: "past-date", label: "Даты прошли", count: metrics.pastDate, tone: "blue" },
  ];
  const toneClass = {
    slate: "border-slate-200 bg-slate-50 text-slate-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    violet: "border-violet-200 bg-violet-50 text-violet-800",
    pink: "border-pink-200 bg-pink-50 text-pink-800",
    orange: "border-orange-200 bg-orange-50 text-orange-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    cyan: "border-cyan-200 bg-cyan-50 text-cyan-800",
  };

  return (
    <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Рабочая очередь
          </div>
          <div className="text-lg font-semibold text-slate-950">
            Сначала карточки с ошибками, потом готовые к публикации
          </div>
        </div>
        <div className="text-sm text-slate-500">
          {metrics.ready} готовы · {metrics.needFix} требуют правки
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]"><input type="search" aria-label="Поиск услуг" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Поиск: #ID, отель, поставщик…" className="min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm" /><select aria-label="Сортировка услуг" value={sort} onChange={(event) => onSortChange(event.target.value)} className="min-w-0 rounded-xl border border-slate-200 px-3 py-2 text-sm"><option value="priority">Сначала проблемные</option><option value="newest">Сначала новые</option></select></div>
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2">
        {filters.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onFilterChange(item.key)}
            className={`rounded-2xl border px-3 py-3 text-left transition ${
              filter === item.key
                ? "border-slate-950 bg-slate-950 text-white"
                : toneClass[item.tone]
            }`}
          >
            <div className="text-2xl font-bold leading-none">{item.count}</div>
            <div className="mt-1 text-xs font-semibold leading-tight">{item.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
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

function publishedSearchText(svc = {}) {
  const details = normalizeDetails(svc.details);
  const provider = providerFrom(svc);
  return [
    svc.id,
    svc.title,
    svc.description,
    svc.category,
    provider.name,
    details.title,
    details.direction,
    details.directionCountry,
    details.directionFrom,
    details.directionTo,
    details.hotel,
    details.eventName,
    details.location,
    details.accommodation,
    details.roomCategory,
  ]
    .filter((x) => x !== null && typeof x !== "undefined")
    .join(" ")
    .toLowerCase();
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

function PublishedControls({
  items,
  metricsOverride,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  sort,
  onSortChange,
}) {
  const metrics = metricsOverride || getPublishedMetrics(items);
  const filters = [
    { key: "all", label: "Все", count: metrics.total },
    { key: "telegramFailed", label: "Telegram ошибка", count: metrics.telegramFailed },
    { key: "noUnlocks", label: "Нет контактов", count: metrics.noUnlocks },
    { key: "noRequests", label: "Нет заявок", count: metrics.noRequests },
    { key: "hasRequests", label: "Есть заявки", count: metrics.hasRequests },
  ];

  return (
    <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Контроль опубликованных
          </div>
          <div className="text-lg font-semibold text-slate-950">
            Поиск проблемных карточек после публикации
          </div>
        </div>
        <div className="text-sm text-slate-500">
          {metrics.views} просмотров · {metrics.unlocks} контактов · {metrics.requests} заявок
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_220px]">
        <input
          type="search"
          aria-label="Поиск услуг"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm"
          placeholder="Поиск: #ID, направление, отель, поставщик..."
        />
        <select
          aria-label="Сортировка услуг"
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-4 py-2 text-sm"
        >
          <option value="newest">Сначала новые</option>
          <option value="problems">Проблемные сверху</option>
          <option value="views">Много просмотров</option>
          <option value="unlocks">Много открытий</option>
          <option value="requests">Много заявок</option>
        </select>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onFilterChange(item.key)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
              filter === item.key
                ? "border-slate-950 bg-slate-950 text-white"
                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
            }`}
          >
            {item.label} · {item.count}
          </button>
        ))}
      </div>
    </div>
  );
}

function DangerIssuesPanel({ issues, onAddPublicPhoto }) {
  if (!issues.length) {
    return (
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
        <b>Опасных ошибок нет.</b> Можно переходить к публикации после проверки текста.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
      <div className="text-sm font-bold text-rose-900">Опасные ошибки</div>
      <div className="mt-1 text-xs text-rose-700">
        Красные пункты блокируют “Сохранить и опубликовать”.
      </div>
      <div className="mt-3 space-y-2">
        {issues.map((issue) => (
          <div
            key={issue.key}
            className={`rounded-xl border px-3 py-2 text-sm ${
              issue.blocking
                ? "border-rose-200 bg-white text-rose-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
          >
            <div className="font-bold">
              {issue.blocking ? "!" : "?"} {issue.title}
            </div>
            <div className="mt-0.5 text-xs opacity-80">{issue.text}</div>
            {issue.key === "no-photo" && onAddPublicPhoto && (
              <button type="button" onClick={onAddPublicPhoto} className="mt-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-black">Добавить фото карточки</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function buildCorrectionReason(readinessItems, dangerIssues) {
  const missingRequired = readinessItems
    .filter((item) => item.required && !item.ok)
    .map((item) => item.label.toLowerCase());
  const lines = ["Пожалуйста, исправьте карточку и отправьте её на модерацию повторно."];

  if (missingRequired.length) {
    lines.push(`Заполните обязательные поля: ${missingRequired.join(", ")}.`);
  }

  for (const issue of dangerIssues) {
    if (issue.key === "gross-below-net") {
      lines.push("Проверьте цену: Gross не должен быть ниже Netto.");
    } else if (issue.key === "past-date") {
      lines.push("Проверьте даты: дата начала уже прошла.");
    } else if (issue.key === "no-contact") {
      lines.push("Укажите Telegram контакт поставщика, чтобы клиент мог связаться.");
    } else if (issue.key === "no-photo") {
      lines.push("Добавьте фото для карточки.");
    } else if (issue.key === "no-proof") {
      lines.push("Добавьте proof/подтверждение подлинности предложения.");
    }
  }

  if (lines.length === 1) {
    lines.push("Уточните данные предложения: цену, даты, фото и подтверждение подлинности.");
  }

  return Array.from(new Set(lines)).join("\n");
}

function selectedCorrectionCodes(readinessItems, dangerIssues) {
  const codes = [];
  const keys = new Set(dangerIssues.map(i=>i.key));
  if(keys.has("no-proof")) codes.push("NO_PROOF");
  if(keys.has("gross-below-net")) codes.push("BAD_PRICE");
  if(keys.has("past-date") || readinessItems.some(i=>i.key==="date" && !i.ok)) codes.push("NO_DATES");
  if(keys.has("no-photo")) codes.push("NO_PHOTO");
  if(keys.has("no-contact") || readinessItems.some(i=>i.required && !i.ok && !["date","photo","price"].includes(i.key))) codes.push("MISSING_DETAILS");
  return [...new Set(codes.length?codes:["OTHER"])];
}

function correctionReasonCode(readinessItems, dangerIssues) {
  if (dangerIssues.some((issue) => issue.key === "no-proof")) return "NO_PROOF";
  if (dangerIssues.some((issue) => issue.key === "gross-below-net")) return "BAD_PRICE";
  if (
    dangerIssues.some((issue) => issue.key === "past-date") ||
    readinessItems.some((item) => item.key === "date" && item.required && !item.ok)
  ) {
    return "NO_DATES";
  }
  if (dangerIssues.some((issue) => issue.key === "no-photo")) return "MISSING_DETAILS";
  if (dangerIssues.some((issue) => issue.key === "no-contact")) return "MISSING_DETAILS";
  return "OTHER";
}

function ReadinessChecklist({ items }) {
  const required = items.filter((item) => item.required);
  const ready = required.every((item) => item.ok);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Готовность к публикации</div>
          <div className="text-xs text-slate-500">
            {ready ? "Можно публиковать" : "Перед публикацией заполните красные пункты"}
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            ready ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          {required.filter((item) => item.ok).length}/{required.length}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((item) => (
          <div
            key={item.key}
            className={`rounded-xl border px-3 py-2 text-sm ${
              item.ok
                ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                : item.required
                ? "border-rose-100 bg-rose-50 text-rose-800"
                : "border-amber-100 bg-amber-50 text-amber-800"
            }`}
          >
            <span className="font-bold">{item.ok ? "✓" : item.required ? "!" : "?"}</span>{" "}
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function buildTelegramPreview(serviceId, form, details, images) {
  const isHotel = isRefusedHotelCategory(form.category);
  const title = pickFirst(
    form.title,
    details.title,
    details.hotel,
    details.eventName,
    details.ticketTitle,
    details.directionTo,
    "Без названия"
  );
  const direction = pickFirst(
    details.direction,
    details.directionTo,
    details.directionCountry,
    details.location
  );
  const from = pickFirst(details.directionFrom, details.fromCity, details.departureCity);
  const hotel = pickFirst(details.hotel, details.eventName, details.accommodation);
  const room = pickFirst(details.roomCategory, details.accommodationCategory, details.accommodation);
  const dateFrom = isHotel
    ? pickFirst(details.checkIn, details.checkInDate, details.arrivalDate, details.startDate)
    : pickFirst(
        details.departureFlightDate,
        details.departureDate,
        details.startFlightDate,
        details.startDate,
        details.checkInDate,
        details.eventDate
      );
  const dateTo = isHotel
    ? pickFirst(details.checkOut, details.checkOutDate, details.departureDate, details.endDate)
    : pickFirst(
        details.returnFlightDate,
        details.endFlightDate,
        details.endDate,
        details.checkOutDate
      );
  const nights = pickFirst(details.nights, details.nightsCount) || calcNights(dateFrom, dateTo);
  const grossPrice = pickFirst(details.grossPrice, details.gross_price, details.price, form.price);
  const netPrice = pickFirst(details.netPrice, details.net_price, details.priceNet, details.price_net);
  const priceFor = pickFirst(details.priceFor, details.pricePer, details.priceType);
  const guestsCount = isHotel ? hotelGuestCount(details) : 0;
  const grossPriceNumber = parseMoneyNumber(grossPrice);
  const computedPerPerson = isHotel && guestsCount > 1 && grossPriceNumber
    ? `${fmt(grossPriceNumber / guestsCount)} USD`
    : "";
  const perPerson = pickFirst(details.pricePerPerson, computedPerPerson);
  const isRefused = form.category?.includes("refused") || yesNoValue(details.isRefused);
  const proofImages = normalizeImages(details.proofImages);
  const photos = getPublicServiceImages(images, details);
  const hasPhoto = photos.length > 0;
  const included = [
    !isHotel && yesNoValue(details.flightIncluded || details.airTickets || details.aviaTickets) ? "авиабилеты" : null,
    !isHotel && hotel ? "проживание" : null,
    details.food ? `питание ${details.food}` : null,
    yesNoValue(details.transferIncluded || details.hasTransfer || details.transfer) ? "трансфер" : null,
    yesNoValue(details.insurance || details.insuranceIncluded) ? "страховка" : null,
    !isHotel && yesNoValue(details.visa || details.visaIncluded) ? "виза" : null,
  ].filter(Boolean);
  const flightDetails = isHotel ? "" : pickFirst(details.flightDetails, details.flight_details, details.flight_info);
  const providerName = pickFirst(form.provider_name, details.providerName, details.supplierName);
  const contactVisible = hasText(pickFirst(form.telegram_refused_chat_id, form.telegram_web_chat_id, form.telegram_chat_id));

  const hotelLines = isHotel ? [
    "через @OTKAZNYX_TUROV_UZB_BOT",
    `🏨 ОТКАЗНОЙ ОТЕЛЬ #${serviceId || ""}`.trim(),
    `📝 ${title}`,
    direction ? `📍 ${direction}` : null,
    hotel ? `🏨 ${hotel}` : null,
    dateFrom ? `🟢 Заезд: ${dateFrom}` : null,
    dateTo ? `🔴 Выезд: ${dateTo}` : null,
    nights ? `🌙 Ночей: ${nights}` : null,
    room ? `🛏 Номер: ${room}` : null,
    details.accommodation ? `👥 Размещение: ${details.accommodation}` : null,
    details.food ? `🍽 Питание: ${details.food}` : null,
    grossPrice ? `💵 ${fmt(grossPrice)} USD за номер / весь период` : null,
    perPerson ? `👤 за 1 человека: ${perPerson}` : null,
    netPrice ? `Netto: ${fmt(netPrice)} USD` : null,
    included.length ? ["", "✅ Дополнительно:", ...included.map((item) => `• ${item}`)].join("\n") : null,
    "",
    `🔥 отказной отель · ${
      pickFirst(details.expiration, details.expiration_at, details.expiration_ts) ? "⚡ срочно" : "⏳ срок не указан"
    }`,
    "",
    contactVisible
      ? providerName
        ? `🤝 ${providerName}`
        : "🤝 Контакт поставщика будет доступен"
      : "🔒 Контакты откроются после оплаты.",
    hasPhoto ? null : "⚠️ Фото не прикреплено.",
    proofImages.length ? null : "⚠️ Proof не прикреплён.",
  ].filter((line) => line !== null && typeof line !== "undefined") : null;

  const lines = hotelLines || [
    "через @OTKAZNYX_TUROV_UZB_BOT",
    `📍 ${isRefused ? "ОТКАЗНОЙ ТУР" : "УСЛУГА"} #${serviceId || ""}`.trim(),
    `📝 ${title}`,
    direction ? `🌎 ${direction}` : null,
    from ? `🛫 Вылет из: ${from}` : null,
    hotel ? `🏨 ${hotel}` : null,
    (dateFrom || dateTo || nights || room)
      ? `📅 ${dateFrom || "—"}${dateTo ? ` → ${dateTo}` : ""}${nights ? ` · ${nights} ноч.` : ""}${room ? ` · ${room}` : ""}`
      : null,
    grossPrice ? `💵 ${fmt(grossPrice)} USD${priceFor ? ` ${priceFor}` : ""}` : null,
    perPerson ? `👤 за 1 человека: ${perPerson}` : null,
    netPrice ? `Netto: ${fmt(netPrice)} USD` : null,
    included.length ? ["", "✅ Включено:", ...included.map((item) => `• ${item}`)].join("\n") : null,
    flightDetails ? ["", "ℹ️ Детали рейса:", String(flightDetails)].join("\n") : null,
    "",
    `${isRefused ? "🔥 отказное" : "🧾 обычная услуга"} · ${
      pickFirst(details.expiration, details.expiration_at, details.expiration_ts) ? "⚡ срочно" : "⏳ срок не указан"
    }`,
    "",
    contactVisible
      ? providerName
        ? `🤝 ${providerName}`
        : "🤝 Контакт поставщика будет доступен"
      : "🔒 Контакты откроются после оплаты.",
    hasPhoto ? null : "⚠️ Фото не прикреплено.",
    proofImages.length ? null : "⚠️ Proof не прикреплён.",
  ].filter((line) => line !== null && typeof line !== "undefined");

  return {
    text: lines.join("\n"),
    buttons: [
      "💬 Связаться с поставщиком",
      "🌐 Подробнее на сайте",
      !isHotel && flightDetails ? "✈️ Детали рейса" : null,
    ].filter(Boolean),
  };
}

function TelegramPreviewModal({ serviceId, form, details, images, onClose, onPublish, publishDisabled, saving }) {
  const preview = buildTelegramPreview(serviceId, form, details, images);

  return createPortal(
    <div className="fixed inset-0 z-[5400] bg-black/65 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <div className="text-lg font-semibold">Предпросмотр Telegram</div>
            <div className="text-sm text-gray-500">Так будет выглядеть текст перед публикацией.</div>
          </div>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-black">
            ×
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 bg-slate-100">
          <div className="rounded-3xl bg-[#e9ffd9] p-4 shadow-sm">
            <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-black">
              {preview.text}
            </pre>
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-wide text-gray-500">Кнопки под постом</div>
              <div className="mt-3 space-y-2">
                {preview.buttons.map((button) => (
                  <div key={button} className="rounded-xl bg-slate-200 px-3 py-2 text-center text-sm font-semibold text-slate-800">
                    {button}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-4 text-xs text-gray-600 shadow-sm">
              Это фронтенд-предпросмотр из текущих полей. Он нужен, чтобы поймать явные ошибки до публикации.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200">
            Вернуться к правке
          </button>
          <button
            type="button"
            onClick={onPublish}
            disabled={publishDisabled || saving}
            className="col-span-2 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? "Сохранение..." : "Сохранить и опубликовать"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ModerationPreview({ serviceId, form, details, images }) {
  const isHotel = isRefusedHotelCategory(form.category);
  const title = pickFirst(
    form.title,
    details.title,
    details.hotel,
    details.eventName,
    details.ticketTitle,
    details.directionTo,
    "Без названия"
  );
  const direction = pickFirst(
    details.direction,
    details.directionTo,
    details.directionCountry,
    details.location
  );
  const hotel = pickFirst(details.hotel, details.eventName, details.accommodation);
  const dateFrom = isHotel
    ? pickFirst(details.checkIn, details.checkInDate, details.arrivalDate, details.startDate)
    : pickFirst(
        details.departureFlightDate,
        details.departureDate,
        details.startFlightDate,
        details.startDate,
        details.checkInDate,
        details.eventDate
      );
  const dateTo = isHotel
    ? pickFirst(details.checkOut, details.checkOutDate, details.departureDate, details.endDate)
    : pickFirst(
        details.returnFlightDate,
        details.endFlightDate,
        details.endDate,
        details.checkOutDate
      );
  const nights = pickFirst(details.nights, details.nightsCount) || calcNights(dateFrom, dateTo);
  const room = pickFirst(details.roomCategory, details.accommodationCategory, details.room, details.roomType);
  const grossPrice = pickFirst(details.grossPrice, details.gross_price, details.price, form.price);
  const netPrice = pickFirst(details.netPrice, details.net_price, details.priceNet, details.price_net);
  const proofImages = normalizeImages(details.proofImages);
  const cover = getPublicServiceImages(images, details)[0] || "";
  const included = [
    !isHotel && (details.flightIncluded || details.airTickets || details.aviaTickets) ? "авиабилеты" : null,
    !isHotel && (details.accommodation || details.hotel) ? "проживание" : null,
    details.food ? `питание ${details.food}` : null,
    details.transfer ? "трансфер" : null,
    details.insurance ? "страховка" : null,
    !isHotel && details.visaIncluded ? "виза" : null,
  ].filter(Boolean);
  const isRefused = form.category?.includes("refused") || yesNoValue(details.isRefused);
  const priceAudience = pickFirst(details.priceFor, details.pricePer, details.priceType);
  const guestsCount = isHotel ? hotelGuestCount(details) : 0;
  const grossPriceNumber = parseMoneyNumber(grossPrice);
  const hotelPerPerson = isHotel && guestsCount > 1 && grossPriceNumber
    ? `${fmt(grossPriceNumber / guestsCount)} USD`
    : "";
  const urgencyBadge = getServiceUrgency(
    pickFirst(details.expiration, details.expiration_at, details.expiration_ts)
  ).badge;

  return (
    <div className="sticky top-4 rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white shadow-xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Live preview</div>
          <div className="text-sm font-semibold">Как карточка будет читаться</div>
        </div>
        <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs">#{serviceId || "new"}</span>
      </div>

      <div className="overflow-hidden rounded-2xl bg-[#e9ffd9] text-black">
        {cover && <img src={cover} alt="" className="h-44 w-full object-cover bg-white" />}
        <div className="space-y-2 p-4 text-sm leading-snug">
          <div className="text-xs text-emerald-700">через @OTKAZNYX_TUROV_UZB_BOT</div>
          <div className="font-bold">
            {isHotel ? "🏨 ОТКАЗНОЙ ОТЕЛЬ" : `📍 ${isRefused ? "ОТКАЗНОЙ ТУР" : "УСЛУГА"}`} #{serviceId}
          </div>
          <div className="font-semibold">📝 {title}</div>
          {direction && <div>🌎 {direction}</div>}
          {!isHotel && details.directionFrom && <div>🛫 Вылет из: <b>{details.directionFrom}</b></div>}
          {hotel && <div>🏨 {hotel}</div>}
          {isHotel ? (
            <>
              {dateFrom && <div>🟢 Заезд: {dateFrom}</div>}
              {dateTo && <div>🔴 Выезд: {dateTo}</div>}
              {nights && <div>🌙 Ночей: {nights}</div>}
              {room && <div>🛏 Номер: {room}</div>}
              {details.accommodation && <div>👥 Размещение: {details.accommodation}</div>}
              {details.food && <div>🍽 Питание: {details.food}</div>}
            </>
          ) : (
            (dateFrom || dateTo) && (
              <div>
                📅 {dateFrom || "—"} {dateTo ? `→ ${dateTo}` : ""}
              </div>
            )
          )}
          {grossPrice && (
            <div>
              💵 <b>{fmt(grossPrice)} USD</b>
              {isHotel ? (
                <span className="text-xs"> · за номер / весь период</span>
              ) : priceAudience ? (
                <span className="text-xs"> · {priceAudience}</span>
              ) : null}
              {netPrice ? <span className="text-xs"> · Netto {fmt(netPrice)}</span> : null}
            </div>
          )}
          {(details.pricePerPerson || hotelPerPerson) && (
            <div>👤 за 1 человека: {pickFirst(details.pricePerPerson, hotelPerPerson)}</div>
          )}
          {included.length > 0 && (
            <div className="pt-2">
              <div className="font-semibold">{isHotel ? "✅ Дополнительно:" : "✅ Включено:"}</div>
              {included.map((x) => (
                <div key={x}>• {x}</div>
              ))}
            </div>
          )}
          <div className="pt-2">
            {isRefused ? "🔥 отказное" : "🧾 обычная услуга"} · {urgencyBadge}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className={`rounded-xl px-3 py-2 ${title === "Без названия" ? "bg-rose-500/20 text-rose-100" : "bg-emerald-500/20 text-emerald-100"}`}>
          Название
        </div>
        <div className={`rounded-xl px-3 py-2 ${grossPrice ? "bg-emerald-500/20 text-emerald-100" : "bg-rose-500/20 text-rose-100"}`}>
          Цена
        </div>
        <div className={`rounded-xl px-3 py-2 ${dateFrom ? "bg-emerald-500/20 text-emerald-100" : "bg-amber-500/20 text-amber-100"}`}>
          Даты
        </div>
        <div className={`rounded-xl px-3 py-2 ${cover ? "bg-emerald-500/20 text-emerald-100" : "bg-amber-500/20 text-amber-100"}`}>
          Фото
        </div>
      </div>
    </div>
  );
}

function PublishConfirmModal({
  target,
  warnings = [],
  clean = false,
  saving = false,
  onCancel,
  onConfirm,
}) {
  if (!target) return null;
  const hasWarnings = warnings.length > 0;

  return createPortal(
    <div className="fixed inset-0 z-[5600] bg-black/65 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
        <div className="border-b px-5 py-4">
          <div className="text-lg font-bold text-slate-950">
            {hasWarnings ? "Публикация с предупреждениями" : "Подтвердить публикацию"}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            #{target.id} · {target.title || target.category || "service"}
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div
            className={`rounded-2xl border p-4 text-sm ${
              hasWarnings
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            <div className="font-bold">
              {hasWarnings
                ? "Карточка не идеальная. Проверьте риски перед публикацией."
                : "Карточка готова: обязательные поля заполнены, блокирующих рисков нет."}
            </div>
            {clean && (
              <div className="mt-1 text-xs opacity-80">
                В историю уйдёт метка approved_clean.
              </div>
            )}
          </div>

          {hasWarnings && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-bold text-slate-900">Что проверить</div>
              <div className="mt-3 space-y-2">
                {warnings.map((warning) => (
                  <div
                    key={warning}
                    className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900"
                  >
                    {warning}
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-slate-500">
                Если всё равно публикуете, в историю уйдёт метка approved_with_warnings.
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-200 disabled:opacity-60"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-60 ${
              hasWarnings ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {saving
              ? "Публикуем..."
              : hasWarnings
              ? "Всё равно опубликовать"
              : "Опубликовать"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function PublishResultModal({ result, saving = false, onClose, onRetry, nextServiceId }) {
  if (!result) return null;
  const broadcast = result.broadcast || {};
  const ok = Boolean(broadcast.ok);
  const recipients = Number(broadcast.recipients || 0);
  const delivered = Number(broadcast.delivered || 0);
  const failed = Number(broadcast.failed || 0);

  return createPortal(
    <div className="fixed inset-0 z-[5700] bg-black/65 flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
        <div className="border-b px-5 py-4">
          <div className="text-lg font-bold text-slate-950">Результат публикации</div>
          <div className="mt-1 text-sm text-slate-500">
            #{result.service?.id || result.serviceId} · {result.service?.title || "service"}
          </div>
        </div>

        <div className="space-y-3 p-5">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <div className="font-bold">Сайт: опубликовано</div>
            <div className="mt-1 text-xs opacity-80">Карточка approved/published и доступна на сайте после обновления выдачи.</div>
          </div>

          <div
            className={`rounded-2xl border p-4 text-sm ${
              ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"
            }`}
          >
            <div className="font-bold">
              Telegram: {ok ? "отправлено" : "не отправлено"}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/80 px-2 py-2">
                <div className="text-lg font-bold">{recipients}</div>
                <div className="text-[11px]">получателей</div>
              </div>
              <div className="rounded-xl bg-white/80 px-2 py-2">
                <div className="text-lg font-bold">{delivered}</div>
                <div className="text-[11px]">доставлено</div>
              </div>
              <div className="rounded-xl bg-white/80 px-2 py-2">
                <div className="text-lg font-bold">{failed}</div>
                <div className="text-[11px]">ошибок</div>
              </div>
            </div>
            {!ok && (
              <div className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-xs">
                Причина: {broadcast.reason || broadcast.error || "unknown"}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-200 disabled:opacity-60"
          >
            {nextServiceId ? "Следующая услуга" : "Закрыть"}
          </button>
          {!ok && (
            <button
              type="button"
              onClick={onRetry}
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
            >
              {saving ? "Отправляем..." : "Повторить Telegram"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function AdminModeration({ embedded = false }) {
  const { t } = useTranslation();

  const [searchParams, setSearchParams] = useSearchParams();
  const queueLocation = readQueueLocation(searchParams);
  const tab = queueLocation.status;
  const queueKey = queueRequestKey(queueLocation);
  const queueLocationRef = useRef(queueLocation);
  queueLocationRef.current = queueLocation;
  const pendingLocateRef = useRef(queueLocation.focus);
  const [loadedQueueKey, setLoadedQueueKey] = useState("");
  const loadedKeyRef = useRef("");
  const queueRunnerRef = useRef(null);
  const queueFetchRef = useRef(null);
  const [queueError, setQueueError] = useState("");
  const [queueMeta, setQueueMeta] = useState(null);
  const [countsLoaded, setCountsLoaded] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [nextAfterPublish, setNextAfterPublish] = useState(null);
  const [returnNotice, setReturnNotice] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ pending: 0, rejected: 0, published: 0 });
  const [proofViewer, setProofViewer] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectForm, setRejectForm] = useState({ reasonCode: "NO_PROOF", reason: REJECT_REASON_OPTIONS[0].text });
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editBaseline, setEditBaseline] = useState("");
  const [editVersion, setEditVersion] = useState(null);
  const [providerEditVersion, setProviderEditVersion] = useState(null);
  const [editConflict, setEditConflict] = useState("");
  const [confirmConflictReload, setConfirmConflictReload] = useState(false);
  const [editorSection, setEditorSection] = useState("main");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [proofComparison, setProofComparison] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const editRequestId = useRef(0);
  const publicPhotosRef = useRef(null);
  const publicPhotoInputRef = useRef(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editItemId, setEditItemId] = useState(null);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    category: "",
    price: "",
    currency: "USD",
    net_price: "",
    gross_price: "",
    country: "",
    city: "",
    location: "",
    expiration_at: "",
    vehicle_model: "",
    telegram_refused_chat_id: "",
    telegram_web_chat_id: "",
    telegram_chat_id: "",
    imagesJson: "[]",
    availabilityJson: "[]",
  });
  const [editDetailsRows, setEditDetailsRows] = useState([]);
  const [editImages, setEditImages] = useState([]);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [imageAddError, setImageAddError] = useState("");
  const [imageUploadBusy, setImageUploadBusy] = useState(false);
  const [proofUploadBusy, setProofUploadBusy] = useState(false);
  useEffect(() => {
    if (!editOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [editOpen]);

  const [moderationEvents, setModerationEvents] = useState([]);
  const [correctionReview, setCorrectionReview] = useState(null);
  const [editServiceStatus, setEditServiceStatus] = useState("");
  const [actionBusy, setActionBusy] = useState(null);
  const [telegramPreviewOpen, setTelegramPreviewOpen] = useState(false);
  const [publishedQuery, setPublishedQuery] = useState(queueLocation.q);
  const queueFilter = tab === "published" ? "all" : queueLocation.filter;
  const publishedFilter = tab === "published" ? queueLocation.filter : "all";
  const publishedSort = queueLocation.sort;
  const updateQueueLocation = (patch, replace = false) => {
    if (Object.hasOwn(patch,"focus") && patch.focus === null) pendingLocateRef.current = null;
    const next=writeQueueLocation(new URLSearchParams(window.location.search),patch);
    if(Object.hasOwn(patch,"focus")){next.delete("m_open");next.delete("m_section");}
    setSearchParams(next, { replace });
  };
  const setTab = (status) => updateQueueLocation({ status, filter: "all", sort: status === "published" ? "newest" : "priority", page: 1, focus: null });
  const setQueueFilter = (filter) => updateQueueLocation({ filter, page: 1, focus: null });
  const setPublishedFilter = setQueueFilter;
  const setPublishedSort = (sort) => updateQueueLocation({ sort, page: 1, focus: null });
  useEffect(() => setPublishedQuery(queueLocation.q), [queueLocation.q]);
  useEffect(() => {
    if (publishedQuery.trim() === queueLocation.q) return;
    const timer = setTimeout(() => updateQueueLocation({ q: publishedQuery, page: 1, focus: null }, true), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishedQuery,queueLocation.q]);
  useEffect(() => {
    if (editOpen || loading || queueKey !== loadedQueueKey || !queueLocation.focus) return;
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(`moderation-service-${queueLocation.focus}`);
      if (card) { card.scrollIntoView({ block: "center" }); card.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [editOpen,loading,loadedQueueKey,queueKey,queueLocation.focus]);
  const [publishConfirm, setPublishConfirm] = useState(null);
  const [publishResult, setPublishResult] = useState(null);
  const [rebroadcastBusy, setRebroadcastBusy] = useState(false);

  const editErrors = validateModerationEditor(editForm, rowsToDetails(editDetailsRows));
  const navigateEditor = (section, pinnedProof = proofComparison) => {
    setEditorSection(section);
    if (section === "history") setHistoryExpanded(true);
    const target = document.getElementById(`moderation-editor-${section}`);
    if (target) {
      const proofHeight = document.getElementById("moderation-proof-pane")?.getBoundingClientRect().height || 230;
      target.style.scrollMarginTop = pinnedProof && window.innerWidth < 1024 ? `${proofHeight + 12}px` : "16px";
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  const toggleProofComparison = () => {
    const next = !proofComparison;
    setProofComparison(next);
    requestAnimationFrame(() => navigateEditor("details", next));
  };
  useEffect(() => {
    if (editConflict) document.getElementById("moderation-editor-conflict")?.scrollIntoView({ block: "start" });
  }, [editConflict]);
  const currentEditSnapshot = JSON.stringify({ form: editForm, rows: editDetailsRows, images: editImages });
  const hasUnsavedChanges = Boolean(editOpen && !editLoading && editBaseline && (
    currentEditSnapshot !== editBaseline || newImageUrl.trim()
  ));
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedChanges]);

  const discardEditor = () => {
    editRequestId.current += 1;
    pendingLocateRef.current = null;
    setEditLoading(false);
    setDiscardConfirmOpen(false);
    setEditOpen(false);
    setEditBaseline("");
    setNewImageUrl("");
  };
  const requestCloseEditor = () => {
    if (editSaving || imageUploadBusy || proofUploadBusy) return;
    if (hasUnsavedChanges) setDiscardConfirmOpen(true);
    else discardEditor();
  };
  const addPublicPhoto = () => {
    publicPhotosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    publicPhotoInputRef.current?.click();
  };

  const token = localStorage.getItem("token");
  const cfg = { headers: { Authorization: `Bearer ${token}` } };

  const isAdmin = (() => {
    try {
      const tkn = localStorage.getItem("token");
      if (!tkn) return false;
      const base64 = tkn.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      const claims = JSON.parse(json);
      return (
        claims.role === "admin" ||
        claims.is_admin === true ||
        claims.moderator === true
      );
    } catch {
      return false;
    }
  })();

  queueFetchRef.current = (state, signal) => fetchModerationQueue(axios, { apiBase: API_BASE, state, signal, config: cfg });
  if (!queueRunnerRef.current) queueRunnerRef.current = createQueueRunner({
    request: (state, signal) => queueFetchRef.current(state,signal),
    onLoading: (value) => { setLoading(value); if (value) setQueueError(""); },
    onError: (error,state) => { if (queueRequestKey(state) === queueRequestKey(queueLocationRef.current)) setQueueError("Не удалось загрузить очередь. Данные не потеряны — повторите запрос."); },
    onData: (data,state) => {
      if (queueRequestKey(state) !== queueRequestKey(queueLocationRef.current)) return;
      setItems(data.items); setQueueMeta(data); setCounts(data.counts); setCountsLoaded(true); setQueueError("");
      const key = queueRequestKey({ ...state, page: data.pagination.page });
      loadedKeyRef.current = key; setLoadedQueueKey(key);
      if (state.focusId && pendingLocateRef.current === state.focusId) {
        pendingLocateRef.current = null;
        setReturnNotice(data.focusFound ? "" : `Услуга #${state.focusId} больше не входит в выбранный фильтр. Настройки очереди сохранены.`);
      }
      if (data.pagination.page !== state.page) updateQueueLocation({ page: data.pagination.page },true);
    },
  });
  const load = async () => queueRunnerRef.current.run({ ...queueLocationRef.current, focusId: pendingLocateRef.current });
  const refreshCounts = async () => {
    try { const response = await axios.get(`${API_BASE}/api/admin/services/counts`,cfg); if (response.data?.ok) { setCounts(response.data.counts); setCountsLoaded(true); } } catch { /* Preserve the last known counts. */ }
  };
  useEffect(() => () => queueRunnerRef.current?.cancel(), []);
  useEffect(() => {
    if (loadedKeyRef.current !== queueKey) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueKey]);

  const approve = async (id, options = {}) => {
    const decisionKey=queueKey;
    setNextAfterPublish(null);
    const warnings = Array.isArray(options.warnings) ? options.warnings : [];
    setActionBusy(id);
    try {
      const res = await axios.post(
        `${API_BASE}/api/admin/services/${id}/approve`,
        {
          approvalMode: warnings.length ? "with_warnings" : "clean",
          warnings,
        },
        cfg
      );
      tSuccess(t("moderation.approved", { defaultValue: "Опубликовано" }));
      setPublishConfirm(null);
      setPublishResult({
        serviceId: id,
        service: items.find((x) => x.id === id) || { id },
        broadcast: res.data?.broadcast || null,
      });
      pendingLocateRef.current=null;
      const refreshed=await load();
      if (autoNext && tab === "pending" && refreshed && decisionKey===queueRequestKey(queueLocationRef.current)) setNextAfterPublish({id:nextModerationService(items,id,refreshed.items),key:decisionKey});
    } catch {
      tError(
        t("moderation.approve_error", { defaultValue: "Ошибка approve" })
      );
    } finally {
      setActionBusy(null);
    }
  };

  const publishWarningsForAnalysis = (analysis) => [
    ...analysis.blockingIssues.map((issue) => issue.title),
    ...analysis.warningIssues.map((issue) => issue.title),
    ...analysis.missingRequired.map((item) => `Нет: ${item.label}`),
  ];

  const requestPublish = (svc, analysis = null) => {
    const currentAnalysis = analysis || analyzeModerationService(svc);
    const warnings = publishWarningsForAnalysis(currentAnalysis);
    if (!warnings.length) {
      return approve(svc.id, { warnings: [] });
    }
    setPublishConfirm({
      service: svc,
      warnings,
      clean: false,
    });
  };

  const confirmPublish = () => {
    if (!publishConfirm?.service?.id) return;
    if (publishConfirm.source === "edit") {
      return saveEdit({
        approveAfter: true,
        forceApprove: true,
        warnings: publishConfirm.warnings || [],
      });
    }
    approve(publishConfirm.service.id, {
      warnings: publishConfirm.warnings || [],
    });
  };

  const retryBroadcast = async () => {
    const serviceId = publishResult?.serviceId || publishResult?.service?.id;
    if (!serviceId) return;
    setRebroadcastBusy(true);
    try {
      const res = await axios.post(
        `${API_BASE}/api/admin/services/${serviceId}/rebroadcast`,
        {},
        cfg
      );
      setPublishResult((prev) => ({
        ...(prev || {}),
        broadcast: res.data?.broadcast || null,
      }));
      if (res.data?.broadcast?.ok) tSuccess("Telegram отправлен повторно");
      else tError("Telegram всё ещё не отправлен");
    } catch {
      tError("Не удалось повторить Telegram-публикацию");
    } finally {
      setRebroadcastBusy(false);
    }
  };

  const rebroadcastFromCard = async (svc) => {
    if (!svc?.id) return;
    setActionBusy(`rebroadcast:${svc.id}`);
    try {
      const res = await axios.post(
        `${API_BASE}/api/admin/services/${svc.id}/rebroadcast`,
        {},
        cfg
      );
      setPublishResult({
        serviceId: svc.id,
        service: svc,
        broadcast: res.data?.broadcast || null,
      });
      await load(tab);
      if (res.data?.broadcast?.ok) tSuccess("Telegram отправлен повторно");
      else tError("Telegram не отправлен");
    } catch {
      tError("Не удалось повторить Telegram-публикацию");
    } finally {
      setActionBusy(null);
    }
  };

  const openReject = async (svc, reason = "", reasonCode = "", reasonCodes = null) => {
    if (editOpen && hasUnsavedChanges) return tInfo("Сначала сохраните изменения услуги перед запросом исправлений.");
    setActionBusy(`correction:${svc.id}`);
    try {
    const latest = await axios.get(`${API_BASE}/api/admin/services/${svc.id}`,cfg);
    const first =
      REJECT_REASON_OPTIONS.find((x) => x.code === reasonCode) ||
      REJECT_REASON_OPTIONS[0];
    setRejectTarget({...svc,canRequest:(latest.data.moderation_status || latest.data.status)==="pending",expectedVersion:editOpen && editItemId===svc.id ? editVersion : latest.data.edit_version});
    setRejectForm({ reasonCode: first.code, reason: reason || first.text, reasonCodes: reasonCodes?.length ? reasonCodes : [first.code] });
    } catch { tError("Не удалось открыть запрос исправлений"); } finally { setActionBusy(null); }
  };

  const reject = async (id, reason, reasonCode = "OTHER", reasonCodes = [reasonCode], reasonItems) => {
    if (!reason || !reason.trim()) {
      return tInfo(
        t("moderation.enter_reason_short", {
          defaultValue: "Укажите причину",
        })
      );
    }

    const decisionKey=queueKey;
    setActionBusy(id);
    try {
      const response = await axios.post(
        `${API_BASE}/api/admin/services/${id}/reject`,
        { reason, reasonCode, reasonCodes, reasonItems, ...(rejectTarget?.id === id ? { expected_edit_version: rejectTarget.expectedVersion } : {}) },
        cfg
      );
      tSuccess("Услуга возвращена на исправление");
      if (!response.data?.notification?.sent) tInfo(response.data?.notification?.available ? "Замечания сохранены в личном кабинете, но Telegram-уведомление не доставлено." : "Замечания сохранены в личном кабинете. Telegram поставщика не подключён.");
      setRejectTarget(null);
      setEditOpen(false);
      setTelegramPreviewOpen(false);
      setEditItemId(null);
      setModerationEvents([]);
      pendingLocateRef.current=null;
      const refreshed=await load();
      if (autoNext && tab === "pending" && refreshed && decisionKey===queueRequestKey(queueLocationRef.current)) {
        const nextId=nextModerationService(items,id,refreshed.items);
        if(nextId) await openEdit(nextId);
      }
    } catch (error) {
      throw new Error(error.response?.data?.message || "Не удалось запросить исправление. Повторите попытку.");
    } finally {
      setActionBusy(null);
    }
  };

  const unpublish = async (id) => {
    setActionBusy(id);
    try {
      await axios.post(
        `${API_BASE}/api/admin/services/${id}/unpublish`,
        {},
        cfg
      );
      tSuccess(
        t("moderation.unpublished", {
          defaultValue: "Снято с публикации",
        })
      );
      await load();
    } catch {
      tError(
        t("moderation.unpublish_error", {
          defaultValue: "Ошибка unpublish",
        })
      );
    } finally {
      setActionBusy(null);
    }
  };

  const openEdit = async (id) => {
    if (editLoading) return;
    const requestId = ++editRequestId.current;
    pendingLocateRef.current = Number(id);
    setReturnNotice("");
    updateQueueLocation({ focus: id },true);
    setEditItemId(id);
    setEditBaseline("");
    setCorrectionReview(null);
    setDiscardConfirmOpen(false);
    setEditConflict("");
    setConfirmConflictReload(false);
    setHistoryExpanded(false);
    setProofComparison(false);
    setEditorSection("main");
    setEditOpen(true);
    setEditLoading(true);
    try {
      const [res, eventsRes] = await Promise.all([
        axios.get(`${API_BASE}/api/admin/services/${id}`, cfg),
        axios.get(`${API_BASE}/api/admin/services/${id}/moderation-events`, cfg).catch(() => ({ data: { items: [] } })),
      ]);
      if (requestId !== editRequestId.current) return;
      const s = res.data || {};
      setEditVersion(s.edit_version);
      setEditServiceStatus(s.moderation_status || s.status);
      setCorrectionReview(eventsRes?.data?.correction || null);
      setProviderEditVersion(s.provider_edit_version);
      setModerationEvents(Array.isArray(eventsRes?.data?.items) ? eventsRes.data.items : []);
      const details = normalizeDetails(s.details);
      const images = normalizeImages(s.images);
      const availability = Array.isArray(s.availability)
        ? s.availability
        : parseJsonSafe(s.availability, []) || [];
      setEditDetailsRows(detailsToRows(details));
      setEditImages(getPublicServiceImages(images, details));
      setNewImageUrl("");
      setImageAddError("");

      setEditItemId(id);
      const nextForm = {
        title: s.title || "",
        description: s.description || "",
        category: s.category || "",
        price: s.price ?? "",
        currency: s.currency || "USD",
        net_price: pickFirst(details.netPrice, details.net_price, s.net_price) ?? "",
        gross_price: pickFirst(details.grossPrice, details.gross_price, details.price, s.gross_price, s.price) ?? "",
        country: pickFirst(details.directionCountry, details.country, s.country) || "",
        city: pickFirst(details.city, s.city) || "",
        location: pickFirst(details.location, s.location) || "",
        expiration_at: s.expiration_at ? String(s.expiration_at).slice(0, 16) : "",
        vehicle_model: s.vehicle_model || "",
        telegram_refused_chat_id: s.telegram_refused_chat_id || "",
        telegram_web_chat_id: s.telegram_web_chat_id || "",
        telegram_chat_id: s.telegram_chat_id || "",
        imagesJson: JSON.stringify(images, null, 2),
        availabilityJson: JSON.stringify(availability, null, 2),
      };
      setEditForm(nextForm);
      setEditBaseline(JSON.stringify({ form: nextForm, rows: detailsToRows(details), images: getPublicServiceImages(images, details) }));
    } catch {
      if (requestId !== editRequestId.current) return;
      setEditOpen(false);
      tError(
        t("moderation.load_edit_error", {
          defaultValue: "Не удалось загрузить услугу для редактирования",
        })
      );
    } finally {
      if (requestId === editRequestId.current) setEditLoading(false);
    }
  };

  const removeEditImage = (idx) => {
    setEditImages((prev) => prev.filter((_, i) => i !== idx));
    setImageAddError("");
  };

  const addEditImage = () => {
    if (!newImageUrl.trim()) {
      setImageAddError("Вставьте хотя бы одну ссылку на изображение.");
      return;
    }
    try {
      setEditImages(collectEditorImages(editImages, newImageUrl));
      setNewImageUrl("");
      setImageAddError("");
    } catch (error) {
      setImageAddError(error.message);
    }
  };

  const uploadEditImages = async (event) => {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    if (!files.length) return;

    const remaining = 20 - editImages.length;
    if (files.length > remaining) {
      setImageAddError(`Можно добавить ещё только ${Math.max(0, remaining)} изображений.`);
      input.value = "";
      return;
    }

    const invalid = files.find(
      (file) => !String(file.type || "").startsWith("image/") || file.size > 8 * 1024 * 1024
    );
    if (invalid) {
      setImageAddError(
        String(invalid.type || "").startsWith("image/")
          ? `Файл «${invalid.name}» больше 8 МБ.`
          : `Файл «${invalid.name}» не является изображением.`
      );
      input.value = "";
      return;
    }

    setImageUploadBusy(true);
    setImageAddError("");
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const res = await axios.post(
        `${API_BASE}/api/admin/services/${editItemId}/images/upload`,
        formData,
        cfg
      );
      const urls = Array.isArray(res.data?.images)
        ? res.data.images.map((item) => String(item?.url || "").trim()).filter(Boolean)
        : [];
      if (!urls.length) throw new Error("Сервер не вернул ссылки на загруженные изображения.");

      setEditImages((prev) => [...new Set([...prev, ...urls])].slice(0, 20));
      tSuccess(urls.length === 1 ? "Изображение добавлено" : `Добавлено изображений: ${urls.length}`);
    } catch (error) {
      setImageAddError(
        error?.response?.data?.message || error?.message || "Не удалось загрузить изображения."
      );
    } finally {
      setImageUploadBusy(false);
      input.value = "";
    }
  };

  const updateDetailRow = (idx, patch) => {
    setEditDetailsRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };

  const setDetailValue = (key, value) => {
    const rootField = {
      netPrice: "net_price", net_price: "net_price",
      grossPrice: "gross_price", gross_price: "gross_price", price: "gross_price",
      directionCountry: "country", country: "country", city: "city", location: "location",
    }[key];
    if (rootField) setEditForm((prev) => ({ ...prev, [rootField]: value }));
    setEditDetailsRows((prev) => {
      const idx = prev.findIndex((row) => row.key === key);
      if (idx === -1) return [...prev, { key, value }];
      return prev.map((row, i) => (i === idx ? { ...row, value } : row));
    });
  };

  const setProofImages = (imagesOrUpdater) => {
    setEditDetailsRows((prev) => {
      const details = rowsToDetails(prev);
      const current = normalizeImages(details.proofImages);
      const images = normalizeImages(typeof imagesOrUpdater === "function" ? imagesOrUpdater(current) : imagesOrUpdater);
      return detailsToRows({
        ...details,
        proofImages: images,
        proofReviewStatus: images.length ? "pending" : "",
        proofReviewNote: "",
        proofReviewedAt: "",
        proofReviewedBy: null,
      });
    });
  };

  const uploadProofImages = async (event) => {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    if (!files.length || !editItemId || proofUploadBusy || editSaving) return;
    const remaining = Math.max(0, 20 - normalizeImages(rowsToDetails(editDetailsRows).proofImages).length);
    const invalid = files.find((file) => !String(file.type || "").startsWith("image/") || file.size > 8 * 1024 * 1024);
    if (files.length > remaining || invalid) {
      tError(files.length > remaining
        ? `Можно добавить ещё только ${remaining} подтверждений.`
        : `Файл «${invalid.name}» должен быть изображением размером до 8 МБ.`);
      input.value = "";
      return;
    }
    setProofUploadBusy(true);
    try {
      const data = new FormData();
      files.forEach((file) => data.append("files", file));
      const response = await axios.post(
        `${API_BASE}/api/admin/services/${editItemId}/proof-images/upload`,
        data,
        { headers: { ...cfg.headers, "Content-Type": "multipart/form-data" } }
      );
      const urls = (response?.data?.images || []).map((image) => image?.url).filter(Boolean);
      if (!urls.length) throw new Error("Сервер не вернул ссылки на подтверждения.");
      setProofImages((current) => [...current, ...urls]);
      tSuccess(urls.length === 1 ? "Подтверждение добавлено" : `Добавлено подтверждений: ${urls.length}`);
    } catch (error) {
      tError(error?.response?.data?.message || error?.message || "Не удалось загрузить подтверждение");
    } finally {
      setProofUploadBusy(false);
      input.value = "";
    }
  };

  const removeDetailRow = (idx) => {
    setEditDetailsRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const addDetailRow = () => {
    setEditDetailsRows((prev) => [...prev, { key: "", value: "" }]);
  };
  
  const saveEdit = async ({ approveAfter = false, forceApprove = false, warnings = [] } = {}) => {
    if (editSaving || editLoading || imageUploadBusy || proofUploadBusy) return;
    if (Object.keys(editErrors).length) {
      setDiscardConfirmOpen(false);
      navigateEditor(editErrors.price || editErrors.expiration_at ? "main" : "details");
      return tError("Исправьте поля, отмеченные ошибками, перед сохранением.");
    }
    if (editConflict) return tError("Сначала загрузите актуальную версию услуги. Ваш черновик остаётся в форме.");
    const details = rowsToDetails(editDetailsRows);
    let images;
    try {
      images = collectEditorImages(editImages, newImageUrl);
    } catch (error) {
      setDiscardConfirmOpen(false);
      setImageAddError(error.message);
      return tError(error.message);
    }
    const availability = parseJsonSafe(editForm.availabilityJson, null);

    if (!details || typeof details !== "object" || Array.isArray(details)) {
      return tError(
        t("moderation.details_json_invalid", {
          defaultValue: "Поля details должны быть объектом",
        })
      );
    }

    if (!Array.isArray(availability)) {
      return tError(
        t("moderation.availability_json_invalid", {
          defaultValue: "availability должен быть JSON-массивом",
        })
      );
    }

    if (approveAfter && !publishReady && !forceApprove) {
      return tInfo("Сначала заполните обязательные пункты чеклиста готовности.");
    }

    setEditSaving(true);
    try {
      await axios.put(
        `${API_BASE}/api/admin/services/${editItemId}`,
        {
          expected_edit_version: editVersion,
          expected_provider_edit_version: providerEditVersion,
          title: editForm.title,
          description: editForm.description,
          category: editForm.category,
          price: editForm.price === "" ? null : editForm.price,
          currency: editForm.currency,
          net_price: editForm.net_price === "" ? null : editForm.net_price,
          gross_price: editForm.gross_price === "" ? null : editForm.gross_price,
          country: editForm.country,
          city: editForm.city,
          location: editForm.location,
          expiration_at: editForm.expiration_at || null,
          vehicle_model: editForm.vehicle_model,
          ...changedProviderContacts(editForm, JSON.parse(editBaseline || "{}").form),
          details,
          images,
          availability,
        },
        cfg
      );

      let approveRes = null;
      if (approveAfter) {
        approveRes = await axios.post(
          `${API_BASE}/api/admin/services/${editItemId}/approve`,
          {
            approvalMode: warnings.length ? "with_warnings" : "clean",
            warnings,
          },
          cfg
        );
      }

      tSuccess(
        t("moderation.saved", {
          defaultValue: approveAfter
            ? "Изменения сохранены и услуга опубликована"
            : "Изменения сохранены",
        })
      );
      setEditOpen(false);
      setEditBaseline("");
      setDiscardConfirmOpen(false);
      setNewImageUrl("");
      setTelegramPreviewOpen(false);
      setPublishConfirm(null);
      if (approveAfter) {
        setPublishResult({
          serviceId: editItemId,
          service: {
            id: editItemId,
            title: pickFirst(editForm.title, details.title, details.hotel, details.eventName),
            category: editForm.category,
          },
          broadcast: approveRes?.data?.broadcast || null,
        });
      }
      setEditItemId(null);
      setModerationEvents([]);
      if(approveAfter) pendingLocateRef.current=null;
      const refreshed=await load(tab);
      if (approveAfter && autoNext && tab === "pending" && refreshed && queueKey===queueRequestKey(queueLocationRef.current)) setNextAfterPublish({id:nextModerationService(items,editItemId,refreshed.items),key:queueKey});
      await refreshCounts();
    } catch (error) {
      if (error?.response?.status === 409) {
        setDiscardConfirmOpen(false);
        setEditConflict(error.response.data?.message || "Услуга изменена другим администратором. Ваш черновик остался в форме.");
        document.getElementById("moderation-editor-conflict")?.scrollIntoView({ block: "start" });
        return;
      }
      tError(
        t("moderation.save_error", {
          defaultValue: "Не удалось сохранить изменения",
        })
      );
    } finally {
      setEditSaving(false);
    }
  };

  useEffect(()=>{
    if(!isAdmin || searchParams.get("m_open")!=="1" || loading || editLoading || editOpen || loadedQueueKey!==queueKey) return;
    const id=queueLocation.focus;
    if(!id || !items.some(item=>Number(item.id)===id)) {
      const next=new URLSearchParams(searchParams);next.delete("m_open");next.delete("m_section");setSearchParams(next,{replace:true});
      setReturnNotice("Услуга больше не находится в этой очереди. Возможно, её уже обработал другой модератор.");return;
    }
    openEdit(id);
  },[isAdmin,loading,loadedQueueKey,queueKey,editLoading,editOpen,queueLocation.focus,searchParams]);

  if (!isAdmin) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <div className="bg-white border rounded-lg p-6">
          <div className="text-xl font-semibold mb-2">403</div>
          <div>
            {t("moderation.forbidden", {
              defaultValue: "Доступ только для администратора",
            })}
          </div>
        </div>
      </div>
    );
  }

  const editDetails = rowsToDetails(editDetailsRows);
  const editProofImages = normalizeImages(editDetails.proofImages);
  const editProofStatus = String(editDetails.proofReviewStatus || "pending").toLowerCase();
  const businessDetailRows = editDetailsRows
    .map((row, index) => ({ ...row, index }))
    .filter((row) => !QUICK_DETAIL_KEYS.has(row.key) && !INTERNAL_DETAIL_KEYS.has(row.key));
  const technicalDetailRows = editDetailsRows
    .map((row, index) => ({ ...row, index }))
    .filter((row) => row.key && INTERNAL_DETAIL_KEYS.has(row.key));
  const detailKey = (keys, fallback) =>
    keys.find((key) => {
      const value = editDetails[key];
      return value !== null && typeof value !== "undefined" && String(value).trim() !== "";
    }) || fallback;
  const readinessItems = getModerationReadiness(editForm, editDetails, editImages);
  const dangerIssues = getDangerIssues(editForm, editDetails, editImages);
  const blockingIssues = dangerIssues.filter((issue) => issue.blocking);
  const perPersonSuggestion = calculatePerPersonPrice(editDetails, editForm.price);
  const publishReady = readinessItems
    .filter((item) => item.required)
    .every((item) => item.ok) && blockingIssues.length === 0;
  const requestPublishFromEdit = () => {
    if (!editItemId) return;
    const warnings = [
      ...blockingIssues.map((issue) => issue.title),
      ...dangerIssues.filter((issue) => !issue.blocking).map((issue) => issue.title),
      ...readinessItems
        .filter((item) => item.required && !item.ok)
        .map((item) => `Нет: ${item.label}`),
    ];

    if (!warnings.length) {
      return saveEdit({ approveAfter: true, warnings: [] });
    }

    setPublishConfirm({
      source: "edit",
      service: {
        id: editItemId,
        title: pickFirst(editForm.title, editDetails.title, editDetails.hotel, editDetails.eventName),
        category: editForm.category,
      },
      warnings,
      clean: false,
    });
  };
  const toggleDetailBool = (key) => setDetailValue(key, yesNoValue(editDetails[key]) ? "false" : "true");
  const applyPerPersonSuggestion = () => {
    if (!perPersonSuggestion) return;
    setDetailValue("pricePerPerson", `${fmt(perPersonSuggestion.amount)} USD`);
    setDetailValue("priceFor", "за 1 человека");
    setDetailValue("persons", String(perPersonSuggestion.people));
  };
  const openCorrectionFromEdit = () => {
    if (!editItemId) return;
    const reason = buildCorrectionReason(readinessItems, dangerIssues);
    const reasonCode = correctionReasonCode(readinessItems, dangerIssues);
    openReject(
      {
        id: editItemId,
        title: pickFirst(editForm.title, editDetails.title, editDetails.hotel, editDetails.eventName),
        category: editForm.category,
        canRequest: editServiceStatus === "pending",
      },
      reason,
      reasonCode,
      selectedCorrectionCodes(readinessItems,dangerIssues)
    );
  };
  const openCorrectionFromCard = (svc, analysis, template = null) => {
    const currentAnalysis = analysis || analyzeModerationService(svc);
    const reason =
      template?.reason ||
      buildCorrectionReason(
        currentAnalysis.readinessItems,
        currentAnalysis.dangerIssues
      );
    const reasonCode =
      template?.reasonCode ||
      correctionReasonCode(
        currentAnalysis.readinessItems,
        currentAnalysis.dangerIssues
      );
    openReject(svc, reason, reasonCode, template ? [reasonCode] : selectedCorrectionCodes(currentAnalysis.readinessItems,currentAnalysis.dangerIssues));
  };
  const displayedItems = loadedQueueKey === queueKey ? items : [];
  const activeQueueMeta = loadedQueueKey === queueKey ? queueMeta : null;
  const publishedMetrics = tab === "published" && activeQueueMeta ? activeQueueMeta.metrics : getPublishedMetrics([]);
  const pagination = queueMeta?.pagination;

  return (
    <>
      <div className={embedded ? "w-full" : "max-w-6xl mx-auto p-4"}>
        <div className={`mb-4 flex items-center ${embedded ? "justify-end" : "justify-between"}`}>
          {!embedded && (
            <h1 className="text-2xl font-bold">
              {t("moderation.title", { defaultValue: "Модерация услуг" })}
            </h1>
          )}
          <button
            onClick={() => {
              load(tab);
              refreshCounts();
            }}
            className="px-3 py-1.5 rounded bg-gray-900 text-white text-sm"
          >
            {t("common.refresh", { defaultValue: "Обновить" })}
          </button>
        </div>

        <div className="mb-5 flex w-fit max-w-full flex-wrap overflow-hidden rounded-2xl bg-white shadow-sm">
          <button
            className={`px-4 py-1.5 text-sm font-medium ${
              tab === "pending"
                ? "bg-gray-900 text-white"
                : "text-gray-700 hover:bg-gray-100"
            }`}
            onClick={() => setTab("pending")}
          >
            {t("moderation.tabs.pending", { defaultValue: "Ожидают" })}
            <span className="ml-2 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 text-xs rounded-full bg-gray-200 text-gray-700">
              {countsLoaded ? counts.pending || 0 : "…"}
            </span>
          </button>

          <button
            className={`px-4 py-1.5 text-sm font-medium ${
              tab === "rejected"
                ? "bg-gray-900 text-white"
                : "text-gray-700 hover:bg-gray-100"
            }`}
            onClick={() => setTab("rejected")}
          >
            {t("moderation.tabs.rejected", { defaultValue: "Отклонённые" })}
            <span className="ml-2 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 text-xs rounded-full bg-gray-200 text-gray-700">
              {countsLoaded ? counts.rejected || 0 : "…"}
            </span>
          </button>

          <button
            className={`px-4 py-1.5 text-sm font-medium ${
              tab === "published"
                ? "bg-gray-900 text-white"
                : "text-gray-700 hover:bg-gray-100"
            }`}
            onClick={() => setTab("published")}
          >
            Опубликованные
            <span className="ml-2 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 text-xs rounded-full bg-gray-200 text-gray-700">
              {countsLoaded ? counts.published || 0 : "…"}
            </span>
          </button>
        </div>

        {tab !== "published" && (
          <QueuePanel
            items={items}
            filter={queueFilter}
            onFilterChange={setQueueFilter}
            query={publishedQuery}
            onQueryChange={setPublishedQuery}
            sort={publishedSort}
            onSortChange={setPublishedSort}
            metricsOverride={activeQueueMeta?.metrics || getQueueMetrics([])}
          />
        )}

        {tab === "published" && (
          <PublishedControls
            items={items}
            metricsOverride={publishedMetrics}
            query={publishedQuery}
            onQueryChange={setPublishedQuery}
            filter={publishedFilter}
            onFilterChange={setPublishedFilter}
            sort={publishedSort}
            onSortChange={setPublishedSort}
          />
        )}

        {tab === "pending" && <label className="mb-3 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={autoNext} onChange={e=>setAutoNext(e.target.checked)}/>Открывать следующую услугу после решения</label>}
        {!loading && !queueError && tab === "published" && loadedQueueKey === queueKey && (
          <div className="mb-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{queueLocation.q ? "В поиске" : "На сайте"}</div>
              <div className="mt-1 text-2xl font-bold text-slate-950">{publishedMetrics.total}</div>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Открытий контактов</div>
              <div className="mt-1 text-2xl font-bold text-emerald-900">
                {publishedMetrics.unlocks}
              </div>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-blue-700">Telegram-заявок</div>
              <div className="mt-1 text-2xl font-bold text-blue-900">
                {publishedMetrics.requests}
              </div>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-rose-700">Telegram ошибки</div>
              <div className="mt-1 text-2xl font-bold text-rose-900">
                {publishedMetrics.telegramFailed}
              </div>
            </div>
          </div>
        )}

        {returnNotice && <div role="status" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{returnNotice}</div>}
        <nav aria-label="Страницы услуг" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-sm text-slate-600" role="status">{loading ? "Обновляем очередь…" : pagination && loadedQueueKey === queueKey ? `Найдено: ${pagination.total}. Страница ${pagination.page} из ${pagination.pages}` : "Очередь не загружена"}</div>
          <label className="flex items-center gap-2 text-xs text-slate-600">На странице<select aria-label="Услуг на странице" value={queueLocation.pageSize} onChange={(event) => updateQueueLocation({ pageSize: Number(event.target.value),page:1,focus:null })} className="rounded-lg border border-slate-200 px-2 py-2">{[12,24,48].map((size)=><option key={size} value={size}>{size}</option>)}</select></label>
          <div className="flex gap-2"><button type="button" disabled={loading || queueLocation.page <= 1} onClick={() => updateQueueLocation({ page:queueLocation.page-1,focus:null })} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Назад</button><button type="button" disabled={loading || !pagination || queueLocation.page >= pagination.pages} onClick={() => updateQueueLocation({ page:queueLocation.page+1,focus:null })} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Далее</button></div>
        </nav>
        {loading ? (
          <div role="status" className="text-gray-600">
            {t("common.loading", { defaultValue: "Загрузка…" })}
          </div>
        ) : queueError ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><p>{queueError}</p><button type="button" onClick={() => load()} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 font-bold text-white">Повторить загрузку</button></div>
        ) : displayedItems.length === 0 && !queueLocation.q && queueLocation.filter === "all" ? (
          <div className="flex min-h-44 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 text-center">
            <div>
              <BadgeCheck className="mx-auto mb-3 text-emerald-600" size={28} strokeWidth={1.8} />
              <div className="font-semibold text-slate-900">
                {tab === "pending" ? "Очередь проверена" : t("moderation.empty", { defaultValue: "Нет элементов" })}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {tab === "pending" ? "Новых услуг, ожидающих модерации, сейчас нет." : "В этом разделе пока нет услуг."}
              </div>
            </div>
          </div>
        ) : displayedItems.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            По выбранному фильтру карточек нет.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayedItems.map((it) => {
              const analysis = analyzeModerationService(it);
              return (
              <Card
                key={it.id}
                item={it}
                tab={tab}
                analysis={analysis}
                onEdit={openEdit}
                editorLoading={editLoading}
                openingServiceId={editItemId}
                focused={queueLocation.focus === Number(it.id)}
                onApprove={() => requestPublish(it, analysis)}
                onReject={(...args) => reject(...args).catch(error => tError(error.message))}
                onRejectClick={openReject}
                onCorrectionClick={openCorrectionFromCard}
                onUnpublish={unpublish}
                onRebroadcast={rebroadcastFromCard}
                actionBusy={actionBusy}
                onOpenProof={setProofViewer}
                t={t}
              />
              );
            })}
          </div>
        )}
      </div>
      {rejectTarget && createPortal(<CorrectionRequestDialog key={rejectTarget.id} target={rejectTarget} initial={rejectForm} options={REJECT_REASON_OPTIONS} busy={actionBusy === rejectTarget.id} onClose={()=>setRejectTarget(null)} onSubmit={reject} />,document.body)}

      {editOpen &&
        createPortal(
          <div role="dialog" aria-modal="true" aria-label="Редактирование услуги" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); requestCloseEditor(); } }} className="fixed inset-0 z-[5000] bg-slate-950/70 flex items-center justify-center p-3 md:p-6">
            <div className={`flex w-full ${proofComparison ? "max-w-7xl" : "max-w-6xl"} max-h-[94dvh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl`}>
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-6 md:py-4">
                <div>
                <div className="text-lg font-bold text-slate-950">
                  {t("moderation.edit_service", {
                    defaultValue: "Редактирование услуги",
                  })}
                </div>
                <div className="mt-0.5 text-sm text-slate-500">#{editItemId} · Проверьте данные и подтверждение перед публикацией</div>
                </div>
                <button
                  type="button"
                  onClick={requestCloseEditor}
                  disabled={editSaving || imageUploadBusy || proofUploadBusy}
                  className="text-2xl leading-none text-gray-500 hover:text-black"
                >
                  ×
                </button>
              </div>

              {!editLoading && tab === "pending" && <label className="flex shrink-0 items-center gap-2 border-b bg-white px-4 py-2 text-xs text-slate-600"><input type="checkbox" checked={autoNext} onChange={e=>setAutoNext(e.target.checked)}/>Открывать следующую после решения</label>}
              {!editLoading && <nav aria-label="Разделы редактора" className="flex shrink-0 flex-wrap gap-1 border-b border-slate-200 bg-white px-4 py-2">
                {[["main", "Данные"], ["proof", "Proof"], ["photos", "Фото"], ["details", "Параметры"], ["history", "История"]].map(([key, label]) => <button key={key} type="button" aria-current={editorSection === key ? "location" : undefined} onClick={() => navigateEditor(key)} className={`rounded-lg px-3 py-2 text-xs font-bold ${editorSection === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</button>)}
                <button type="button" aria-pressed={proofComparison} onClick={toggleProofComparison} className={`rounded-lg px-3 py-2 text-xs font-bold ${proofComparison ? "bg-violet-700 text-white" : "bg-violet-50 text-violet-800 hover:bg-violet-100"}`}>Сверка proof</button>
              </nav>}
              {editLoading && <div role="status" className="flex min-h-48 items-center justify-center gap-3 p-8 text-slate-600"><span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-violet-600" aria-hidden="true" />Загружаем услугу #{editItemId}…</div>}
              <div aria-busy={editLoading} className={`min-h-0 flex-1 overflow-y-auto p-4 md:p-6 ${editLoading ? "hidden" : ""}`}>
              <div className={proofComparison ? "flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]" : "grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"}>
                <div className="space-y-4 min-w-0">
                  {correctionReview && <CorrectionReview key={`${editItemId}:${correctionReview.requestId}:${correctionReview.fingerprint}`} correction={correctionReview} options={REJECT_REASON_OPTIONS} disabled={hasUnsavedChanges || editSaving || editLoading || proofUploadBusy || imageUploadBusy || correctionReview.editVersion !== editVersion} onNavigate={navigateEditor} onSave={async (checkedCodes)=>{
                    try {
                      await axios.post(`${API_BASE}/api/admin/services/${editItemId}/correction-review`,{requestId:correctionReview.requestId,expected_edit_version:correctionReview.editVersion,checkedCodes},cfg);
                      const refreshed=await axios.get(`${API_BASE}/api/admin/services/${editItemId}/moderation-events`,cfg);
                      setModerationEvents(refreshed.data.items || []);
                      // Keep this mounted to preserve the explicit success notice.
                    } catch(error) { throw new Error(error.response?.data?.message || "Не удалось сохранить проверку"); }
                  }} />}
                  <details id="moderation-editor-history" open={historyExpanded} onToggle={(event) => setHistoryExpanded(event.currentTarget.open)} className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-3">
                    <summary className="cursor-pointer text-sm font-bold text-slate-800">История правок и модерации · {moderationEvents.length}</summary>
                    <div className="mt-3 space-y-3">
                      {moderationEvents.length > 0 && <p className="text-xs text-slate-500">Последние {moderationEvents.length} событий. История новых правок ведётся с этого обновления.</p>}
                      {!moderationEvents.length && <p className="text-xs text-slate-500">Записей пока нет. Новые сохранённые изменения появятся здесь.</p>}
                      {moderationEvents.map((event) => <article key={event.id} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                        <div className="flex flex-wrap gap-x-2 gap-y-1 font-semibold text-slate-700"><span>{({ service_edited: "Изменение услуги", telegram_sent: "Отправлено в Telegram", telegram_failed: "Ошибка отправки в Telegram", approved_clean: "Опубликовано", approved_with_warnings: "Опубликовано с предупреждениями", rejected: "Отклонено", correction_requested: "Запрошено исправление", correction_reviewed: "Повторная проверка исправлений", correction_resubmitted: "Поставщик отправил исправления", unpublished: "Снято с публикации" })[event.action] || event.action}</span><span>{event.actor_id ? `${event.actor_role === "provider" ? "Поставщик" : "Администратор"} #${event.actor_id}` : "Система"}</span><span>{formatDt(event.created_at)}</span></div>
                        {event.reason && <p className="mt-1 break-words text-slate-600">{event.reason}</p>}
                        {Array.isArray(event.meta?.changes) && <dl className="mt-2 space-y-2">{event.meta.changes.map((change) => <div key={change.field} className="min-w-0"><dt className="font-semibold text-slate-700">{detailLabel(change.field.replace(/^(details|provider)\./, ""))}</dt><dd className="mt-1 grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2"><span className="min-w-0 whitespace-pre-wrap break-words rounded bg-rose-50 p-2 text-rose-800">Было: {change.before ?? "—"}</span><span className="min-w-0 whitespace-pre-wrap break-words rounded bg-emerald-50 p-2 text-emerald-800">Стало: {change.after ?? "—"}</span></dd></div>)}</dl>}
                      </article>)}
                    </div>
                  </details>
                  {editConflict && <div id="moderation-editor-conflict" role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">{editConflict}</p><p className="mt-1 text-xs">Скопируйте нужные значения из черновика перед обновлением формы.</p><button type="button" onClick={() => setConfirmConflictReload(true)} className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white">Загрузить актуальную версию</button></div>}
                  {Object.keys(editErrors).length > 0 && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Ошибок в полях: {Object.keys(editErrors).length}. Проверьте даты и цены перед сохранением.</div>}
                <ReadinessChecklist items={readinessItems} />
                <DangerIssuesPanel issues={dangerIssues} onAddPublicPhoto={addPublicPhoto} />

                <section id="moderation-editor-proof" className={`scroll-mt-4 rounded-2xl border p-4 ${editProofStatus === "approved" ? "border-emerald-200 bg-emerald-50" : editProofStatus === "rejected" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-slate-950">Подтверждение подлинности</div>
                      <div className="mt-1 text-xs text-slate-600">Фото, документ или скриншот, подтверждающий цену и доступность услуги.</div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${editProofStatus === "approved" ? "bg-emerald-600 text-white" : editProofStatus === "rejected" ? "bg-rose-600 text-white" : "bg-amber-200 text-amber-900"}`}>
                      {editProofStatus === "approved" ? "Подтверждено" : editProofStatus === "rejected" ? "Отклонено" : "Не проверено"}
                    </span>
                  </div>

                  {editProofImages.length > 0 ? (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {editProofImages.map((image, index) => (
                        <div key={`${image}-${index}`} className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-white bg-white shadow-sm">
                          <button type="button" onClick={() => setProofViewer(image)} className="h-full w-full">
                            <img src={image} alt={`Подтверждение ${index + 1}`} className="h-full w-full object-contain" />
                          </button>
                          <button type="button" disabled={proofUploadBusy || editSaving} onClick={() => setProofImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-slate-950/80 text-white transition hover:bg-black disabled:opacity-50" aria-label={`Удалить подтверждение ${index + 1}`}>×</button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-dashed border-amber-300 bg-white/70 px-4 py-6 text-center text-sm text-amber-900">Подтверждение ещё не загружено</div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <label className={`cursor-pointer rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-black ${proofUploadBusy || editSaving || editProofImages.length >= 20 ? "pointer-events-none opacity-60" : ""}`}>
                      <input type="file" accept="image/*" multiple className="sr-only" disabled={proofUploadBusy || editSaving || editProofImages.length >= 20} onChange={uploadProofImages} />
                      {proofUploadBusy ? "Загрузка..." : "Добавить подтверждение"}
                    </label>
                    <button type="button" disabled={proofUploadBusy || editSaving || !editProofImages.length} onClick={() => setDetailValue("proofReviewStatus", "approved")} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${editProofStatus === "approved" ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-200 bg-white text-emerald-700"}`}>Подтвердить</button>
                    <button type="button" disabled={proofUploadBusy || editSaving || !editProofImages.length} onClick={() => setDetailValue("proofReviewStatus", "rejected")} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${editProofStatus === "rejected" ? "border-rose-600 bg-rose-600 text-white" : "border-rose-200 bg-white text-rose-700"}`}>Отклонить</button>
                    {editProofStatus !== "pending" && <button type="button" disabled={proofUploadBusy || editSaving} onClick={() => setDetailValue("proofReviewStatus", "pending")} className="px-3 py-2 text-sm font-semibold text-slate-500">Сбросить</button>}
                  </div>
                  <p className="mt-3 text-xs text-slate-600" role="status">
                    {proofUploadBusy ? "Дождитесь завершения загрузки перед сохранением." : `${editProofImages.length} из 20 · Изображения до 8 МБ. Добавление и удаление применяются после сохранения.`}
                  </p>
                </section>

                <EditSection id="moderation-editor-main" title="Основные данные">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Название услуги
                    </label>
                    <input
                      type="text"
                      aria-label="Название услуги"
                      value={editForm.title}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, title: e.target.value }))
                      }
                      className="min-w-0 w-full border rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Категория
                    </label>
                    <input
                      type="text"
                      aria-label="Категория"
                      value={editForm.category}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, category: e.target.value }))
                      }
                      className="min-w-0 w-full border rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Базовая цена
                    </label>
                    <input
                      type="text"
                      aria-label="Базовая цена"
                      aria-invalid={Boolean(editErrors.price)}
                      aria-describedby={editErrors.price ? "moderation-price-error" : undefined}
                      value={editForm.price}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, price: e.target.value }))
                      }
                      className="min-w-0 w-full border rounded-lg px-3 py-2"
                    />
                  </div>

                  {editErrors.price && <p id="moderation-price-error" role="alert" className="text-xs text-rose-700">{editErrors.price}</p>}
                  <div>
                    <label className="block text-sm font-medium mb-1">Валюта</label>
                    <select
                      value={editForm.currency}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, currency: e.target.value }))}
                      className="min-w-0 w-full border rounded-lg px-3 py-2 bg-white"
                    >
                      <option value="UZS">UZS</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>

                  <TextField label="Город" value={editForm.city} onChange={(value) => setDetailValue("city", value)} />
                  <TextField label="Локация / маршрут" value={editForm.location} onChange={(value) => setDetailValue("location", value)} />
                  <label className="block min-w-0">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Действует до</span>
                    <input type="datetime-local" value={editForm.expiration_at} onChange={(e) => setEditForm((prev) => ({ ...prev, expiration_at: e.target.value }))} className="min-w-0 w-full border rounded-lg px-3 py-2 bg-white" />
                  </label>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Модель транспорта
                    </label>
                    <input
                      type="text"
                      value={editForm.vehicle_model}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          vehicle_model: e.target.value,
                        }))
                      }
                      className="min-w-0 w-full border rounded-lg px-3 py-2"
                    />
                  </div>

                  <details className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-600">Технические контакты Telegram</summary>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Refused bot chat ID
                    </label>
                    <input
                      type="text"
                      value={editForm.telegram_refused_chat_id}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          telegram_refused_chat_id: e.target.value,
                        }))
                      }
                      className="min-w-0 w-full border rounded-lg px-3 py-2"
                      placeholder="-100..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Web bot chat ID
                    </label>
                    <input
                      type="text"
                      value={editForm.telegram_web_chat_id}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          telegram_web_chat_id: e.target.value,
                        }))
                      }
                      className="min-w-0 w-full border rounded-lg px-3 py-2"
                      placeholder="70659475"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Main Telegram chat ID
                    </label>
                    <input
                      type="text"
                      value={editForm.telegram_chat_id}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          telegram_chat_id: e.target.value,
                        }))
                      }
                      className="min-w-0 w-full border rounded-lg px-3 py-2"
                      placeholder="70659475"
                    />
                  </div>
                    </div>
                  </details>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Описание для клиента
                  </label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    rows={4}
                    className="min-w-0 w-full border rounded-lg px-3 py-2"
                  />
                </div>
                </EditSection>

                <EditSection id="moderation-editor-details" title="Параметры карточки">
                  <div className="flex flex-wrap gap-2">
                    <ToggleChip
                      active={yesNoValue(editDetails.flightIncluded || editDetails.airTickets || editDetails.aviaTickets)}
                      label="Авиабилеты включены"
                      onClick={() => toggleDetailBool(detailKey(["flightIncluded", "airTickets", "aviaTickets"], "flightIncluded"))}
                    />
                    <ToggleChip
                      active={yesNoValue(editDetails.transferIncluded || editDetails.hasTransfer || editDetails.transfer)}
                      label="Трансфер включён"
                      onClick={() => toggleDetailBool(detailKey(["transferIncluded", "hasTransfer", "transfer"], "transferIncluded"))}
                    />
                    <ToggleChip
                      active={yesNoValue(editDetails.insurance || editDetails.insuranceIncluded)}
                      label="Страховка включена"
                      onClick={() => toggleDetailBool(detailKey(["insurance", "insuranceIncluded"], "insurance"))}
                    />
                    <ToggleChip
                      active={yesNoValue(editDetails.visa || editDetails.visaIncluded)}
                      label="Виза включена"
                      onClick={() => toggleDetailBool(detailKey(["visa", "visaIncluded"], "visaIncluded"))}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <TextField
                      label="Страна / город"
                      value={formatDetailValue(pickFirst(editDetails.directionCountry, editDetails.country, editForm.country))}
                      onChange={(value) => setDetailValue(detailKey(["directionCountry", "country"], "directionCountry"), value)}
                      placeholder="Стамбул, Турция"
                    />
                    <TextField
                      label="Вылет из"
                      value={formatDetailValue(editDetails.directionFrom)}
                      onChange={(value) => setDetailValue("directionFrom", value)}
                      placeholder="Ташкент"
                    />
                    <TextField
                      label="Направление"
                      value={formatDetailValue(editDetails.directionTo || editDetails.direction)}
                      onChange={(value) => setDetailValue(detailKey(["directionTo", "direction"], "directionTo"), value)}
                      placeholder="Анталия"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <TextField
                      label="Дата начала"
                      error={editErrors.startDate}
                      value={formatDetailValue(editDetails.startDate || editDetails.departureDate || editDetails.departureFlightDate)}
                      onChange={(value) => setDetailValue(detailKey(["startDate", "departureDate", "departureFlightDate"], "startDate"), value)}
                      placeholder="2026-09-23"
                    />
                    <TextField
                      label="Дата окончания"
                      error={editErrors.endDate}
                      value={formatDetailValue(editDetails.endDate || editDetails.returnFlightDate || editDetails.returnDate)}
                      onChange={(value) => setDetailValue(detailKey(["endDate", "returnFlightDate", "returnDate"], "endDate"), value)}
                      placeholder="2026-09-30"
                    />
                    <TextField
                      label="Ночей"
                      value={formatDetailValue(editDetails.nights)}
                      onChange={(value) => setDetailValue("nights", value)}
                      placeholder="7"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <TextField
                      label="Отель / объект"
                      value={formatDetailValue(editDetails.hotel || editDetails.eventName)}
                      onChange={(value) => setDetailValue(detailKey(["hotel", "eventName"], "hotel"), value)}
                      placeholder="Rixos Premium..."
                    />
                    <TextField
                      label="Категория номера"
                      value={formatDetailValue(editDetails.roomCategory || editDetails.accommodationCategory)}
                      onChange={(value) => {
                        setDetailValue("roomCategory", value);
                        setDetailValue("accommodationCategory", value);
                      }}
                    />
                    <TextField
                      label="Размещение"
                      value={formatDetailValue(editDetails.accommodation)}
                      onChange={(value) => setDetailValue("accommodation", value)}
                      placeholder="DBL / 2ADT+2CHD"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <TextField
                      label="Netto"
                      error={editErrors.netPrice}
                      value={formatDetailValue(pickFirst(editDetails.netPrice, editDetails.net_price, editForm.net_price))}
                      onChange={(value) => setDetailValue(detailKey(["netPrice", "net_price"], "netPrice"), value)}
                      placeholder="2850"
                    />
                    <TextField
                      label="Gross"
                      error={editErrors.grossPrice}
                      value={formatDetailValue(pickFirst(editDetails.grossPrice, editDetails.gross_price, editDetails.price, editForm.gross_price, editForm.price))}
                      onChange={(value) => setDetailValue(detailKey(["grossPrice", "gross_price", "price"], "grossPrice"), value)}
                      placeholder="3150"
                    />
                    <TextField
                      label="За 1 человека"
                      value={formatDetailValue(editDetails.pricePerPerson)}
                      onChange={(value) => {
                        setDetailValue("pricePerPerson", value);
                        setDetailValue("priceFor", value ? "за 1 человека" : "");
                      }}
                      placeholder="1425 USD"
                    />
                  </div>

                  {perPersonSuggestion && (
                    <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
                      <div className="font-semibold">
                        Автосчёт: {fmt(perPersonSuggestion.amount)} USD за 1 человека
                      </div>
                      <div className="mt-1 text-xs text-blue-700">
                        Gross разделён на {perPersonSuggestion.people} туристов.
                      </div>
                      <button
                        type="button"
                        onClick={applyPerPersonSuggestion}
                        className="mt-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                      >
                        Поставить в поле
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <TextField
                      label="Питание"
                      value={formatDetailValue(editDetails.food)}
                      onChange={(value) => setDetailValue("food", value)}
                      placeholder="AI / BB"
                    />
                    <TextField
                      label="Детали рейса"
                      value={formatDetailValue(editDetails.flightDetails || editDetails.flight_details || editDetails.flight_info)}
                      onChange={(value) => setDetailValue(detailKey(["flightDetails", "flight_details", "flight_info"], "flightDetails"), value)}
                      textarea
                      rows={3}
                    />
                  </div>
                </EditSection>

                <div>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <div className="text-sm font-semibold">
                        {t("moderation.all_detail_fields", {
                          defaultValue: "Дополнительные параметры",
                        })}
                      </div>
                      <div className="text-xs text-gray-500">
                        {t("moderation.all_detail_fields_hint", {
                          defaultValue:
                            "Поля из анкеты поставщика, которые не вошли в основные разделы.",
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={addDetailRow}
                      className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-black"
                    >
                      {t("common.add", { defaultValue: "Добавить" })}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {businessDetailRows.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                        {t("moderation.no_detail_fields", {
                          defaultValue: "Дополнительных полей пока нет.",
                        })}
                      </div>
                    ) : (
                      businessDetailRows.map((row) => (
                        <div
                          key={`detail-${row.index}`}
                          className="grid grid-cols-1 md:grid-cols-[220px_1fr_auto] gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3"
                        >
                          <div className="self-center">
                            <div className="text-sm font-semibold text-slate-800">{row.key ? detailLabel(row.key) : "Новое поле"}</div>
                            <input type="text" value={row.key} onChange={(e) => updateDetailRow(row.index, { key: e.target.value })} className="mt-1 w-full border-0 bg-transparent p-0 text-[10px] text-slate-400 focus:ring-0" placeholder="technicalKey" />
                          </div>
                          <textarea
                            value={row.value}
                            onChange={(e) =>
                              updateDetailRow(row.index, { value: e.target.value })
                            }
                            rows={String(row.value || "").length > 90 ? 3 : 1}
                            className="min-w-0 w-full border rounded-lg px-3 py-2 text-sm bg-white font-mono"
                            placeholder="Значение"
                          />
                          <button
                            type="button"
                            onClick={() => removeDetailRow(row.index)}
                            className="px-3 py-2 rounded-lg bg-rose-50 text-rose-700 text-sm font-semibold hover:bg-rose-100"
                          >
                            {t("common.delete", { defaultValue: "Удалить" })}
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {technicalDetailRows.length > 0 && (
                    <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-slate-600">
                        Служебные данные ({technicalDetailRows.length})
                      </summary>
                      <div className="mt-2 text-xs text-slate-500">
                        Эти значения сохраняются автоматически и не показываются в публичной карточке.
                      </div>
                    </details>
                  )}
                </div>

                <section id="moderation-editor-photos" ref={publicPhotosRef} aria-label="Фото карточки" className="scroll-mt-4 rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
                  <h2 className="text-sm font-bold text-slate-900">Фото карточки</h2>
                  <p className="mb-3 mt-1 text-xs text-slate-600">Эти фото видят клиенты на сайте и в Telegram. Proof используется для внутренней проверки — не загружайте сюда брони и документы с личными данными.</p>

                  {editImages.length > 0 ? (
                    <div className="flex flex-wrap gap-3 mb-3">
                      {editImages.map((img, idx) => (
                        <div
                          key={`${img}-${idx}`}
                          className="relative w-28 h-24 rounded-lg overflow-hidden border bg-gray-50"
                        >
                          <img
                            src={img}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => removeEditImage(idx)}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/75 text-white text-sm"
                            title={t("common.delete", { defaultValue: "Удалить" })}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500 mb-3">
                      {t("moderation.no_images", {
                        defaultValue: "Нет изображений",
                      })}
                    </div>
                  )}

                  <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className={`inline-flex cursor-pointer items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black ${imageUploadBusy ? "pointer-events-none opacity-60" : ""}`}>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          ref={publicPhotoInputRef}
                          onChange={uploadEditImages}
                          disabled={editSaving || proofUploadBusy || imageUploadBusy || editImages.length >= 20}
                          className="sr-only"
                        />
                        {imageUploadBusy ? "Загрузка..." : "Выбрать изображения"}
                      </label>
                      <span className="text-xs text-gray-500">
                        JPG, PNG или WebP, до 8 МБ. Добавлено {editImages.length} из 20.
                      </span>
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Или добавьте ссылки
                    </div>
                    <textarea
                      value={newImageUrl}
                      onChange={(e) => {
                        setNewImageUrl(e.target.value);
                        setImageAddError("");
                      }}
                      placeholder="https://... (можно несколько ссылок, каждая с новой строки)"
                      rows={3}
                      className="min-w-0 w-full border rounded-lg px-3 py-2"
                    />
                    <button
                      type="button"
                      onClick={addEditImage}
                      disabled={!newImageUrl.trim() || imageUploadBusy || editImages.length >= 20}
                      className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Добавить ссылки
                    </button>
                    {imageAddError && (
                      <div role="alert" className="text-sm font-medium text-rose-700">
                        {imageAddError}
                      </div>
                    )}
                  </div>
                </section>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    availability JSON
                  </label>
                  <textarea
                    value={editForm.availabilityJson}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        availabilityJson: e.target.value,
                      }))
                    }
                    rows={5}
                    className="min-w-0 w-full border rounded-lg px-3 py-2 font-mono text-xs"
                  />
                </div>
                </div>
                {proofComparison ? <aside id="moderation-proof-pane" className="sticky top-0 z-20 order-first w-full self-start lg:order-last lg:w-auto lg:max-h-[calc(94dvh-230px)] lg:overflow-y-auto">
                  <ServiceProofComparison serviceId={editItemId} images={editProofImages} form={editForm} details={editDetails} onOpenImage={setProofViewer} onManageProof={() => { setProofComparison(false); requestAnimationFrame(() => navigateEditor("proof",false)); }} onClose={() => setProofComparison(false)} />
                </aside> : <ModerationPreview serviceId={editItemId} form={editForm} details={editDetails} images={editImages} />}

              </div>
              </div>

              <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex sm:flex-wrap sm:items-center sm:justify-end md:px-6 md:py-4">
                <button
                  type="button"
                  onClick={requestCloseEditor}
                  disabled={editSaving || imageUploadBusy || proofUploadBusy}
                  className="px-4 py-2 rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200"
                >
                  {t("common.cancel", { defaultValue: "Отмена" })}
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={editSaving || editLoading || imageUploadBusy || proofUploadBusy}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {editSaving
                    ? t("common.saving", { defaultValue: "Сохранение..." })
                    : t("common.save", { defaultValue: "Сохранить" })}
                </button>
                <button
                  type="button"
                  onClick={() => setTelegramPreviewOpen(true)}
                  disabled={editLoading || editSaving || proofUploadBusy || imageUploadBusy}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-black"
                >
                  <span className="sm:hidden">Telegram</span>
                  <span className="hidden sm:inline">Предпросмотр Telegram</span>
                </button>
                <button
                  type="button"
                  onClick={openCorrectionFromEdit}
                  disabled={editSaving || editLoading || imageUploadBusy || proofUploadBusy || actionBusy === editItemId}
                  className="px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  Запросить исправление
                </button>
                <button
                  type="button"
                  onClick={requestPublishFromEdit}
                  disabled={editSaving || editLoading || imageUploadBusy || proofUploadBusy}
                  className="col-span-2 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                  title={!publishReady ? "Есть предупреждения: перед публикацией будет подтверждение" : ""}
                >
                  {editSaving
                    ? t("common.saving", { defaultValue: "Сохранение..." })
                    : "Сохранить и опубликовать"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {confirmConflictReload && createPortal(<div className="fixed inset-0 z-[6100] flex items-center justify-center bg-slate-950/60 p-4"><div role="alertdialog" aria-modal="true" aria-labelledby="reload-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"><h2 id="reload-title" className="text-lg font-bold">Заменить черновик?</h2><p className="mt-2 text-sm text-slate-600">Несохранённые изменения будут заменены актуальными данными с сервера.</p><div className="mt-4 flex flex-col gap-2"><button type="button" onClick={() => openEdit(editItemId)} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">Загрузить и заменить черновик</button><button type="button" autoFocus onClick={() => setConfirmConflictReload(false)} className="rounded-xl border px-4 py-2 text-sm">Вернуться к черновику</button></div></div></div>, document.body)}

      {discardConfirmOpen && createPortal(
        <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-slate-950/60 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-description" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 id="unsaved-title" className="text-lg font-bold text-slate-900">Есть несохранённые изменения</h2>
            <p id="unsaved-description" className="mt-2 text-sm text-slate-600">Сохраните изменения перед закрытием или вернитесь к редактированию.</p>
            <div className="mt-5 flex flex-col gap-2">
              <button type="button" disabled={editSaving} onClick={() => { setDiscardConfirmOpen(false); saveEdit(); }} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{editSaving ? "Сохраняем…" : "Сохранить и закрыть"}</button>
              <button type="button" autoFocus disabled={editSaving} onClick={() => setDiscardConfirmOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold">Продолжить редактирование</button>
              <button type="button" disabled={editSaving} onClick={discardEditor} className="rounded-xl px-4 py-2 text-sm font-semibold text-rose-700">Закрыть без сохранения</button>
            </div>
          </div>
        </div>, document.body
      )}

      {telegramPreviewOpen && (
        <TelegramPreviewModal
          serviceId={editItemId}
          form={editForm}
          details={editDetails}
          images={editImages}
          onClose={() => setTelegramPreviewOpen(false)}
          onPublish={() => saveEdit({ approveAfter: true })}
          publishDisabled={!publishReady || editLoading}
          saving={editSaving}
        />
      )}

      <PublishConfirmModal
        target={publishConfirm?.service || null}
        warnings={publishConfirm?.warnings || []}
        clean={publishConfirm?.clean || false}
        saving={Boolean(actionBusy === publishConfirm?.service?.id || editSaving)}
        onCancel={() => setPublishConfirm(null)}
        onConfirm={confirmPublish}
      />

      <PublishResultModal
        result={publishResult}
        saving={rebroadcastBusy || editSaving || Boolean(actionBusy)}
        nextServiceId={autoNext && tab==="pending" && nextAfterPublish?.key===queueKey ? nextAfterPublish.id : null}
        onClose={() => { setPublishResult(null); const next=nextAfterPublish;setNextAfterPublish(null);if(next?.id && next.key===queueKey && autoNext && tab==="pending") openEdit(next.id); }}
        onRetry={retryBroadcast}
      />

      <ProofLightbox
        image={proofViewer}
        onClose={() => setProofViewer(null)}
      />
    </>
  );
}
