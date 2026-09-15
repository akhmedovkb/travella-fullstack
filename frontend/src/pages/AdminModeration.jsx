// frontend/src/pages/AdminModeration.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { tSuccess, tError, tInfo } from "../shared/toast";

const fmt = (n) => new Intl.NumberFormat().format(Number(n || 0));
const API_BASE = import.meta.env.VITE_API_BASE_URL;

const REJECT_REASON_OPTIONS = [
  { code: "NO_PROOF", label: "Нет proof/подтверждения", text: "Загрузите фото или документ, подтверждающий отказную услугу." },
  { code: "BAD_PROOF", label: "Proof нечитаемый", text: "Proof нечитаемый или не подтверждает данные услуги. Загрузите более понятное подтверждение." },
  { code: "NO_DATES", label: "Не хватает дат", text: "Укажите корректные даты услуги: вылет/заезд/дату мероприятия." },
  { code: "BAD_PRICE", label: "Нужно уточнить цену", text: "Проверьте цену и укажите, за одного человека/билет или за весь пакет." },
  { code: "MISSING_DETAILS", label: "Не хватает деталей", text: "Добавьте недостающие детали услуги, чтобы клиент мог принять решение." },
  { code: "WRONG_CATEGORY", label: "Неверная категория", text: "Услуга выбрана не в той категории. Исправьте категорию и отправьте повторно." },
  { code: "DUPLICATE", label: "Похоже на дубль", text: "Похожая услуга уже есть. Обновите существующую карточку или уточните отличие." },
  { code: "OTHER", label: "Другая причина", text: "Уточните данные услуги и отправьте её на модерацию повторно." },
];

function isRefusedCategory(cat) {
  return String(cat || "").toLowerCase().startsWith("refused_");
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
  if (Array.isArray(images)) return images.filter(Boolean);

  if (typeof images === "string") {
    const parsed = parseJsonSafe(images, null);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
    if (parsed && typeof parsed === "string") return [parsed];
    return images.trim() ? [images.trim()] : [];
  }

  return [];
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
  if (!image) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[4000] bg-black/85 flex items-center justify-center p-4"
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
          aria-label="Close"
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
  actionBusy,
  t,
  onOpenProof,
}) {
  const s = item || {};
  const d = normalizeDetails(s.details);
  const images = normalizeImages(s.images);
  const proofImages = normalizeImages(d.proofImages);
  const hasProof = proofImages.length > 0;
  const cardAnalysis = analysis || analyzeModerationService(s);
  const topIssues = [
    ...cardAnalysis.blockingIssues,
    ...cardAnalysis.missingRequired.map((item) => ({
      key: `missing-${item.key}`,
      title: `Нет: ${item.label}`,
      text: "",
      blocking: true,
    })),
    ...cardAnalysis.warningIssues,
  ].slice(0, 4);

  const cover = pickFirst(
    images[0],
    proofImages[0],
    d.image,
    d.imageUrl,
    d.cover,
    d.coverImage,
    d.photo,
    d.photoUrl
  );

  const prov = providerFrom(s);
  const isRefused = isRefusedCategory(s.category);
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

  const dateFrom = pickFirst(
    d.departureFlightDate,
    d.departureDate,
    d.startFlightDate,
    d.startDate,
    d.checkInDate,
    d.eventDate
  );

  const dateTo = pickFirst(
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

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm flex flex-col relative">
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
          ) : null}
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

          {(d.departureFlightDate ||
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

          {flightType && (
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

          {(d.flightDetails || d.flight_details || d.flight_info) && (
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

          {Object.keys(d).some((k) => !prettyKeys.has(k)) && (
            <div className="mt-2 border-t border-gray-200 pt-1">
              <div className="text-[11px] font-semibold text-gray-500 mb-1">
                {t("moderation.other_fields", {
                  defaultValue: "Прочие поля",
                })}
              </div>
              <div className="space-y-0.5 text-[11px]">
                {Object.entries(d)
                  .filter(([key]) => !prettyKeys.has(key))
                  .map(([key, value]) => (
                    <div key={key} className="flex gap-1">
                      <div className="text-gray-500 min-w-[90px] break-all">
                        {key}:
                      </div>
                      <div className="break-all">
                        {typeof value === "boolean"
                          ? value
                            ? yesLabel
                            : noLabel
                          : Array.isArray(value)
                          ? value.join(", ")
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

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onEdit(s.id)}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
        >
          {t("common.edit", { defaultValue: "Редактировать" })}
        </button>

        <button
          type="button"
          onClick={() => onApprove(s.id)}
          disabled={actionBusy === s.id}
          className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          {actionBusy === s.id
            ? t("common.saving", { defaultValue: "Сохранение..." })
            : tab === "rejected"
            ? t("moderation.confirm", { defaultValue: "Подтвердить" })
            : t("moderation.approve", { defaultValue: "Approve" })}
        </button>

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

function EditSection({ title, children }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 text-sm font-semibold text-gray-900">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder = "", textarea = false, rows = 2 }) {
  const commonProps = {
    value,
    onChange: (e) => onChange(e.target.value),
    placeholder,
    className: "w-full border rounded-lg px-3 py-2 text-sm bg-white",
  };

  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
        {label}
      </span>
      {textarea ? <textarea {...commonProps} rows={rows} /> : <input {...commonProps} type="text" />}
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
  const cover = pickFirst(
    images?.[0],
    normalizeImages(details.proofImages)[0],
    details.image,
    details.imageUrl,
    details.cover,
    details.coverImage,
    details.photo,
    details.photoUrl
  );
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
  const hasPhoto = normalizeImages(images).length > 0 || hasText(details.image) || hasText(details.imageUrl);
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
      provider.telegram_refused_chat_id ||
      provider.telegram_chat_id ||
      "",
    telegram_web_chat_id:
      svc.telegram_web_chat_id || provider.telegram_web_chat_id || "",
    telegram_chat_id: svc.telegram_chat_id || provider.telegram_chat_id || "",
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
  const priority =
    (blockingIssues.length ? 100 : 0) +
    missingRequired.length * 12 +
    warningIssues.length * 3 +
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
  return analysis.dangerIssues.some((issue) => issue.key === filter);
}

function QueuePanel({ items, filter, onFilterChange }) {
  const metrics = getQueueMetrics(items);
  const filters = [
    { key: "all", label: "Все", count: metrics.total, tone: "slate" },
    { key: "ready", label: "Готовы", count: metrics.ready, tone: "emerald" },
    { key: "needFix", label: "Нужно исправить", count: metrics.needFix, tone: "rose" },
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

function DangerIssuesPanel({ issues }) {
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
  const dateFrom = pickFirst(
    details.departureFlightDate,
    details.departureDate,
    details.startFlightDate,
    details.startDate,
    details.checkInDate,
    details.eventDate
  );
  const dateTo = pickFirst(
    details.returnFlightDate,
    details.endFlightDate,
    details.endDate,
    details.checkOutDate
  );
  const nights = pickFirst(details.nights, details.nightsCount);
  const grossPrice = pickFirst(details.grossPrice, details.gross_price, details.price, form.price);
  const netPrice = pickFirst(details.netPrice, details.net_price, details.priceNet, details.price_net);
  const priceFor = pickFirst(details.priceFor, details.pricePer, details.priceType);
  const perPerson = pickFirst(details.pricePerPerson);
  const isRefused = form.category?.includes("refused") || yesNoValue(details.isRefused);
  const proofImages = normalizeImages(details.proofImages);
  const photos = normalizeImages(images);
  const hasPhoto = photos.length > 0 || hasText(details.image) || hasText(details.imageUrl);
  const included = [
    yesNoValue(details.flightIncluded || details.airTickets || details.aviaTickets) ? "авиабилеты" : null,
    hotel ? "проживание" : null,
    details.food ? `питание ${details.food}` : null,
    yesNoValue(details.transferIncluded || details.hasTransfer || details.transfer) ? "трансфер" : null,
    yesNoValue(details.insurance || details.insuranceIncluded) ? "страховка" : null,
    yesNoValue(details.visa || details.visaIncluded) ? "виза" : null,
  ].filter(Boolean);
  const flightDetails = pickFirst(details.flightDetails, details.flight_details, details.flight_info);
  const providerName = pickFirst(form.provider_name, details.providerName, details.supplierName);
  const contactVisible = hasText(pickFirst(form.telegram_refused_chat_id, form.telegram_web_chat_id, form.telegram_chat_id));

  const lines = [
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
      flightDetails ? "✈️ Детали рейса" : null,
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
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
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
  const dateFrom = pickFirst(
    details.departureFlightDate,
    details.departureDate,
    details.startFlightDate,
    details.startDate,
    details.checkInDate,
    details.eventDate
  );
  const dateTo = pickFirst(
    details.returnFlightDate,
    details.endFlightDate,
    details.endDate,
    details.checkOutDate
  );
  const grossPrice = pickFirst(details.grossPrice, details.gross_price, details.price, form.price);
  const netPrice = pickFirst(details.netPrice, details.net_price, details.priceNet, details.price_net);
  const proofImages = normalizeImages(details.proofImages);
  const cover = pickFirst(
    images?.[0],
    proofImages[0],
    details.image,
    details.imageUrl,
    details.cover,
    details.coverImage,
    details.photo,
    details.photoUrl
  );
  const included = [
    details.flightIncluded || details.airTickets || details.aviaTickets ? "авиабилеты" : null,
    details.accommodation || details.hotel ? "проживание" : null,
    details.food ? `питание ${details.food}` : null,
    details.transfer ? "трансфер" : null,
    details.insurance ? "страховка" : null,
    details.visaIncluded ? "виза" : null,
  ].filter(Boolean);
  const isRefused = form.category?.includes("refused") || yesNoValue(details.isRefused);
  const priceAudience = pickFirst(details.priceFor, details.pricePer, details.priceType);
  const urgencyBadge = pickFirst(details.expiration, details.expiration_at, details.expiration_ts)
    ? "⚡ срочно"
    : "⏳ срок не указан";

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
          <div className="font-bold">📍 {isRefused ? "ОТКАЗНОЙ ТУР" : "УСЛУГА"} #{serviceId}</div>
          <div className="font-semibold">📝 {title}</div>
          {direction && <div>🌎 {direction}</div>}
          {details.directionFrom && <div>🛫 Вылет из: <b>{details.directionFrom}</b></div>}
          {hotel && <div>🏨 {hotel}</div>}
          {(dateFrom || dateTo) && (
            <div>
              📅 {dateFrom || "—"} {dateTo ? `→ ${dateTo}` : ""}
            </div>
          )}
          {grossPrice && (
            <div>
              💵 <b>{fmt(grossPrice)} USD</b>
              {priceAudience ? <span className="text-xs"> · {priceAudience}</span> : null}
              {netPrice ? <span className="text-xs"> · Netto {fmt(netPrice)}</span> : null}
            </div>
          )}
          {details.pricePerPerson && <div>👤 за 1 человека: {details.pricePerPerson}</div>}
          {included.length > 0 && (
            <div className="pt-2">
              <div className="font-semibold">✅ Включено:</div>
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

export default function AdminModeration() {
  const { t } = useTranslation();

  const [tab, setTab] = useState("pending");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ pending: 0, rejected: 0 });
  const [proofViewer, setProofViewer] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectForm, setRejectForm] = useState({ reasonCode: "NO_PROOF", reason: REJECT_REASON_OPTIONS[0].text });
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editItemId, setEditItemId] = useState(null);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    category: "",
    price: "",
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
  const [moderationEvents, setModerationEvents] = useState([]);
  const [actionBusy, setActionBusy] = useState(null);
  const [telegramPreviewOpen, setTelegramPreviewOpen] = useState(false);
  const [queueFilter, setQueueFilter] = useState("all");

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

  async function fetchList(which) {
    const url =
      which === "pending"
        ? `${API_BASE}/api/admin/services/pending`
        : `${API_BASE}/api/admin/services/rejected`;
    const res = await axios.get(url, cfg);
    return Array.isArray(res.data) ? res.data : res.data?.items || [];
  }

  const load = async (which = tab) => {
    setLoading(true);
    try {
      const data = await fetchList(which);
      setItems(data);
    } catch (e) {
      tError(
        t("moderation.load_error", {
          defaultValue: "Не удалось загрузить список",
        })
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const refreshCounts = async () => {
    try {
      const [p, r] = await Promise.all([
        axios.get(`${API_BASE}/api/admin/services/pending`, cfg),
        axios.get(`${API_BASE}/api/admin/services/rejected`, cfg),
      ]);
      const pending = (Array.isArray(p.data) ? p.data : p.data?.items || [])
        .length;
      const rejected = (Array.isArray(r.data) ? r.data : r.data?.items || [])
        .length;
      setCounts({ pending, rejected });
    } catch {}
  };

  useEffect(() => {
    load("pending");
    refreshCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(tab);
    setQueueFilter("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const approve = async (id) => {
    setActionBusy(id);
    try {
      await axios.post(`${API_BASE}/api/admin/services/${id}/approve`, {}, cfg);
      tSuccess(t("moderation.approved", { defaultValue: "Опубликовано" }));
      setItems((prev) => prev.filter((x) => x.id !== id));
      setCounts((c) => ({
        ...c,
        [tab]: Math.max(0, (c[tab] || 0) - 1),
      }));
    } catch {
      tError(
        t("moderation.approve_error", { defaultValue: "Ошибка approve" })
      );
    } finally {
      setActionBusy(null);
    }
  };

  const openReject = (svc, reason = "", reasonCode = "") => {
    const first =
      REJECT_REASON_OPTIONS.find((x) => x.code === reasonCode) ||
      REJECT_REASON_OPTIONS[0];
    setRejectTarget(svc);
    setRejectForm({ reasonCode: first.code, reason: reason || first.text });
  };

  const changeRejectReasonCode = (code) => {
    const opt = REJECT_REASON_OPTIONS.find((x) => x.code === code) || REJECT_REASON_OPTIONS[REJECT_REASON_OPTIONS.length - 1];
    setRejectForm({ reasonCode: opt.code, reason: opt.text });
  };

  const reject = async (id, reason, reasonCode = "OTHER") => {
    if (!reason || !reason.trim()) {
      return tInfo(
        t("moderation.enter_reason_short", {
          defaultValue: "Укажите причину",
        })
      );
    }

    setActionBusy(id);
    try {
      await axios.post(
        `${API_BASE}/api/admin/services/${id}/reject`,
        { reason, reasonCode },
        cfg
      );
      tSuccess(t("moderation.rejected", { defaultValue: "Отклонено" }));
      setRejectTarget(null);
      setEditOpen(false);
      setTelegramPreviewOpen(false);
      setEditItemId(null);
      setModerationEvents([]);
      setItems((prev) => prev.filter((x) => x.id !== id));
      setCounts((c) => ({
        ...c,
        pending: Math.max(0, (c.pending || 0) - 1),
        rejected: (c.rejected || 0) + 1,
      }));
    } catch {
      tError(t("moderation.reject_error", { defaultValue: "Ошибка reject" }));
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
      setItems((prev) => prev.filter((x) => x.id !== id));
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
    setEditLoading(true);
    try {
      const [res, eventsRes] = await Promise.all([
        axios.get(`${API_BASE}/api/admin/services/${id}`, cfg),
        axios.get(`${API_BASE}/api/admin/services/${id}/moderation-events`, cfg).catch(() => ({ data: { items: [] } })),
      ]);
      const s = res.data || {};
      setModerationEvents(Array.isArray(eventsRes?.data?.items) ? eventsRes.data.items : []);
      const details = normalizeDetails(s.details);
      const images = normalizeImages(s.images);
      const availability = Array.isArray(s.availability)
        ? s.availability
        : parseJsonSafe(s.availability, []) || [];
      setEditDetailsRows(detailsToRows(details));
      setEditImages(images);
      setNewImageUrl("");

      setEditItemId(id);
      setEditForm({
        title: s.title || "",
        description: s.description || "",
        category: s.category || "",
        price: s.price ?? "",
        vehicle_model: s.vehicle_model || "",
        telegram_refused_chat_id: s.telegram_refused_chat_id || "",
        telegram_web_chat_id: s.telegram_web_chat_id || "",
        telegram_chat_id: s.telegram_chat_id || "",
        imagesJson: JSON.stringify(images, null, 2),
        availabilityJson: JSON.stringify(availability, null, 2),
      });
      setEditOpen(true);
    } catch {
      tError(
        t("moderation.load_edit_error", {
          defaultValue: "Не удалось загрузить услугу для редактирования",
        })
      );
    } finally {
      setEditLoading(false);
    }
  };

    const removeEditImage = (idx) => {
    setEditImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const addEditImage = () => {
    const list = String(newImageUrl || "")
      .split(/\r?\n|,/)
      .map((x) => x.trim())
      .filter(Boolean);

    if (!list.length) return;

    setEditImages((prev) => [...prev, ...list]);
    setNewImageUrl("");
  };

  const updateDetailRow = (idx, patch) => {
    setEditDetailsRows((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row))
    );
  };

  const setDetailValue = (key, value) => {
    setEditDetailsRows((prev) => {
      const idx = prev.findIndex((row) => row.key === key);
      if (idx === -1) return [...prev, { key, value }];
      return prev.map((row, i) => (i === idx ? { ...row, value } : row));
    });
  };

  const removeDetailRow = (idx) => {
    setEditDetailsRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const addDetailRow = () => {
    setEditDetailsRows((prev) => [...prev, { key: "", value: "" }]);
  };
  
  const saveEdit = async ({ approveAfter = false } = {}) => {
    const details = rowsToDetails(editDetailsRows);
    const images = Array.isArray(editImages)
      ? editImages.filter((x) => String(x || "").trim())
      : [];
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

    if (approveAfter && !publishReady) {
      return tInfo("Сначала заполните обязательные пункты чеклиста готовности.");
    }

    setEditSaving(true);
    try {
      await axios.put(
        `${API_BASE}/api/admin/services/${editItemId}`,
        {
          title: editForm.title,
          description: editForm.description,
          category: editForm.category,
          price: editForm.price === "" ? null : editForm.price,
          vehicle_model: editForm.vehicle_model,
          telegram_refused_chat_id: editForm.telegram_refused_chat_id,
          telegram_web_chat_id: editForm.telegram_web_chat_id,
          telegram_chat_id: editForm.telegram_chat_id,
          details,
          images,
          availability,
        },
        cfg
      );

      if (approveAfter) {
        await axios.post(`${API_BASE}/api/admin/services/${editItemId}/approve`, {}, cfg);
      }

      tSuccess(
        t("moderation.saved", {
          defaultValue: approveAfter
            ? "Изменения сохранены и услуга опубликована"
            : "Изменения сохранены",
        })
      );
      setEditOpen(false);
      setTelegramPreviewOpen(false);
      setEditItemId(null);
      setModerationEvents([]);
      await load(tab);
      await refreshCounts();
    } catch {
      tError(
        t("moderation.save_error", {
          defaultValue: "Не удалось сохранить изменения",
        })
      );
    } finally {
      setEditSaving(false);
    }
  };

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
      },
      reason,
      reasonCode
    );
  };
  const openCorrectionFromCard = (svc, analysis) => {
    const currentAnalysis = analysis || analyzeModerationService(svc);
    const reason = buildCorrectionReason(
      currentAnalysis.readinessItems,
      currentAnalysis.dangerIssues
    );
    const reasonCode = correctionReasonCode(
      currentAnalysis.readinessItems,
      currentAnalysis.dangerIssues
    );
    openReject(svc, reason, reasonCode);
  };
  const displayedItems = items
    .filter((it) => matchesQueueFilter(it, queueFilter))
    .sort((a, b) => {
      const aa = analyzeModerationService(a);
      const bb = analyzeModerationService(b);
      if (bb.priority !== aa.priority) return bb.priority - aa.priority;
      const at = new Date(a.created_at || a.submitted_at || a.updated_at || 0).getTime();
      const bt = new Date(b.created_at || b.submitted_at || b.updated_at || 0).getTime();
      return bt - at;
    });

  return (
    <>
      <div className="max-w-6xl mx-auto p-4">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">
            {t("moderation.title", { defaultValue: "Модерация услуг" })}
          </h1>
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

        <div className="mb-5 inline-flex rounded-full bg-white shadow-sm overflow-hidden">
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
              {counts.pending || 0}
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
              {counts.rejected || 0}
            </span>
          </button>
        </div>

        {!loading && items.length > 0 && (
          <QueuePanel
            items={items}
            filter={queueFilter}
            onFilterChange={setQueueFilter}
          />
        )}

        {loading ? (
          <div className="text-gray-600">
            {t("common.loading", { defaultValue: "Загрузка…" })}
          </div>
        ) : items.length === 0 ? (
          <div className="text-gray-600">
            {t("moderation.empty", { defaultValue: "Нет элементов" })}
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
                onApprove={approve}
                onReject={reject}
                onRejectClick={openReject}
                onCorrectionClick={openCorrectionFromCard}
                onUnpublish={unpublish}
                actionBusy={actionBusy}
                onOpenProof={setProofViewer}
                t={t}
              />
              );
            })}
          </div>
        )}
      </div>
      {rejectTarget &&
        createPortal(
          <div className="fixed inset-0 z-[5200] bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div>
                  <div className="text-lg font-semibold">
                    {t("moderation.reject_modal_title", { defaultValue: "Отклонить / запросить исправление" })}
                  </div>
                  <div className="mt-1 text-sm text-gray-500">
                    #{rejectTarget.id} · {rejectTarget.title || rejectTarget.category || "service"}
                  </div>
                </div>
                <button type="button" onClick={() => setRejectTarget(null)} className="text-2xl leading-none text-gray-500 hover:text-black">×</button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {t("moderation.reject_reason_type", { defaultValue: "Тип причины" })}
                  </label>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {REJECT_REASON_OPTIONS.slice(0, 6).map((opt) => (
                      <button
                        key={`quick-${opt.code}`}
                        type="button"
                        onClick={() => changeRejectReasonCode(opt.code)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          rejectForm.reasonCode === opt.code
                            ? "border-rose-300 bg-rose-50 text-rose-700"
                            : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <select
                    value={rejectForm.reasonCode}
                    onChange={(e) => changeRejectReasonCode(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    {REJECT_REASON_OPTIONS.map((opt) => (
                      <option key={opt.code} value={opt.code}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {t("moderation.reject_reason_message", { defaultValue: "Сообщение поставщику" })}
                  </label>
                  <textarea
                    value={rejectForm.reason}
                    onChange={(e) => setRejectForm((prev) => ({ ...prev, reason: e.target.value }))}
                    rows={5}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="Что нужно исправить?"
                  />
                </div>

                <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 border border-amber-200">
                  {t("moderation.reject_modal_hint", { defaultValue: "После отклонения поставщик увидит причину и сможет исправить карточку, затем отправить её на модерацию повторно." })}
                </div>
              </div>

              <div className="flex justify-end gap-2 px-5 py-4 border-t">
                <button type="button" onClick={() => setRejectTarget(null)} className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold">
                  {t("common.cancel", { defaultValue: "Отмена" })}
                </button>
                <button
                  type="button"
                  onClick={() => reject(rejectTarget.id, rejectForm.reason, rejectForm.reasonCode)}
                  className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700"
                >
                  {t("moderation.reject_and_notify", { defaultValue: "Отклонить и уведомить" })}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {editOpen &&
        createPortal(
          <div className="fixed inset-0 z-[5000] bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-7xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4 border-b">
                <div className="text-lg font-semibold">
                  {t("moderation.edit_service", {
                    defaultValue: "Редактирование услуги",
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="text-2xl leading-none text-gray-500 hover:text-black"
                >
                  ×
                </button>
              </div>

              <div className="p-5 grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5">
                <div className="space-y-4">
                  {moderationEvents.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 text-sm font-semibold text-slate-700">
                      {t("moderation.history", { defaultValue: "История модерации" })}
                    </div>
                    <div className="space-y-1 text-xs text-slate-600">
                      {moderationEvents.slice(0, 5).map((ev) => (
                        <div key={ev.id} className="flex flex-wrap gap-x-2 gap-y-1">
                          <span className="font-semibold">{ev.action}</span>
                          {ev.reason_code ? <span>· {ev.reason_code}</span> : null}
                          {ev.reason ? <span>· {ev.reason}</span> : null}
                          {ev.created_at ? <span>· {formatDt(ev.created_at)}</span> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                  )}
                <ReadinessChecklist items={readinessItems} />
                <DangerIssuesPanel issues={dangerIssues} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Title
                    </label>
                    <input
                      type="text"
                      value={editForm.title}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, title: e.target.value }))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Category
                    </label>
                    <input
                      type="text"
                      value={editForm.category}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, category: e.target.value }))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Price
                    </label>
                    <input
                      type="text"
                      value={editForm.price}
                      onChange={(e) =>
                        setEditForm((prev) => ({ ...prev, price: e.target.value }))
                      }
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Vehicle model
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
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>

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
                      className="w-full border rounded-lg px-3 py-2"
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
                      className="w-full border rounded-lg px-3 py-2"
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
                      className="w-full border rounded-lg px-3 py-2"
                      placeholder="70659475"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Description
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
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>

                <EditSection title="Быстрая правка карточки">
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
                      value={formatDetailValue(editDetails.directionCountry || editDetails.location)}
                      onChange={(value) => setDetailValue(detailKey(["directionCountry", "location"], "directionCountry"), value)}
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
                      value={formatDetailValue(editDetails.startDate || editDetails.departureDate || editDetails.departureFlightDate)}
                      onChange={(value) => setDetailValue(detailKey(["startDate", "departureDate", "departureFlightDate"], "startDate"), value)}
                      placeholder="2026-09-23"
                    />
                    <TextField
                      label="Дата окончания"
                      value={formatDetailValue(editDetails.endDate || editDetails.returnFlightDate)}
                      onChange={(value) => setDetailValue(detailKey(["endDate", "returnFlightDate"], "endDate"), value)}
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
                      label="Размещение"
                      value={formatDetailValue(editDetails.roomCategory || editDetails.accommodation)}
                      onChange={(value) => setDetailValue(detailKey(["roomCategory", "accommodation"], "roomCategory"), value)}
                      placeholder="DBL / 2ADT+2CHD"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <TextField
                      label="Netto"
                      value={formatDetailValue(editDetails.netPrice || editDetails.net_price)}
                      onChange={(value) => setDetailValue(detailKey(["netPrice", "net_price"], "netPrice"), value)}
                      placeholder="2850"
                    />
                    <TextField
                      label="Gross"
                      value={formatDetailValue(editDetails.grossPrice || editDetails.gross_price || editDetails.price)}
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
                          defaultValue: "Все поля карточки",
                        })}
                      </div>
                      <div className="text-xs text-gray-500">
                        {t("moderation.all_detail_fields_hint", {
                          defaultValue:
                            "Меняйте ключ и значение. Для списков/объектов можно вставить JSON.",
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
                    {editDetailsRows.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500">
                        {t("moderation.no_detail_fields", {
                          defaultValue: "Дополнительных полей пока нет.",
                        })}
                      </div>
                    ) : (
                      editDetailsRows.map((row, idx) => (
                        <div
                          key={`detail-${idx}`}
                          className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2"
                        >
                          <input
                            type="text"
                            value={row.key}
                            onChange={(e) =>
                              updateDetailRow(idx, { key: e.target.value })
                            }
                            className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                            placeholder="fieldName"
                          />
                          <textarea
                            value={row.value}
                            onChange={(e) =>
                              updateDetailRow(idx, { value: e.target.value })
                            }
                            rows={String(row.value || "").length > 90 ? 3 : 1}
                            className="w-full border rounded-lg px-3 py-2 text-sm bg-white font-mono"
                            placeholder="Значение"
                          />
                          <button
                            type="button"
                            onClick={() => removeDetailRow(idx)}
                            className="px-3 py-2 rounded-lg bg-rose-50 text-rose-700 text-sm font-semibold hover:bg-rose-100"
                          >
                            {t("common.delete", { defaultValue: "Удалить" })}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">
                    {t("moderation.images", { defaultValue: "Изображения" })}
                  </label>

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

                  <div className="space-y-2">
                    <textarea
                      value={newImageUrl}
                      onChange={(e) => setNewImageUrl(e.target.value)}
                      placeholder="https://... (можно несколько ссылок, каждая с новой строки)"
                      rows={3}
                      className="w-full border rounded-lg px-3 py-2"
                    />
                    <button
                      type="button"
                      onClick={addEditImage}
                      className="px-4 py-2 rounded-lg bg-gray-900 text-white hover:bg-black"
                    >
                      {t("common.add", { defaultValue: "Добавить" })}
                    </button>
                  </div>
                </div>
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
                    className="w-full border rounded-lg px-3 py-2 font-mono text-xs"
                  />
                </div>
                </div>
                <ModerationPreview
                  serviceId={editItemId}
                  form={editForm}
                  details={editDetails}
                  images={editImages}
                />
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="px-4 py-2 rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200"
                >
                  {t("common.cancel", { defaultValue: "Отмена" })}
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={editSaving || editLoading}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {editSaving
                    ? t("common.saving", { defaultValue: "Сохранение..." })
                    : t("common.save", { defaultValue: "Сохранить" })}
                </button>
                <button
                  type="button"
                  onClick={() => setTelegramPreviewOpen(true)}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-black"
                >
                  Предпросмотр Telegram
                </button>
                <button
                  type="button"
                  onClick={openCorrectionFromEdit}
                  disabled={editSaving || editLoading || actionBusy === editItemId}
                  className="px-4 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  Запросить исправление
                </button>
                <button
                  type="button"
                  onClick={() => saveEdit({ approveAfter: true })}
                  disabled={editSaving || editLoading || !publishReady}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                  title={!publishReady ? "Заполните обязательные пункты чеклиста" : ""}
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

      <ProofLightbox
        image={proofViewer}
        onClose={() => setProofViewer(null)}
      />
    </>
  );
}
