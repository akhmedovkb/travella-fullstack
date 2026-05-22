// frontend/src/pages/DashboardServices.jsx
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import ProviderServicesCard from "../components/ProviderServicesCard";
import ConfirmModal from "../components/ConfirmModal";
import { tSuccess, tError, tWarn } from "../shared/toast";

const DEFAULT_DETAILS = {
  directionCountry: "",
  directionFrom: "",
  directionTo: "",
  startDate: "",
  endDate: "",
  hotel: "",
  accommodationCategory: "",
  accommodation: "",
  adt: "",
  chd: "",
  inf: "",
  food: "",
  halal: false,
  transfer: "",
  changeable: false,
  visaIncluded: false,
  insuranceIncluded: false,
  earlyCheckIn: false,
  arrivalFastTrack: false,
  netPrice: "",
  grossPrice: "",
  expiration: "",
  isActive: true,
  flightType: "one_way",
  airline: "",
  returnDate: "",
  startFlightDate: "",
  endFlightDate: "",
  flightDetails: "",
  eventName: "",
  eventCategory: "",
  location: "",
  ticketDetails: "",
  description: "",
  visaCountry: "",
  proofImages: [],
  flexibleDates: false,
  duration: "",
  tourFormat: "group",
  program: "",
  included: "",
  notIncluded: "",
  minPax: "",
  maxPax: "",
  guideLanguage: "",
  meetingPoint: "",
  guideIncluded: true,
  transportIncluded: false,
  cancellationPolicy: "",
};

const EXTENDED_AGENT_CATEGORIES = [
  "refused_tour",
  "author_tour",
  "refused_hotel",
  "refused_flight",
  "refused_event_ticket",
  "visa_support",
];

const HISTORICAL_REFUSED_CATEGORIES = [
  "refused_tour",
  "author_tour",
  "refused_hotel",
  "refused_flight",
  "refused_event_ticket",
];

const foodOptions = ["BB", "HB", "FB", "AI", "UAI", "HALAL"];
const transferOptions = ["group", "individual", "none"];

const FLIGHT_DETAILS_EXAMPLE =
  "15MAY HH-9911 TASDXB 18:00 21:00\n22MAY HH-9912 DXBTAS 22:00 05:00\n\n23KG/8KG";

function normalizeFlightDetails(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim();
}

function validateFlightDetailsFormat(value) {
  const normalized = normalizeFlightDetails(value);
  if (!normalized) return false;

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;

  const baggageLine = lines[lines.length - 1];
  const flightLines = lines.slice(0, -1);

  const flightLineRe = /^\d{2}[A-Z]{3}\s+[A-Z0-9]{2,3}-?\d{2,5}\s+[A-Z]{6}\s+\d{2}:\d{2}\s+\d{2}:\d{2}$/i;
  const baggageRe = /^\d{1,2}\s*KG\s*\/\s*\d{1,2}\s*KG$/i;

  return flightLines.every((line) => flightLineRe.test(line)) && baggageRe.test(baggageLine);
}

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function parseMoney(value) {
  if (value === undefined || value === null || String(value).trim() === "") return NaN;
  const normalized = String(value).replace(/\s+/g, "").replace(/,/g, ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function compactDeep(value) {
  if (Array.isArray(value)) {
    return value
      .map(compactDeep)
      .filter((v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, compactDeep(v)])
        .filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
    );
  }
  return value;
}

function asDetails(service) {
  return service?.details && typeof service.details === "object" ? service.details : {};
}

function firstText(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function parseServiceDateMs(value, endOfDay = true) {
  if (value === undefined || value === null || String(value).trim() === "") return NaN;

  if (typeof value === "number") {
    const ms = value > 9999999999 ? value : value * 1000;
    return Number.isFinite(ms) ? ms : NaN;
  }

  const raw = String(value).trim();

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const ms = n > 9999999999 ? n : n * 1000;
    return Number.isFinite(ms) ? ms : NaN;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const suffix = endOfDay ? "T23:59:59" : "T00:00:00";
    const ms = new Date(`${raw}${suffix}`).getTime();
    return Number.isFinite(ms) ? ms : NaN;
  }

  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function isPastServiceDate(value, now = Date.now()) {
  const ms = parseServiceDateMs(value, true);
  return Number.isFinite(ms) && ms < now;
}

function formatServiceDateRange(details) {
  const start = firstText(details.startDate, details.start_date, details.startFlightDate, details.departureFlightDate, details.eventDate);
  const end = firstText(details.endDate, details.end_date, details.endFlightDate, details.returnFlightDate, details.returnDate);
  if (start && end && start !== end) return `${start} → ${end}`;
  return start || end || "";
}

function getServiceRouteText(service, fallback = "—") {
  const d = asDetails(service);
  const category = String(service?.category || "").toLowerCase();

  if (category === "refused_hotel") {
    return [firstText(d.directionCountry, d.country), firstText(d.directionTo, d.city, d.location), firstText(d.hotel)]
      .filter(Boolean)
      .join(" / ") || fallback;
  }

  if (category === "refused_event_ticket") {
    return [firstText(d.eventName, service?.title), firstText(d.location, d.directionTo, d.city), firstText(d.ticketDetails)]
      .filter(Boolean)
      .join(" / ") || fallback;
  }

  if (category === "visa_support") {
    return firstText(d.visaCountry, d.directionCountry, d.description, fallback);
  }

  return [firstText(d.directionFrom, d.fromCity), firstText(d.directionTo, d.toCity), firstText(d.hotel)]
    .filter(Boolean)
    .join(" → ") || firstText(d.directionCountry, fallback);
}

function getServicePriceText(service, fallback = "—") {
  const d = asDetails(service);
  const price = firstText(d.grossPrice, d.priceGross, d.netPrice, d.priceNet, service?.price);
  if (!price) return fallback;
  const currency = firstText(d.currency, service?.price_currency, service?.currency, "USD");
  return `${price} ${currency}`;
}

function getStatusTone(status) {
  const s = String(status || "draft").toLowerCase();
  if (s === "published" || s === "approved") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (s === "pending") return "bg-blue-50 text-blue-700 ring-blue-100";
  if (s === "archived") return "bg-blue-50 text-blue-700 ring-blue-100";
  if (s === "deleted") return "bg-slate-100 text-slate-600 ring-slate-200";
  if (s === "rejected") return "bg-rose-50 text-rose-700 ring-rose-100";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function getServiceStatusLabel(status, t) {
  const raw = String(status || "draft").toLowerCase();
  const key = raw === "approved" ? "published" : raw;

  return t(`service_status.${key}`, {
    defaultValue: t(`moderation.service_status.${key}`, {
      defaultValue: status || "draft",
    }),
  });
}

function serviceHasProof(service) {
  const d = asDetails(service);
  const proof = Array.isArray(d.proofImages) ? d.proofImages : Array.isArray(d.proof_images) ? d.proof_images : [];
  return proof.filter(Boolean).length;
}

function getServiceStatus(service) {
  return String(service?.status || service?.moderation_status || "draft").toLowerCase();
}

function isDeletedService(service) {
  return Boolean(service?.deleted_at || service?.deletedAt || getServiceStatus(service) === "deleted");
}

function isHistoricalRefusedService(service) {
  if (!service || isDeletedService(service)) return false;

  const category = String(service?.category || "").toLowerCase();
  if (!HISTORICAL_REFUSED_CATEGORIES.includes(category)) return false;

  const status = getServiceStatus(service);
  if (status !== "published" && status !== "approved") return false;

  const d = asDetails(service);

  const expirationValues = [
    service?.expiration_at,
    service?.expires_at,
    d.expiration_at,
    d.expiration,
    d.expiration_ts,
  ];

  if (expirationValues.some((value) => isPastServiceDate(value))) return true;

  const endValues = [
    service?.end_date,
    service?.endDate,
    d.endDate,
    d.end_date,
    d.returnDate,
    d.returnFlightDate,
    d.endFlightDate,
    d.checkoutDate,
  ];

  if (endValues.some((value) => isPastServiceDate(value))) return true;

  if (category === "refused_event_ticket" || category === "refused_flight") {
    return [d.eventDate, d.startDate, d.start_date, d.startFlightDate, d.departureFlightDate].some((value) =>
      isPastServiceDate(value)
    );
  }

  return false;
}

function isArchivedService(service) {
  return !isDeletedService(service) && (getServiceStatus(service) === "archived" || isHistoricalRefusedService(service));
}

function isPendingService(service) {
  const status = getServiceStatus(service);
  const moderation = String(service?.moderation_status || "").toLowerCase();
  return !isDeletedService(service) && !isArchivedService(service) && (status === "pending" || moderation === "pending");
}

function isPublishedService(service) {
  const status = getServiceStatus(service);
  return !isDeletedService(service) && !isArchivedService(service) && (status === "published" || status === "approved");
}

function isDraftService(service) {
  const status = getServiceStatus(service);
  return !isDeletedService(service) && !isArchivedService(service) && (status === "draft" || !status);
}

function isRejectedService(service) {
  return !isDeletedService(service) && !isArchivedService(service) && getServiceStatus(service) === "rejected";
}

function getServiceListBucket(service) {
  if (isDeletedService(service)) return "trash";
  if (isArchivedService(service)) return "archive";
  if (isPendingService(service)) return "pending";
  if (isPublishedService(service)) return "published";
  if (isRejectedService(service)) return "rejected";
  return "draft";
}

function getArchiveReasonLabel(service, t) {
  if (getServiceStatus(service) === "archived") {
    return t("service_archive.reason_archived", { defaultValue: "Архив" });
  }

  return t("service_archive.reason_completed", { defaultValue: "Завершено" });
}

function hasFilled(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function buildReadinessItems({ category, title, images, details, isExtended, t }) {
  if (!isExtended) {
    return [
      { ok: hasFilled(title), label: t("service_form.ready_title", { defaultValue: "Название заполнено" }) },
      { ok: Array.isArray(images) && images.length > 0, label: t("service_form.ready_photo", { defaultValue: "Добавлено фото услуги" }) },
    ];
  }

  const proof = Array.isArray(details.proofImages) ? details.proofImages.filter(Boolean).length : 0;
  const gross = parseMoney(details.grossPrice);
  const net = parseMoney(details.netPrice);

  const dateOk = (() => {
    if (category === "refused_event_ticket") return hasFilled(details.startDate);
    if (category === "refused_flight") return hasFilled(details.startDate) || hasFilled(details.startFlightDate);
    return hasFilled(details.startDate) && hasFilled(details.endDate);
  })();

  const routeOk = (() => {
    if (category === "refused_hotel") return hasFilled(details.directionCountry) && hasFilled(details.directionTo) && hasFilled(details.hotel);
    if (category === "refused_event_ticket") return hasFilled(details.eventName || title) && hasFilled(details.location);
    if (category === "visa_support") return hasFilled(details.visaCountry || details.description);
    return hasFilled(details.directionFrom) && hasFilled(details.directionTo);
  })();

  const specificOk = (() => {
    if (category === "author_tour") return hasFilled(details.program) && hasFilled(details.included) && hasFilled(details.duration);
    if (category === "refused_tour") return hasFilled(details.hotel) && validateFlightDetailsFormat(details.flightDetails);
    if (category === "refused_flight") return hasFilled(details.airline) && validateFlightDetailsFormat(details.flightDetails);
    if (category === "refused_hotel") return hasFilled(details.accommodationCategory) || hasFilled(details.accommodation);
    if (category === "refused_event_ticket") return hasFilled(details.ticketDetails) || hasFilled(details.eventCategory);
    return true;
  })();

  return [
    { ok: hasFilled(title), label: t("service_form.ready_title", { defaultValue: "Название заполнено" }) },
    { ok: routeOk, label: t("service_form.ready_route", { defaultValue: "Ключевое направление/локация заполнены" }) },
    { ok: dateOk, label: t("service_form.ready_dates", { defaultValue: "Даты заполнены" }) },
    { ok: specificOk, label: t("service_form.ready_category_details", { defaultValue: "Детали категории заполнены" }) },
    { ok: Number.isFinite(net) && net > 0 && Number.isFinite(gross) && gross >= net, label: t("service_form.ready_price", { defaultValue: "Цена нетто и цена для клиента корректны" }) },
    { ok: Array.isArray(images) && images.length > 0, label: t("service_form.ready_photo", { defaultValue: "Добавлено фото услуги" }) },
    { ok: proof > 0, label: t("service_form.ready_proof", { defaultValue: "Добавлен proof для модерации" }) },
  ];
}


function buildValidationIssues({ category, title, description, price, images, details, isExtended, t, requireProof = false }) {
  const issues = [];
  const add = (ok, label) => {
    if (!ok) issues.push(label);
  };

  add(hasFilled(category), t("validation.category_required", { defaultValue: "Выберите категорию" }));
  add(hasFilled(title), t("validation.title_required", { defaultValue: "Укажите название услуги" }));

  if (!isExtended) {
    const simplePrice = parseMoney(price);
    add(hasFilled(description), t("validation.description_required", { defaultValue: "Добавьте описание" }));
    add(Number.isFinite(simplePrice) && simplePrice > 0, t("validation.price_positive", { defaultValue: "Укажите корректную цену" }));
    add(Array.isArray(images) && images.length > 0, t("validation.photo_required", { defaultValue: "Добавьте хотя бы одно фото" }));
    return issues;
  }

  const net = parseMoney(details.netPrice);
  const gross = parseMoney(details.grossPrice);
  const proofCount = Array.isArray(details.proofImages) ? details.proofImages.filter(Boolean).length : 0;

  if (category === "author_tour") {
    add(hasFilled(details.directionCountry), t("validation.country_required", { defaultValue: "Укажите страну / направление" }));
    add(hasFilled(details.directionFrom), t("validation.from_required", { defaultValue: "Укажите город старта" }));
    add(hasFilled(details.directionTo), t("validation.to_required", { defaultValue: "Укажите город финиша" }));
    add(details.flexibleDates || hasFilled(details.startDate), t("validation.start_date_required", { defaultValue: "Укажите дату начала или включите даты по запросу" }));
    add(details.flexibleDates || hasFilled(details.endDate), t("validation.end_date_required", { defaultValue: "Укажите дату окончания или включите даты по запросу" }));
    add(hasFilled(details.duration), t("validation.duration_required", { defaultValue: "Укажите длительность тура" }));
    add(hasFilled(details.program), t("validation.program_required", { defaultValue: "Добавьте программу авторского тура" }));
    add(hasFilled(details.included), t("validation.included_required", { defaultValue: "Укажите, что включено в стоимость" }));
  }

  if (category === "refused_tour") {
    add(hasFilled(details.directionCountry), t("validation.country_required", { defaultValue: "Укажите страну направления" }));
    add(hasFilled(details.directionFrom), t("validation.from_required", { defaultValue: "Укажите город вылета" }));
    add(hasFilled(details.directionTo), t("validation.to_required", { defaultValue: "Укажите город прибытия" }));
    add(hasFilled(details.startDate), t("validation.start_date_required", { defaultValue: "Укажите дату начала" }));
    add(hasFilled(details.endDate), t("validation.end_date_required", { defaultValue: "Укажите дату окончания" }));
    add(hasFilled(details.hotel), t("validation.hotel_required", { defaultValue: "Укажите отель" }));
    add(validateFlightDetailsFormat(details.flightDetails), t("validation.flight_details_format", { defaultValue: "Заполните детали рейса в правильном формате" }));
  }

  if (category === "refused_hotel") {
    add(hasFilled(details.directionCountry), t("validation.country_required", { defaultValue: "Укажите страну" }));
    add(hasFilled(details.directionTo), t("validation.city_required", { defaultValue: "Укажите город/курорт" }));
    add(hasFilled(details.hotel), t("validation.hotel_required", { defaultValue: "Укажите отель" }));
    add(hasFilled(details.startDate), t("validation.checkin_required", { defaultValue: "Укажите дату заезда" }));
    add(hasFilled(details.endDate), t("validation.checkout_required", { defaultValue: "Укажите дату выезда" }));
    add(hasFilled(details.accommodationCategory) || hasFilled(details.accommodation), t("validation.room_required", { defaultValue: "Укажите номер или размещение" }));
  }

  if (category === "refused_flight") {
    add(hasFilled(details.directionFrom), t("validation.from_required", { defaultValue: "Укажите город вылета" }));
    add(hasFilled(details.directionTo), t("validation.to_required", { defaultValue: "Укажите город прибытия" }));
    add(hasFilled(details.startDate) || hasFilled(details.startFlightDate), t("validation.departure_date_required", { defaultValue: "Укажите дату вылета" }));
    add(hasFilled(details.airline), t("validation.airline_required", { defaultValue: "Укажите авиакомпанию" }));
    add(validateFlightDetailsFormat(details.flightDetails), t("validation.flight_details_format", { defaultValue: "Заполните детали рейса в правильном формате" }));
  }

  if (category === "refused_event_ticket") {
    add(hasFilled(details.eventName || title), t("validation.event_name_required", { defaultValue: "Укажите название мероприятия" }));
    add(hasFilled(details.location), t("validation.location_required", { defaultValue: "Укажите локацию мероприятия" }));
    add(hasFilled(details.startDate), t("validation.event_date_required", { defaultValue: "Укажите дату мероприятия" }));
    add(hasFilled(details.ticketDetails) || hasFilled(details.eventCategory), t("validation.ticket_details_required", { defaultValue: "Укажите детали билета" }));
  }

  if (category === "visa_support") {
    add(hasFilled(details.visaCountry) || hasFilled(details.description), t("validation.visa_country_required", { defaultValue: "Укажите страну визы или описание" }));
  }

  add(Number.isFinite(net) && net > 0, t("validation.net_positive", { defaultValue: "Укажите корректную цену нетто" }));
  add(Number.isFinite(gross) && gross > 0, t("validation.gross_positive", { defaultValue: "Укажите корректную цену для клиента" }));
  add(!Number.isFinite(net) || !Number.isFinite(gross) || gross >= net, t("validation.gross_ge_net", { defaultValue: "Цена для клиента не может быть меньше нетто" }));
  add(Array.isArray(images) && images.length > 0, t("validation.photo_required", { defaultValue: "Добавьте хотя бы одно фото" }));
  if (requireProof) add(proofCount > 0, t("validation.proof_required", { defaultValue: "Добавьте proof перед отправкой на модерацию" }));

  return issues;
}

function formatDateShort(value) {
  if (!value) return "";
  const parts = String(value).slice(0, 10).split("-");
  if (parts.length === 3) return `${parts[2]}.${parts[1]}`;
  return String(value);
}

function categoryStickerText(category, t) {
  const map = {
    refused_tour: t("category.refused_tour", { defaultValue: "ОТКАЗНОЙ ТУР" }),
    author_tour: t("category.author_tour", { defaultValue: "АВТОРСКИЙ ТУР" }),
    refused_hotel: t("category.refused_hotel", { defaultValue: "ОТКАЗНОЙ ОТЕЛЬ" }),
    refused_flight: t("category.refused_flight", { defaultValue: "ОТКАЗНОЙ АВИАБИЛЕТ" }),
    refused_event_ticket: t("category.refused_event_ticket", { defaultValue: "ОТКАЗНОЙ БИЛЕТ НА МЕРОПРИЯТИЕ" }),
    visa_support: t("category.visa_support", { defaultValue: "ВИЗОВАЯ ПОДДЕРЖКА" }),
  };
  return map[category] || t(`category.${category}`, { defaultValue: category || "Категория" });
}

function buildAutoTitle({ category, details, t }) {
  const from = firstText(details.directionFrom);
  const to = firstText(details.directionTo, details.location);
  const country = firstText(details.directionCountry, details.visaCountry);
  const hotel = firstText(details.hotel);
  const eventName = firstText(details.eventName);
  const dates = [formatDateShort(details.startDate || details.startFlightDate), formatDateShort(details.endDate || details.returnDate || details.endFlightDate)].filter(Boolean).join("–");

  if (category === "refused_tour") return ["Отказной тур", from && to ? `${from} → ${to}` : country, hotel, dates].filter(Boolean).join(" · ");
  if (category === "author_tour") return ["Авторский тур", from && to ? `${from} → ${to}` : country, hotel, dates].filter(Boolean).join(" · ");
  if (category === "refused_hotel") return ["Отказной отель", hotel, to || country, dates].filter(Boolean).join(" · ");
  if (category === "refused_flight") return ["Отказной авиабилет", from && to ? `${from} → ${to}` : "", dates].filter(Boolean).join(" · ");
  if (category === "refused_event_ticket") return ["Отказной билет", eventName, to, dates].filter(Boolean).join(" · ");
  if (category === "visa_support") return ["Визовая поддержка", country].filter(Boolean).join(" · ");
  return t("service_form.auto_title_fallback", { defaultValue: "Новая услуга" });
}

function buildAutoDescription({ category, details, t }) {
  const lines = [];
  const push = (label, value) => {
    if (hasFilled(value)) lines.push(`${label}: ${value}`);
  };

  if (category === "refused_tour" || category === "author_tour") {
    lines.push(category === "author_tour" ? "Авторский тур" : "Отказной тур");
    push("Маршрут", [details.directionFrom, details.directionTo].filter(Boolean).join(" → "));
    push("Страна", details.directionCountry);
    push("Даты", [details.startDate, details.endDate].filter(Boolean).join(" → "));
    push("Отель", details.hotel);
    push("Размещение", details.accommodation || details.accommodationCategory);
    push("Питание", details.food);
    push("Детали рейса", normalizeFlightDetails(details.flightDetails));
  } else if (category === "refused_hotel") {
    lines.push("Отказной отель");
    push("Направление", [details.directionCountry, details.directionTo].filter(Boolean).join(" / "));
    push("Отель", details.hotel);
    push("Даты", [details.startDate, details.endDate].filter(Boolean).join(" → "));
    push("Номер/размещение", details.accommodationCategory || details.accommodation);
    push("Питание", details.food);
  } else if (category === "refused_flight") {
    lines.push("Отказной авиабилет");
    push("Маршрут", [details.directionFrom, details.directionTo].filter(Boolean).join(" → "));
    push("Дата вылета", details.startDate || details.startFlightDate);
    push("Дата обратно", details.returnDate || details.endDate);
    push("Авиакомпания", details.airline);
    push("Детали рейса", normalizeFlightDetails(details.flightDetails));
  } else if (category === "refused_event_ticket") {
    lines.push("Отказной билет на мероприятие");
    push("Событие", details.eventName);
    push("Локация", details.location);
    push("Дата", details.startDate);
    push("Детали билета", details.ticketDetails || details.eventCategory);
  } else if (category === "visa_support") {
    lines.push("Визовая поддержка");
    push("Страна", details.visaCountry);
    push("Описание", details.description);
  }

  const included = [
    details.transfer ? "трансфер" : null,
    details.visaIncluded ? "виза включена" : null,
    details.insuranceIncluded ? "страховка включена" : null,
    details.earlyCheckIn ? "раннее заселение" : null,
    details.arrivalFastTrack ? "Fast Track" : null,
  ].filter(Boolean);
  if (included.length) push("Дополнительно", included.join(", "));
  return lines.filter(Boolean).join("\n").trim() || t("service_form.auto_description_fallback", { defaultValue: "Описание будет сформировано после заполнения полей." });
}

function MarketplacePreviewCard({ category, title, routeText, dateRangeText, priceText, images, details, includedPreview, t }) {
  const proofCount = Array.isArray(details.proofImages) ? details.proofImages.filter(Boolean).length : 0;
  return (
    <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_20px_55px_rgba(15,23,42,0.10)]">
      <div className="relative h-48 bg-gradient-to-br from-orange-100 via-amber-50 to-sky-50">
        {images?.[0] ? <img src={images[0]} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400"><div className="text-4xl">🏝️</div><div className="text-xs font-black">{t("service_form.preview_photo_hint", { defaultValue: "Фото появится здесь" })}</div></div>}
        <div className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-orange-700 shadow ring-1 ring-orange-100">{categoryStickerText(category, t)}</div>
        <div className="absolute right-3 top-3 rounded-full bg-slate-950/85 px-3 py-1 text-[10px] font-black text-white shadow">{proofCount ? `Proof ${proofCount}` : t("service_form.no_proof", { defaultValue: "No proof" })}</div>
      </div>
      <div className="space-y-3 p-4">
        <h3 className="line-clamp-2 text-lg font-black leading-snug text-slate-950">{title || t("service_form.preview_title_empty", { defaultValue: "Название услуги" })}</h3>
        <div className="rounded-2xl bg-slate-50 p-3 text-sm font-bold leading-6 text-slate-700 ring-1 ring-slate-100">
          <div>📍 {routeText || t("service_form.preview_route_empty", { defaultValue: "Маршрут будет показан здесь" })}</div>
          <div>🗓 {dateRangeText || t("not_specified", { defaultValue: "Не указано" })}</div>
        </div>
        <div className="rounded-2xl bg-slate-950 p-4 text-white">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">{t("price", { defaultValue: "Цена" })}</div>
          <div className="mt-1 text-3xl font-black tracking-[-0.04em]">{priceText || t("service_form.preview_price_empty", { defaultValue: "Цена появится здесь" })}</div>
        </div>
        {includedPreview.length > 0 && <div className="flex flex-wrap gap-1.5">{includedPreview.map((x) => <span key={x} className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">{x}</span>)}</div>}
        <div className="rounded-2xl bg-orange-50 p-3 text-xs font-semibold leading-5 text-orange-800 ring-1 ring-orange-100">
          {proofCount ? t("service_form.preview_trust_with_proof", { defaultValue: "Proof добавлен: карточка выглядит надежнее для клиента и модерации." }) : t("service_form.preview_trust_without_proof", { defaultValue: "Добавьте proof: клиенту и админу будет проще понять подлинность предложения." })}
        </div>
      </div>

    </div>
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs font-semibold text-slate-400">{hint}</span> : null}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className={cx(
        "h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-100",
        props.className
      )}
    />
  );
}

function SelectInput(props) {
  return (
    <select
      {...props}
      className={cx(
        "h-11 w-full rounded-2xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100",
        props.className
      )}
    />
  );
}

function TextArea(props) {
  return (
    <textarea
      {...props}
      className={cx(
        "min-h-[92px] w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-100",
        props.className
      )}
    />
  );
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cx(
        "flex items-start gap-3 rounded-2xl border p-3 text-left transition",
        checked
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-white text-slate-700 hover:border-orange-200 hover:bg-orange-50/50"
      )}
    >
      <span className={cx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-black", checked ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400")}>
        {checked ? "✓" : ""}
      </span>
      <span>
        <span className="block text-sm font-black">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs font-medium text-current/70">{hint}</span> : null}
      </span>
    </button>
  );
}

function ImageUploader({ title, hint, images, onChange, max = 10 }) {
  const handleFiles = async (event) => {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, max - images.length));
    if (!files.length) return;
    const next = [];
    for (const file of files) {
      if (!String(file.type || "").startsWith("image/")) continue;
      next.push(await fileToDataUrl(file));
    }
    onChange([...images, ...next].slice(0, max));
    event.target.value = "";
  };

  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-900">{title}</div>
          {hint ? <div className="mt-1 text-xs font-medium leading-5 text-slate-500">{hint}</div> : null}
        </div>
        {!!images.length && (
          <button type="button" onClick={() => onChange([])} className="text-xs font-black text-rose-600 hover:underline">
            Очистить
          </button>
        )}
      </div>

      {images.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {images.map((src, idx) => (
            <div key={`${src}-${idx}`} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <img src={src} alt="" className="h-20 w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(images.filter((_, i) => i !== idx))}
                className="absolute right-1 top-1 hidden rounded-full bg-white/90 px-2 py-1 text-xs font-black text-rose-600 shadow group-hover:block"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-400">
          Изображений пока нет
        </div>
      )}

      <label className="mt-3 inline-flex cursor-pointer rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-orange-600">
        <input type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
        Выбрать файлы
      </label>
    </div>
  );
}


function formatSupportAmount(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("ru-RU").format(Number.isFinite(n) ? n : 0);
}

function SupportAfterCreateModal({ open, service, onClose, onPay, busy, error }) {
  const [amount, setAmount] = useState(50000);
  const [customAmount, setCustomAmount] = useState("");

  if (!open || !service?.id) return null;

  const presets = [20000, 50000, 100000, 200000];
  const cleanCustom = Number(String(customAmount || "").replace(/\D/g, ""));
  const finalAmount = cleanCustom > 0 ? cleanCustom : amount;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 px-3 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-[2rem] bg-white shadow-2xl ring-1 ring-black/10">
        <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-orange-500 px-6 py-6 text-white">
          <div className="inline-flex rounded-full bg-white/15 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ring-1 ring-white/20">
            Поддержка проекта
          </div>
          <h3 className="mt-4 text-2xl font-black tracking-[-0.04em]">
            Услуга создана. Хотите поддержать проект?
          </h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-white/85">
            Добровольная поддержка помогает развивать Bot Otkaznyx Turov и Travella. Для объявления #R{service.id} донат сохранится в админке как поддержка, связанная с этой услугой.
          </p>
        </div>

        <div className="space-y-4 p-6">
          <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 ring-1 ring-emerald-100">
            ✅ {service.title || "Новая услуга"} сохранена. Оплата поддержки необязательная.
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {presets.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => {
                  setAmount(x);
                  setCustomAmount("");
                }}
                className={cx(
                  "rounded-2xl px-3 py-3 text-sm font-black ring-1 transition",
                  finalAmount === x && !customAmount
                    ? "bg-orange-500 text-white ring-orange-500"
                    : "bg-slate-50 text-slate-800 ring-slate-200 hover:bg-slate-100"
                )}
              >
                {formatSupportAmount(x)} сум
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-sm font-black text-slate-700">Своя сумма, сум</span>
            <input
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              inputMode="numeric"
              placeholder="Например: 75000"
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base font-bold text-slate-900 outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
            />
          </label>

          {error ? (
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 ring-1 ring-rose-100">
              {error}
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy || finalAmount <= 0}
              onClick={() => onPay(finalAmount)}
              className="rounded-2xl bg-orange-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-100 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              {busy ? "Создаём Payme ссылку…" : `Поддержать на ${formatSupportAmount(finalAmount)} сум`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              Не сейчас
            </button>
          </div>

          <p className="text-center text-xs font-semibold leading-5 text-slate-500">
            После Payme вы вернётесь на страницу подтверждения. Созданная услуга останется сохранённой независимо от доната.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DashboardServices() {
  const { t } = useTranslation();
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const api = useMemo(() => {
    const instance = axios.create({ baseURL: API_BASE });
    instance.interceptors.request.use((cfg) => {
      const tok = localStorage.getItem("token") || localStorage.getItem("providerToken");
      if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
      return cfg;
    });
    return instance;
  }, [API_BASE]);

  const [profile, setProfile] = useState(null);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("create");
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  const [serviceListFilter, setServiceListFilter] = useState("active");
  const [confirmModal, setConfirmModal] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [supportPromptService, setSupportPromptService] = useState(null);
  const [supportPayBusy, setSupportPayBusy] = useState(false);
  const [supportPayError, setSupportPayError] = useState("");

  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [images, setImages] = useState([]);
  const [details, setDetails] = useState(DEFAULT_DETAILS);

  const isAgent = profile?.type === "agent";
  const isExtended = isAgent && EXTENDED_AGENT_CATEGORIES.includes(category);

  const steps = useMemo(
    () => [
      { id: 1, label: t("service_form.step_main", { defaultValue: "Основное" }), hint: t("service_form.step_main_hint", { defaultValue: "Категория, название, направление" }) },
      { id: 2, label: t("service_form.step_details", { defaultValue: "Детали" }), hint: t("service_form.step_details_hint", { defaultValue: "Отель, рейс, размещение" }) },
      { id: 3, label: t("service_form.step_value", { defaultValue: "Ценность" }), hint: t("service_form.step_value_hint", { defaultValue: "Что включено и proof" }) },
      { id: 4, label: t("service_form.step_price", { defaultValue: "Цена" }), hint: t("service_form.step_price_hint", { defaultValue: "Стоимость и актуальность" }) },
      { id: 5, label: t("service_form.step_preview", { defaultValue: "Предпросмотр" }), hint: t("service_form.step_preview_hint", { defaultValue: "Как увидит клиент" }) },
    ],
    [t]
  );

  const categoryOptions = useMemo(() => {
    const type = profile?.type;
    if (type === "agent") {
      return [
        "refused_tour",
        "refused_hotel",
        "refused_flight",
        "refused_event_ticket",
        "visa_support",
        "author_tour",
      ];
    }
    if (type === "guide") return ["city_tour_guide", "mountain_tour_guide", "desert_tour_guide", "safari_tour_guide"];
    if (type === "transport") return ["city_tour_transport", "mountain_tour_transport", "desert_tour_transport", "safari_tour_transport", "one_way_transfer", "dinner_transfer", "border_transfer"];
    if (type === "hotel") return ["hotel_room", "hotel_transfer", "hall_rent"];
    return [];
  }, [profile?.type]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [profileRes, servicesRes] = await Promise.all([
        api.get("/api/providers/profile"),
        api.get("/api/providers/services"),
      ]);
      setProfile(profileRes.data || {});
      setServices(Array.isArray(servicesRes.data) ? servicesRes.data : []);
    } catch (err) {
      console.error(err);
      tError(t("services_load_error", { defaultValue: "Не удалось загрузить услуги" }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setSelectedService(null);
    setCategory("");
    setTitle("");
    setDescription("");
    setPrice("");
    setImages([]);
    setDetails({ ...DEFAULT_DETAILS });
    setStep(1);
    setTab("create");
  };

  const patchDetails = (patch) => setDetails((prev) => ({ ...prev, ...patch }));

  const loadServiceToEdit = (service) => {
    const d = service?.details && typeof service.details === "object" ? service.details : {};
    setSelectedService(service);
    setCategory(service.category || "");
    setTitle(service.title || "");
    setDescription(service.description || d.description || "");
    setPrice(service.price ?? "");
    setImages(Array.isArray(service.images) ? service.images : []);
    setDetails({ ...DEFAULT_DETAILS, ...d, proofImages: Array.isArray(d.proofImages || d.proof_images) ? (d.proofImages || d.proof_images) : [] });
    setStep(1);
    setTab("create");
  };

  const currentValidationIssues = useMemo(
    () => buildValidationIssues({ category, title, description, price, images, details, isExtended, t, requireProof: false }),
    [category, title, description, price, images, details, isExtended, t]
  );

  const moderationValidationIssues = useMemo(
    () => buildValidationIssues({ category, title, description, price, images, details, isExtended, t, requireProof: true }),
    [category, title, description, price, images, details, isExtended, t]
  );

  const validate = () => {
    if (currentValidationIssues.length > 0) {
      tWarn(currentValidationIssues[0]);
      return false;
    }
    return true;
  };

  const applyAutoTitle = () => {
    const nextTitle = buildAutoTitle({ category, details, t });
    setTitle(nextTitle);
    tSuccess(t("service_form.auto_title_applied", { defaultValue: "Название сформировано" }));
  };

  const applyAutoDescription = () => {
    const nextDescription = buildAutoDescription({ category, details, t });
    if (isExtended) {
      patchDetails({ description: nextDescription });
    } else {
      setDescription(nextDescription);
    }
    tSuccess(t("service_form.auto_description_applied", { defaultValue: "Описание сформировано" }));
  };

  const saveService = async () => {
    if (!validate()) return;
    const wasEditing = !!selectedService?.id;
    const createdCategory = category;
    try {
      setSaving(true);
      const net = parseMoney(details.netPrice);
      const gross = parseMoney(details.grossPrice);
      const simplePrice = parseMoney(price);
      const expirationDate = details.expiration ? new Date(details.expiration) : null;
      const payload = compactDeep({
        title: title.trim(),
        category,
        images,
        price: isExtended ? undefined : simplePrice,
        description: isExtended ? undefined : description,
        details: isExtended
          ? {
              ...details,
              flightDetails: normalizeFlightDetails(details.flightDetails),
              netPrice: net,
              grossPrice: gross,
              proofImages: details.proofImages || [],
              ...(expirationDate && Number.isFinite(expirationDate.getTime())
                ? { expiration_ts: Math.floor(expirationDate.getTime() / 1000) }
                : {}),
            }
          : undefined,
      });
      const res = selectedService?.id
        ? await api.put(`/api/providers/services/${selectedService.id}`, payload)
        : await api.post("/api/providers/services", payload);
      const saved = res.data;
      setServices((prev) => {
        if (selectedService?.id) return prev.map((s) => (s.id === selectedService.id ? saved : s));
        return [...prev, saved];
      });
      tSuccess(wasEditing ? t("service_updated", { defaultValue: "Услуга обновлена" }) : t("service_added", { defaultValue: "Услуга добавлена" }));
      if (!wasEditing && saved?.id && HISTORICAL_REFUSED_CATEGORIES.includes(createdCategory)) {
        setSupportPayError("");
        setSupportPromptService(saved);
      }
      if (saved?.id) {
        loadServiceToEdit(saved);
      }
    } catch (err) {
      console.error(err);
      tError(err?.response?.data?.message || t("add_error", { defaultValue: "Ошибка сохранения" }));
    } finally {
      setSaving(false);
    }
  };

  const createSupportPaymentAfterService = async (amountSum) => {
    if (!supportPromptService?.id) return;
    try {
      setSupportPayBusy(true);
      setSupportPayError("");
      const res = await api.post("/api/provider-support/create", {
        amount_sum: amountSum,
        service_id: supportPromptService.id,
        note: `Web support after service #R${supportPromptService.id}`,
      });
      const payUrl = res?.data?.pay_url;
      if (!payUrl) throw new Error("Payme ссылка не создана");
      window.location.href = payUrl;
    } catch (err) {
      console.error(err);
      setSupportPayError(err?.response?.data?.message || err?.message || "Не удалось создать оплату Payme");
    } finally {
      setSupportPayBusy(false);
    }
  };

  const deleteService = (service, event) => {
    event?.stopPropagation?.();
    if (!service?.id) return;
    setConfirmModal({ type: "delete", service });
  };

  const performDeleteService = async (service) => {
    if (!service?.id) return;
    try {
      await api.delete(`/api/providers/services/${service.id}`);
      const deletedAt = new Date().toISOString();
      setServices((prev) =>
        prev.map((s) =>
          s.id === service.id
            ? { ...s, status: "deleted", deleted_at: deletedAt }
            : s
        )
      );
      if (selectedService?.id === service.id) {
        setSelectedService((prev) =>
          prev ? { ...prev, status: "deleted", deleted_at: deletedAt } : prev
        );
      }
      setServiceListFilter("trash");
      tSuccess(t("service_deleted", { defaultValue: "Услуга удалена" }));
    } catch (err) {
      console.error(err);
      tError(t("delete_error", { defaultValue: "Ошибка удаления" }));
      throw err;
    }
  };

  const restoreServiceFromTrash = (service, event) => {
    event?.stopPropagation?.();
    if (!service?.id) return;
    setConfirmModal({ type: "restore", service });
  };

  const performRestoreServiceFromTrash = async (service) => {
    if (!service?.id) return;

    try {
      const res = await api.post(`/api/providers/services/${service.id}/restore`, {});
      const restored = res.data || { ...service, status: "draft", moderation_status: "draft", deleted_at: null };

      setServices((prev) => prev.map((s) => (s.id === service.id ? restored : s)));

      if (selectedService?.id === service.id) {
        loadServiceToEdit(restored);
      }

      setServiceListFilter("draft");
      tSuccess(t("service_restored", { defaultValue: "Услуга восстановлена в черновики" }));
    } catch (err) {
      console.error(err);
      tError(err?.response?.data?.message || t("restore_error", { defaultValue: "Не удалось восстановить услугу" }));
      throw err;
    }
  };

  const handleConfirmModalConfirm = async () => {
    if (!confirmModal?.service) return;
    try {
      setConfirmBusy(true);
      if (confirmModal.type === "delete") {
        await performDeleteService(confirmModal.service);
      }
      if (confirmModal.type === "restore") {
        await performRestoreServiceFromTrash(confirmModal.service);
      }
      setConfirmModal(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const submitForModeration = async (service, event) => {
    event?.stopPropagation?.();
    if (!service?.id) return;

    const serviceDetails = asDetails(service);
    const serviceIsExtended = profile?.type === "agent" && EXTENDED_AGENT_CATEGORIES.includes(service.category);
    const issues = buildValidationIssues({
      category: service.category,
      title: service.title,
      description: service.description || serviceDetails.description || "",
      price: service.price,
      images: Array.isArray(service.images) ? service.images : [],
      details: { ...DEFAULT_DETAILS, ...serviceDetails, proofImages: Array.isArray(serviceDetails.proofImages || serviceDetails.proof_images) ? (serviceDetails.proofImages || serviceDetails.proof_images) : [] },
      isExtended: serviceIsExtended,
      t,
      requireProof: String(service.category || "").startsWith("refused_"),
    });

    if (issues.length > 0) {
      tWarn(issues[0]);
      if (selectedService?.id !== service.id) loadServiceToEdit(service);
      setStep(5);
      return;
    }

    try {
      await api.post(`/api/providers/services/${service.id}/submit`, {});
      setServices((prev) => prev.map((s) => (s.id === service.id ? { ...s, status: "pending", moderation_status: "pending" } : s)));
      if (selectedService?.id === service.id) {
        setSelectedService((prev) => prev ? { ...prev, status: "pending", moderation_status: "pending" } : prev);
      }
      tSuccess(t("moderation.submitted_toast", { defaultValue: "Отправлено на модерацию" }));
    } catch (err) {
      console.error(err);
      tError(err?.response?.data?.message || t("submit_error", { defaultValue: "Не удалось отправить на модерацию" }));
    }
  };

  const routeText = getServiceRouteText(
    { category, title, price, details: { ...details } },
    t("service_form.preview_route_empty", { defaultValue: "Маршрут будет показан здесь" })
  );
  const dateRangeText = formatServiceDateRange(details);
  const rawPreviewPrice = isExtended ? details.grossPrice || details.netPrice : price;
  const priceText = rawPreviewPrice ? `${rawPreviewPrice} ${firstText(details.currency, profile?.currency, "USD")}` : "";
  const includedPreview = [
    details.insuranceIncluded ? t("insurance_included", { defaultValue: "Страховка" }) : null,
    details.earlyCheckIn ? t("early_check_in", { defaultValue: "Раннее заселение" }) : null,
    details.arrivalFastTrack ? t("arrival_fast_track", { defaultValue: "Fast Track" }) : null,
    details.visaIncluded ? t("visa_included", { defaultValue: "Виза" }) : null,
    details.transfer ? t("transfer", { defaultValue: "Трансфер" }) : null,
  ].filter(Boolean);

  const readinessItems = buildReadinessItems({ category, title, images, details, isExtended, t });
  const readinessDone = readinessItems.filter((item) => item.ok).length;
  const readinessAllDone = readinessItems.length > 0 && readinessItems.every((item) => item.ok);

  const serviceListStats = useMemo(() => {
    const stats = {
      all: services.length,
      active: 0,
      draft: 0,
      pending: 0,
      published: 0,
      rejected: 0,
      archive: 0,
      trash: 0,
    };

    for (const service of services) {
      const bucket = getServiceListBucket(service);
      stats[bucket] += 1;
      if (bucket !== "archive" && bucket !== "trash") stats.active += 1;
    }

    return stats;
  }, [services]);

  const serviceListTabs = useMemo(
    () => [
      { id: "active", label: t("service_list_filter.active", { defaultValue: "Активные" }), count: serviceListStats.active },
      { id: "draft", label: t("service_list_filter.draft", { defaultValue: "Черновики" }), count: serviceListStats.draft },
      { id: "pending", label: t("service_list_filter.pending", { defaultValue: "На модерации" }), count: serviceListStats.pending },
      { id: "published", label: t("service_list_filter.published", { defaultValue: "Опубликованные" }), count: serviceListStats.published },
      { id: "rejected", label: t("service_list_filter.rejected", { defaultValue: "Отклонённые" }), count: serviceListStats.rejected },
      { id: "archive", label: t("service_list_filter.archive", { defaultValue: "Архив" }), count: serviceListStats.archive },
      { id: "trash", label: t("service_list_filter.trash", { defaultValue: "Корзина" }), count: serviceListStats.trash },
    ],
    [serviceListStats, t]
  );

  const filteredServiceSections = useMemo(() => {
    const labels = {
      draft: t("service_group.draft", { defaultValue: "Черновики" }),
      pending: t("service_group.pending", { defaultValue: "На модерации" }),
      published: t("service_group.published", { defaultValue: "Опубликованные" }),
      rejected: t("service_group.rejected", { defaultValue: "Отклонённые" }),
      archive: t("service_group.archive", { defaultValue: "Архив" }),
      trash: t("service_group.trash", { defaultValue: "Корзина" }),
    };

    const order = serviceListFilter === "active" ? ["draft", "pending", "published", "rejected"] : [serviceListFilter];

    return order
      .map((bucket) => ({
        id: bucket,
        label: labels[bucket] || bucket,
        items: services.filter((service) => getServiceListBucket(service) === bucket),
      }))
      .filter((section) => section.items.length > 0);
  }, [services, serviceListFilter, t]);

  const filteredServicesCount = filteredServiceSections.reduce((sum, section) => sum + section.items.length, 0);

  if (loading) {
    return <div className="rounded-3xl bg-white p-6 text-sm font-semibold text-slate-500 shadow-sm">{t("loading", { defaultValue: "Загрузка…" })}</div>;
  }

  if (!profile?.id) return null;

  return (
    <div className="space-y-6">
      {(profile.type === "guide" || profile.type === "transport" || profile.type === "agent") && (
        <details className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-black text-slate-800">
            {t("provider_services_tourbuilder_title", { defaultValue: "Прайс-лист для TourBuilder" })}
          </summary>
          <div className="mt-4">
            <ProviderServicesCard providerId={profile.id} providerType={profile.type} currencyDefault={profile.currency || "USD"} />
          </div>
        </details>
      )}

      <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
        <div className="border-b border-slate-100 bg-gradient-to-br from-white via-orange-50/45 to-amber-50/50 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">
                {t("service_form.studio_badge", { defaultValue: "Студия создания" })}
              </div>
              <h2 className="mt-3 text-2xl font-black tracking-[-0.03em] text-slate-950">
                {t("services_marketplace", { defaultValue: "Услуги для MARKETPLACE" })}
              </h2>
              <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-600">
                {t("service_form.studio_hint", { defaultValue: "Создавайте отказные услуги блоками: направление, детали, ценность, цена и proof. Чем понятнее карточка, тем выше шанс открытия контактов." })}
              </p>
            </div>
            <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white/80 p-2 shadow-sm lg:min-w-[340px]">
              <button
                type="button"
                onClick={resetForm}
                className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white shadow transition hover:bg-slate-800"
              >
                + {t("provider_services_tab_create", { defaultValue: "Создать услугу" })}
              </button>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                  <div className="text-lg font-black text-slate-950">{serviceListStats.active}</div>
                  <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{t("service_list_filter.active", { defaultValue: "Активные" })}</div>
                </div>
                <div className="rounded-2xl bg-blue-50 px-3 py-2 ring-1 ring-blue-100">
                  <div className="text-lg font-black text-blue-700">{serviceListStats.pending}</div>
                  <div className="text-[10px] font-black uppercase tracking-wide text-blue-400">Pending</div>
                </div>
                <div className="rounded-2xl bg-emerald-50 px-3 py-2 ring-1 ring-emerald-100">
                  <div className="text-lg font-black text-emerald-700">{serviceListStats.published}</div>
                  <div className="text-[10px] font-black uppercase tracking-wide text-emerald-500">Live</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-[760px] gap-0 bg-slate-50/70 lg:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
            <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 p-4 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-black tracking-[-0.02em] text-slate-950">
                    {t("provider_services_tab_created", { defaultValue: "Мои услуги" })}
                  </div>
                  <div className="mt-0.5 text-xs font-semibold text-slate-500">
                    {t("service_form.two_panel_hint", { defaultValue: "Выберите услугу слева — редактор откроется справа." })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={resetForm}
                  className="shrink-0 rounded-2xl bg-orange-500 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-orange-600"
                >
                  + {t("new_service", { defaultValue: "Новая" })}
                </button>
              </div>
            </div>

            <div className="border-b border-slate-100 bg-white px-3 py-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {serviceListTabs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setServiceListFilter(item.id)}
                    className={cx(
                      "shrink-0 rounded-2xl px-3 py-2 text-[11px] font-black transition ring-1",
                      serviceListFilter === item.id
                        ? "bg-slate-950 text-white ring-slate-950"
                        : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-orange-50 hover:text-orange-700 hover:ring-orange-100"
                    )}
                  >
                    {item.label}
                    <span className={cx(
                      "ml-1 rounded-full px-1.5 py-0.5 text-[10px]",
                      serviceListFilter === item.id ? "bg-white/15 text-white" : "bg-white text-slate-500"
                    )}>
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[calc(100vh-238px)] space-y-4 overflow-y-auto p-3">
              {serviceListFilter === "archive" && (
                <div className="rounded-[1.5rem] border border-blue-100 bg-blue-50/70 p-3 text-xs font-semibold leading-5 text-blue-800">
                  {t("service_archive.hint", {
                    defaultValue:
                      "В архив автоматически попадают опубликованные отказные услуги, у которых закончились даты поездки, мероприятия, рейса или истёк срок актуальности. Это история, а не корзина.",
                  })}
                </div>
              )}

              {services.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
                  {t("provider_services_empty", { defaultValue: "Пока нет созданных услуг." })}
                </div>
              ) : filteredServicesCount === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
                  {t("service_list_filter.empty", { defaultValue: "В этом разделе пока нет услуг." })}
                </div>
              ) : (
                filteredServiceSections.map((section) => (
                  <div key={section.id} className="space-y-3">
                    <div className="sticky top-0 z-[1] -mx-1 flex items-center justify-between rounded-2xl bg-white/95 px-3 py-2 text-xs font-black uppercase tracking-wide text-slate-500 shadow-sm ring-1 ring-slate-100 backdrop-blur">
                      <span>{section.label}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{section.items.length}</span>
                    </div>

                    {section.items.map((service) => {
                      const d = asDetails(service);
                      const proofCount = serviceHasProof(service);
                      const dateText = formatServiceDateRange(d);
                      const route = getServiceRouteText(service, t("not_specified", { defaultValue: "Не указано" }));
                      const canSubmit = service.status === "draft" || service.status === "rejected" || !service.status;
                      const serviceDetails = { ...DEFAULT_DETAILS, ...d, proofImages: Array.isArray(d.proofImages || d.proof_images) ? (d.proofImages || d.proof_images) : [] };
                      const serviceSubmitIssues = buildValidationIssues({
                        category: service.category,
                        title: service.title,
                        description: service.description || d.description || "",
                        price: service.price,
                        images: Array.isArray(service.images) ? service.images : [],
                        details: serviceDetails,
                        isExtended: profile?.type === "agent" && EXTENDED_AGENT_CATEGORIES.includes(service.category),
                        t,
                        requireProof: String(service.category || "").startsWith("refused_"),
                      });
                      const isSubmitReady = serviceSubmitIssues.length === 0;
                      const isSelected = selectedService?.id === service.id;
                      const isTrashOrArchive = isDeletedService(service) || isArchivedService(service);

                      return (
                        <article
                          key={service.id}
                          className={cx(
                            "group overflow-hidden rounded-[1.5rem] border bg-white shadow-sm transition",
                            isSelected
                              ? "border-orange-300 ring-4 ring-orange-100"
                              : "border-slate-200 hover:border-orange-200 hover:shadow-md",
                            isTrashOrArchive && "opacity-75"
                          )}
                        >
                          <button type="button" onClick={() => loadServiceToEdit(service)} className="w-full p-3 text-left">
                            <div className="flex gap-3">
                              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-orange-50">
                                {service.images?.[0] ? (
                                  <img src={service.images[0]} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-2xl">🏝️</div>
                                )}
                                <span className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-black text-orange-700 shadow-sm">
                                  #{service.id}
                                </span>
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-black leading-5 text-slate-950">
                                      {service.title || t("not_specified", { defaultValue: "Не указано" })}
                                    </div>
                                    <div className="mt-0.5 truncate text-[10px] font-black uppercase tracking-wide text-orange-600">
                                      {t(`category.${service.category}`, { defaultValue: service.category })}
                                    </div>
                                  </div>
                                  <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ring-1", getStatusTone(service.status))}>
                                    {getServiceStatusLabel(service.status || service.moderation_status || "draft", t)}
                                  </span>
                                </div>

                                <div className="mt-2 space-y-1 text-xs font-semibold text-slate-600">
                                  <div className="truncate">📍 {route}</div>
                                  <div className="truncate">🗓 {dateText || "—"}</div>
                                  <div className="truncate">💰 {getServicePriceText(service)}</div>
                                </div>

                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  <span className={cx("rounded-full px-2 py-0.5 text-[10px] font-black ring-1", proofCount ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-rose-50 text-rose-700 ring-rose-100")}>
                                    {proofCount ? `Proof: ${proofCount}` : t("service_form.proof_missing_short", { defaultValue: "No proof" })}
                                  </span>
                                  {isDeletedService(service) ? (
                                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600 ring-1 ring-slate-200">
                                      {t("service_status.in_trash", { defaultValue: "В корзине" })}
                                    </span>
                                  ) : isArchivedService(service) ? (
                                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700 ring-1 ring-blue-100">
                                      {getArchiveReasonLabel(service, t)}
                                    </span>
                                  ) : d.isActive === false ? (
                                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-black text-rose-700 ring-1 ring-rose-100">
                                      {t("inactive", { defaultValue: "Неактуально" })}
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700 ring-1 ring-emerald-100">
                                      {t("is_active", { defaultValue: "Актуально" })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </button>

                          {isDeletedService(service) && (
                            <div className="border-t border-slate-100 bg-slate-50 px-3 py-2">
                              <button
                                type="button"
                                onClick={(e) => restoreServiceFromTrash(service, e)}
                                className="w-full rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-emerald-700"
                              >
                                {t("restore_service", { defaultValue: "Восстановить" })}
                              </button>
                            </div>
                          )}

                          {canSubmit && !isTrashOrArchive && (
                            <div className="border-t border-slate-100 bg-slate-50 px-3 py-2">
                              <button
                                type="button"
                                onClick={(e) => submitForModeration(service, e)}
                                disabled={!isSubmitReady}
                                className="w-full rounded-2xl bg-blue-600 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                                title={!isSubmitReady ? serviceSubmitIssues[0] : undefined}
                              >
                                {isSubmitReady
                                  ? t("moderation.send_to_review", { defaultValue: "На модерацию" })
                                  : t("service_form.fix_before_submit", { defaultValue: "Доработать" })}
                              </button>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

          </aside>

          <section className="min-w-0 bg-slate-50/70 p-4 sm:p-6">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xl font-black tracking-[-0.03em] text-slate-950">
                  {selectedService
                    ? t("edit_service", { defaultValue: "Редактирование услуги" })
                    : t("provider_services_tab_create", { defaultValue: "Создать услугу" })}
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-500">
                  {selectedService ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-orange-50 px-2 py-1 text-[11px] font-black text-orange-700 ring-1 ring-orange-100">
                        #{selectedService.id}
                      </span>
                
                      <span
                        className={cx(
                          "rounded-full px-2 py-1 text-[11px] font-black ring-1",
                          getStatusTone(selectedService.status)
                        )}
                      >
                        {getServiceStatusLabel(selectedService.status || selectedService.moderation_status || "draft", t)}
                      </span>
                
                      <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-100">
                        Proof {serviceHasProof({ details })}
                      </span>
                
                      <span className="font-bold text-slate-500">
                        {priceText || "—"}
                      </span>
                    </div>
                  ) : (
                    t("service_form.create_new_hint", {
                      defaultValue:
                        "Заполните форму и сохраните черновик. После proof отправьте на модерацию.",
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-5">
            {selectedService && (
              <div className="mb-5 overflow-hidden rounded-[1.75rem] border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-slate-50 shadow-sm">
                <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-orange-100">
                    {images?.[0] ? <img src={images[0]} alt="" className="h-full w-full object-cover" /> : <span className="text-3xl">🏝️</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-orange-700 ring-1 ring-orange-100">#{selectedService.id}</span>
                      <span className={cx("rounded-full px-2.5 py-1 text-[11px] font-black ring-1", getStatusTone(selectedService.status))}>{getServiceStatusLabel(selectedService.status || selectedService.moderation_status || "draft", t)}</span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-slate-600 ring-1 ring-slate-100">
                        {t(`category.${category}`, { defaultValue: category })}
                      </span>
                    </div>
                    <div className="mt-2 truncate text-lg font-black text-slate-950">
                      {title || t("edit_service", { defaultValue: "Редактирование услуги" })}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                      <span>📍 {routeText}</span>
                      <span>🗓 {dateRangeText || "—"}</span>
                      <span>💰 {priceText || "—"}</span>
                      <span>{serviceHasProof({ details }) ? "✅ Proof" : "⚠️ Proof"}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <Field label={t("select_category", { defaultValue: "Выберите категорию" })}>
              <SelectInput value={category} onChange={(e) => { setCategory(e.target.value); setStep(1); setDetails({ ...DEFAULT_DETAILS }); }}>
                <option value="">{t("select_category", { defaultValue: "Выберите категорию" })}</option>
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>{t(`category.${cat}`, { defaultValue: cat })}</option>
                ))}
              </SelectInput>
            </Field>

            {category && isExtended && (
              <div className="mt-5 rounded-[1.75rem] border border-slate-200 bg-slate-50 p-2">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  {steps.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setStep(item.id)}
                      className={cx("rounded-2xl px-3 py-3 text-left transition", step === item.id ? "bg-slate-950 text-white shadow-lg" : "bg-white text-slate-600 hover:bg-orange-50")}
                    >
                      <div className="text-[10px] font-black uppercase tracking-wide opacity-70">{t("service_form.step", { defaultValue: "Шаг" })} {item.id}</div>
                      <div className="mt-1 text-sm font-black">{item.label}</div>
                      <div className="mt-0.5 line-clamp-1 text-[11px] font-semibold opacity-70">{item.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {category && (
              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-5">
                  {!isExtended ? (
                    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={t("title", { defaultValue: "Название" })}><TextInput value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
                        <Field label={t("price", { defaultValue: "Цена" })}><TextInput inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
                        <div className="sm:col-span-2"><Field label={t("description", { defaultValue: "Описание" })}><TextArea value={description} onChange={(e) => setDescription(e.target.value)} /></Field></div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {step === 1 && (
                        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-4">
                            <div className="text-lg font-black text-slate-950">{t("service_form.step_main", { defaultValue: "Основное" })}</div>
                            <div className="text-sm font-medium text-slate-500">
                              {category === "refused_hotel"
                                ? t("service_form.step_main_hotel_hint", { defaultValue: "Для отеля показываем только направление, город, отель и даты проживания." })
                                : category === "refused_event_ticket"
                                  ? t("service_form.step_main_event_hint", { defaultValue: "Для мероприятия показываем событие, город/локацию и дату." })
                                  : category === "refused_flight"
                                    ? t("service_form.step_main_flight_hint", { defaultValue: "Для авиабилета показываем маршрут и даты рейса." })
                                    : t("service_form.step_main_hint", { defaultValue: "Название, направление и даты" })}
                            </div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                              <Field
                                label={t("title", { defaultValue: "Название" })}
                                hint={t("service_form.hint_title", { defaultValue: "Коротко и понятно: например, «Отказной тур в Нячанг» или «Билет на концерт Coldplay»." })}
                              >
                                <TextInput
                                  value={title}
                                  onChange={(e) => setTitle(e.target.value)}
                                  placeholder={
                                    category === "author_tour"
                                      ? t("service_form.ph_title_author", { defaultValue: "Например: Авторский тур по Самарканду и горам" })
                                      : category === "refused_hotel"
                                      ? t("service_form.ph_title_hotel", { defaultValue: "Например: Отказной отель в Шарм-эль-Шейхе" })
                                      : category === "refused_flight"
                                        ? t("service_form.ph_title_flight", { defaultValue: "Например: Отказной авиабилет Ташкент → Дубай" })
                                        : category === "refused_event_ticket"
                                          ? t("service_form.ph_title_event", { defaultValue: "Например: Отказной билет на концерт" })
                                          : t("service_form.ph_title", { defaultValue: "Например: Отказной тур в Нячанг" })
                                  }
                                />
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <button type="button" onClick={applyAutoTitle} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800">
                                    {t("service_form.auto_title", { defaultValue: "Сформировать название" })}
                                  </button>
                                  <button type="button" onClick={applyAutoDescription} className="rounded-xl bg-orange-50 px-3 py-2 text-xs font-black text-orange-700 ring-1 ring-orange-100 transition hover:bg-orange-100">
                                    {t("service_form.auto_description", { defaultValue: "Сформировать описание" })}
                                  </button>
                                </div>
                              </Field>
                            </div>

                            {category === "refused_hotel" && (
                              <>
                                <Field label={t("direction_country", { defaultValue: "Страна" })} hint={t("service_form.hint_country_hotel", { defaultValue: "Страна, где находится отель." })}>
                                  <TextInput value={details.directionCountry} onChange={(e) => patchDetails({ directionCountry: e.target.value })} placeholder={t("service_form.ph_country", { defaultValue: "Например: Египет" })} />
                                </Field>
                                <Field label={t("city", { defaultValue: "Город / курорт" })} hint={t("service_form.hint_city_hotel", { defaultValue: "Город или курорт отеля." })}>
                                  <TextInput value={details.directionTo} onChange={(e) => patchDetails({ directionTo: e.target.value })} placeholder={t("service_form.ph_city_hotel", { defaultValue: "Например: Шарм-эль-Шейх" })} />
                                </Field>
                                <Field label={t("check_in", { defaultValue: "Дата заезда" })}>
                                  <TextInput type="date" value={details.startDate} onChange={(e) => patchDetails({ startDate: e.target.value })} />
                                </Field>
                                <Field label={t("check_out", { defaultValue: "Дата выезда" })}>
                                  <TextInput type="date" value={details.endDate} onChange={(e) => patchDetails({ endDate: e.target.value })} />
                                </Field>
                              </>
                            )}

                            {category === "refused_event_ticket" && (
                              <>
                                <Field label={t("event_name", { defaultValue: "Название события" })} hint={t("service_form.hint_event_name", { defaultValue: "Концерт, матч, выставка или другое мероприятие." })}>
                                  <TextInput value={details.eventName} onChange={(e) => patchDetails({ eventName: e.target.value })} placeholder={t("service_form.ph_event_name", { defaultValue: "Например: Coldplay Live" })} />
                                </Field>
                                <Field label={t("event_category", { defaultValue: "Тип события" })}>
                                  <TextInput value={details.eventCategory} onChange={(e) => patchDetails({ eventCategory: e.target.value })} placeholder={t("service_form.ph_event_category", { defaultValue: "Концерт / спорт / театр" })} />
                                </Field>
                                <Field label={t("event_date", { defaultValue: "Дата события" })}>
                                  <TextInput type="date" value={details.startDate} onChange={(e) => patchDetails({ startDate: e.target.value })} />
                                </Field>
                                <Field label={t("location", { defaultValue: "Локация" })} hint={t("service_form.hint_event_location", { defaultValue: "Город, площадка или зал." })}>
                                  <TextInput value={details.location} onChange={(e) => patchDetails({ location: e.target.value })} placeholder={t("service_form.ph_event_location", { defaultValue: "Например: Dubai Arena" })} />
                                </Field>
                              </>
                            )}

                            {category === "refused_flight" && (
                              <>
                                <Field label={t("direction_from", { defaultValue: "Город вылета" })} hint={t("service_form.hint_from_flight", { defaultValue: "Откуда вылетает пассажир." })}>
                                  <TextInput value={details.directionFrom} onChange={(e) => patchDetails({ directionFrom: e.target.value })} placeholder={t("service_form.ph_from", { defaultValue: "Например: Ташкент" })} />
                                </Field>
                                <Field label={t("direction_to", { defaultValue: "Город прибытия" })} hint={t("service_form.hint_to_flight", { defaultValue: "Куда прилетает пассажир." })}>
                                  <TextInput value={details.directionTo} onChange={(e) => patchDetails({ directionTo: e.target.value })} placeholder={t("service_form.ph_to", { defaultValue: "Например: Дубай" })} />
                                </Field>
                                <Field label={t("departure_date", { defaultValue: "Дата вылета" })}>
                                  <TextInput type="date" value={details.startDate || details.startFlightDate || ""} onChange={(e) => patchDetails({ startDate: e.target.value, startFlightDate: e.target.value })} />
                                </Field>
                                <Field label={t("return_date", { defaultValue: "Дата обратно" })} hint={t("service_form.hint_return_optional", { defaultValue: "Заполните только если билет туда-обратно." })}>
                                  <TextInput type="date" value={details.returnDate || details.endDate || ""} onChange={(e) => patchDetails({ returnDate: e.target.value, endDate: e.target.value })} />
                                </Field>
                              </>
                            )}

                            {category === "refused_tour" && (
                              <>
                                <Field label={t("direction_country", { defaultValue: "Страна назначения" })} hint={t("service_form.hint_country", { defaultValue: "Страна отдыха или назначения." })}>
                                  <TextInput value={details.directionCountry} onChange={(e) => patchDetails({ directionCountry: e.target.value })} placeholder={t("service_form.ph_country", { defaultValue: "Например: Вьетнам" })} />
                                </Field>
                                <Field label={t("direction_from", { defaultValue: "Город вылета" })} hint={t("service_form.hint_from", { defaultValue: "Откуда начинается поездка." })}>
                                  <TextInput value={details.directionFrom} onChange={(e) => patchDetails({ directionFrom: e.target.value })} placeholder={t("service_form.ph_from", { defaultValue: "Например: Ташкент" })} />
                                </Field>
                                <Field label={t("direction_to", { defaultValue: "Город прибытия" })} hint={t("service_form.hint_to", { defaultValue: "Куда прилетает турист." })}>
                                  <TextInput value={details.directionTo} onChange={(e) => patchDetails({ directionTo: e.target.value })} placeholder={t("service_form.ph_to", { defaultValue: "Например: Нячанг" })} />
                                </Field>
                                <Field label={t("start_date", { defaultValue: "Дата начала" })}>
                                  <TextInput type="date" value={details.startDate} onChange={(e) => patchDetails({ startDate: e.target.value, startFlightDate: e.target.value })} />
                                </Field>
                                <Field label={t("end_date", { defaultValue: "Дата окончания" })}>
                                  <TextInput type="date" value={details.endDate} onChange={(e) => patchDetails({ endDate: e.target.value, endFlightDate: e.target.value })} />
                                </Field>
                              </>
                            )}

                            {category === "author_tour" && (
                              <>
                                <Field label={t("direction_country", { defaultValue: "Страна / направление" })} hint={t("service_form.hint_author_country", { defaultValue: "Куда проходит авторский тур." })}>
                                  <TextInput value={details.directionCountry} onChange={(e) => patchDetails({ directionCountry: e.target.value })} placeholder={t("service_form.ph_country", { defaultValue: "Например: Узбекистан" })} />
                                </Field>
                                <Field label={t("direction_from", { defaultValue: "Город старта" })}>
                                  <TextInput value={details.directionFrom} onChange={(e) => patchDetails({ directionFrom: e.target.value })} placeholder={t("service_form.ph_author_from", { defaultValue: "Например: Самарканд" })} />
                                </Field>
                                <Field label={t("direction_to", { defaultValue: "Город финиша" })}>
                                  <TextInput value={details.directionTo} onChange={(e) => patchDetails({ directionTo: e.target.value })} placeholder={t("service_form.ph_author_to", { defaultValue: "Например: Бухара" })} />
                                </Field>
                                <Field label={t("start_date", { defaultValue: "Дата начала" })}>
                                  <TextInput type="date" value={details.startDate} disabled={!!details.flexibleDates} onChange={(e) => patchDetails({ startDate: e.target.value })} />
                                </Field>
                                <Field label={t("end_date", { defaultValue: "Дата окончания" })}>
                                  <TextInput type="date" value={details.endDate} disabled={!!details.flexibleDates} onChange={(e) => patchDetails({ endDate: e.target.value })} />
                                </Field>
                                <div className="flex items-end">
                                  <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700">
                                    <input type="checkbox" checked={!!details.flexibleDates} onChange={(e) => patchDetails({ flexibleDates: e.target.checked, startDate: e.target.checked ? "" : details.startDate, endDate: e.target.checked ? "" : details.endDate })} />
                                    {t("service_form.flexible_dates", { defaultValue: "Даты по запросу" })}
                                  </label>
                                </div>
                              </>
                            )}

                            {category === "visa_support" && (
                              <>
                                <Field label={t("visa_country", { defaultValue: "Страна визы" })}>
                                  <TextInput value={details.visaCountry} onChange={(e) => patchDetails({ visaCountry: e.target.value })} placeholder={t("service_form.ph_visa_country", { defaultValue: "Например: ОАЭ" })} />
                                </Field>
                                <div className="sm:col-span-2">
                                  <Field label={t("description", { defaultValue: "Описание" })}>
                                    <TextArea value={details.description} onChange={(e) => patchDetails({ description: e.target.value })} />
                                  </Field>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {step === 2 && (
                        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-4">
                            <div className="text-lg font-black text-slate-950">{t("service_form.step_details", { defaultValue: "Детали" })}</div>
                            <div className="text-sm font-medium text-slate-500">
                              {category === "refused_hotel"
                                ? t("service_form.step_details_hotel_hint", { defaultValue: "Номер, размещение, питание и условия отеля." })
                                : category === "refused_event_ticket"
                                  ? t("service_form.step_details_event_hint", { defaultValue: "Категория билета, сектор, ряд, место и важные условия." })
                                  : category === "refused_flight"
                                    ? t("service_form.step_details_flight_hint", { defaultValue: "Авиакомпания, тип рейса, детали рейса и багаж." })
                                    : t("service_form.step_details_hint", { defaultValue: "Отель, рейс, размещение" })}
                            </div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            {category === "refused_tour" && (
                              <>
                                <Field label={t("hotel", { defaultValue: "Отель" })} hint={t("service_form.hint_hotel", { defaultValue: "Название отеля так, как его увидит клиент." })}>
                                  <TextInput value={details.hotel} onChange={(e) => patchDetails({ hotel: e.target.value })} placeholder={t("service_form.ph_hotel", { defaultValue: "Например: Rixos Radamis Sharm El Sheikh 5*" })} />
                                </Field>
                                <Field label={t("accommodation_category", { defaultValue: "Категория размещения" })} hint={t("service_form.hint_room", { defaultValue: "Категория номера или комнаты." })}>
                                  <TextInput value={details.accommodationCategory} onChange={(e) => patchDetails({ accommodationCategory: e.target.value })} placeholder={t("service_form.ph_room", { defaultValue: "Например: Deluxe Sea View" })} />
                                </Field>
                                <Field label={t("accommodation", { defaultValue: "Размещение" })} hint={t("service_form.hint_accommodation", { defaultValue: "Состав туристов: взрослые, дети, младенцы." })}>
                                  <TextInput value={details.accommodation} onChange={(e) => patchDetails({ accommodation: e.target.value })} placeholder={t("service_form.ph_accommodation", { defaultValue: "Например: 2ADL+1CHD" })} />
                                </Field>
                                <Field label={t("food", { defaultValue: "Питание" })} hint={t("service_form.hint_food", { defaultValue: "Выберите тип питания из ваучера или заявки." })}>
                                  <SelectInput value={details.food} onChange={(e) => patchDetails({ food: e.target.value })}>
                                    <option value="">{t("food_options.select", { defaultValue: "Выберите вариант" })}</option>
                                    {foodOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                                  </SelectInput>
                                </Field>
                              </>
                            )}

                            {category === "author_tour" && (
                              <>
                                <Field label={t("service_form.author_duration", { defaultValue: "Длительность" })} hint={t("service_form.hint_author_duration", { defaultValue: "Например: 3 дня / 2 ночи или 8 часов." })}>
                                  <TextInput value={details.duration} onChange={(e) => patchDetails({ duration: e.target.value })} placeholder={t("service_form.ph_author_duration", { defaultValue: "3 дня / 2 ночи" })} />
                                </Field>
                                <Field label={t("service_form.author_format", { defaultValue: "Формат тура" })}>
                                  <SelectInput value={details.tourFormat || "group"} onChange={(e) => patchDetails({ tourFormat: e.target.value })}>
                                    <option value="group">{t("service_form.author_format_group", { defaultValue: "Групповой" })}</option>
                                    <option value="private">{t("service_form.author_format_private", { defaultValue: "Индивидуальный" })}</option>
                                    <option value="custom">{t("service_form.author_format_custom", { defaultValue: "Под запрос" })}</option>
                                  </SelectInput>
                                </Field>
                                <Field label={t("service_form.author_min_pax", { defaultValue: "Мин. человек" })}>
                                  <TextInput value={details.minPax} onChange={(e) => patchDetails({ minPax: e.target.value })} placeholder="2" />
                                </Field>
                                <Field label={t("service_form.author_max_pax", { defaultValue: "Макс. человек" })}>
                                  <TextInput value={details.maxPax} onChange={(e) => patchDetails({ maxPax: e.target.value })} placeholder="10" />
                                </Field>
                                <Field label={t("service_form.guide_language", { defaultValue: "Язык гида" })}>
                                  <TextInput value={details.guideLanguage} onChange={(e) => patchDetails({ guideLanguage: e.target.value })} placeholder={t("service_form.ph_guide_language", { defaultValue: "Русский / английский / узбекский" })} />
                                </Field>
                                <Field label={t("service_form.meeting_point", { defaultValue: "Место встречи" })}>
                                  <TextInput value={details.meetingPoint} onChange={(e) => patchDetails({ meetingPoint: e.target.value })} placeholder={t("service_form.ph_meeting_point", { defaultValue: "Отель / аэропорт / центр города" })} />
                                </Field>
                                <div className="sm:col-span-2">
                                  <Field label={t("service_form.author_program", { defaultValue: "Программа тура" })}>
                                    <TextArea value={details.program} onChange={(e) => patchDetails({ program: e.target.value })} placeholder={t("service_form.ph_author_program", { defaultValue: "День 1: встреча, обзорная экскурсия..." })} className="min-h-[160px]" />
                                  </Field>
                                </div>
                                <div className="sm:col-span-2 grid gap-4 sm:grid-cols-2">
                                  <Field label={t("service_form.included", { defaultValue: "Что включено" })}>
                                    <TextArea value={details.included} onChange={(e) => patchDetails({ included: e.target.value })} className="min-h-[120px]" />
                                  </Field>
                                  <Field label={t("service_form.not_included", { defaultValue: "Что не включено" })}>
                                    <TextArea value={details.notIncluded} onChange={(e) => patchDetails({ notIncluded: e.target.value })} className="min-h-[120px]" />
                                  </Field>
                                </div>
                                <div className="sm:col-span-2 flex flex-wrap gap-2">
                                  <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700">
                                    <input type="checkbox" checked={!!details.guideIncluded} onChange={(e) => patchDetails({ guideIncluded: e.target.checked })} />
                                    {t("service_form.guide_included", { defaultValue: "Гид включён" })}
                                  </label>
                                  <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-700">
                                    <input type="checkbox" checked={!!details.transportIncluded} onChange={(e) => patchDetails({ transportIncluded: e.target.checked, transport: e.target.checked ? "included" : "not_included" })} />
                                    {t("service_form.transport_included", { defaultValue: "Транспорт включён" })}
                                  </label>
                                </div>
                                <div className="sm:col-span-2">
                                  <Field label={t("service_form.cancellation_policy", { defaultValue: "Условия отмены / важные условия" })}>
                                    <TextArea value={details.cancellationPolicy} onChange={(e) => patchDetails({ cancellationPolicy: e.target.value })} />
                                  </Field>
                                </div>
                              </>
                            )}

                            {category === "refused_hotel" && (
                              <>
                                <Field label={t("hotel", { defaultValue: "Отель" })} hint={t("service_form.hint_hotel", { defaultValue: "Название отеля так, как его увидит клиент." })}>
                                  <TextInput value={details.hotel} onChange={(e) => patchDetails({ hotel: e.target.value })} placeholder={t("service_form.ph_hotel", { defaultValue: "Например: Rixos Radamis Sharm El Sheikh 5*" })} />
                                </Field>
                                <Field label={t("room_category", { defaultValue: "Категория номера" })}>
                                  <TextInput value={details.accommodationCategory} onChange={(e) => patchDetails({ accommodationCategory: e.target.value })} placeholder={t("service_form.ph_room", { defaultValue: "Например: Deluxe Sea View" })} />
                                </Field>
                                <Field label={t("accommodation", { defaultValue: "Размещение" })}>
                                  <TextInput value={details.accommodation} onChange={(e) => patchDetails({ accommodation: e.target.value })} placeholder={t("service_form.ph_accommodation", { defaultValue: "Например: DBL / 2ADL" })} />
                                </Field>
                                <Field label={t("food", { defaultValue: "Питание" })}>
                                  <SelectInput value={details.food} onChange={(e) => patchDetails({ food: e.target.value })}>
                                    <option value="">{t("food_options.select", { defaultValue: "Выберите вариант" })}</option>
                                    {foodOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                                  </SelectInput>
                                </Field>
                              </>
                            )}

                            {category === "refused_flight" && (
                              <>
                                <Field label={t("airline", { defaultValue: "Авиакомпания" })} hint={t("service_form.hint_airline", { defaultValue: "Код или название авиакомпании." })}>
                                  <TextInput value={details.airline} onChange={(e) => patchDetails({ airline: e.target.value.toUpperCase() })} placeholder={t("service_form.ph_airline", { defaultValue: "Например: HH" })} />
                                </Field>
                                <Field label={t("flight_type", { defaultValue: "Тип рейса" })}>
                                  <SelectInput value={details.flightType} onChange={(e) => patchDetails({ flightType: e.target.value })}>
                                    <option value="one_way">{t("one_way", { defaultValue: "В одну сторону" })}</option>
                                    <option value="round_trip">{t("round_trip", { defaultValue: "Туда-обратно" })}</option>
                                  </SelectInput>
                                </Field>
                              </>
                            )}

                            {category === "refused_event_ticket" && (
                              <>
                                <Field label={t("ticketDetails", { defaultValue: "Детали билета" })} hint={t("service_form.hint_ticket_details", { defaultValue: "Сектор, ряд, место, категория, количество билетов." })}>
                                  <TextArea value={details.ticketDetails} onChange={(e) => patchDetails({ ticketDetails: e.target.value })} placeholder={t("service_form.ph_ticket_details", { defaultValue: "Например: Sector A, Row 5, Seat 12–13, 2 tickets" })} />
                                </Field>
                              </>
                            )}

                            {["refused_tour", "refused_flight"].includes(category) && (
                              <div className="sm:col-span-2">
                                <Field
                                  label={t("flight_details", { defaultValue: "Детали рейса" })}
                                  hint={t("service_form.flight_details_format_hint", {
                                    defaultValue:
                                      "Строгий формат: 15MAY HH-9911 TASDXB 18:00 21:00 / 22MAY HH-9912 DXBTAS 22:00 05:00 / 23KG/8KG",
                                  })}
                                >
                                  <TextArea
                                    value={details.flightDetails}
                                    onChange={(e) => patchDetails({ flightDetails: e.target.value.toUpperCase() })}
                                    placeholder={FLIGHT_DETAILS_EXAMPLE}
                                    className="min-h-[132px] font-mono text-[13px] leading-6"
                                  />
                                </Field>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <button type="button" onClick={() => patchDetails({ flightDetails: FLIGHT_DETAILS_EXAMPLE })} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800">
                                    {t("service_form.insert_flight_example", { defaultValue: "Вставить пример формата" })}
                                  </button>
                                  <span className="text-xs font-semibold text-slate-500">
                                    {t("service_form.flight_details_required", { defaultValue: "Это поле обязательно для отказного тура и авиабилета." })}
                                  </span>
                                </div>
                              </div>
                            )}

                            {category === "visa_support" && (
                              <>
                                <Field label={t("visa_country", { defaultValue: "Страна визы" })}><TextInput value={details.visaCountry} onChange={(e) => patchDetails({ visaCountry: e.target.value })} /></Field>
                                <div className="sm:col-span-2"><Field label={t("description", { defaultValue: "Описание" })}><TextArea value={details.description} onChange={(e) => patchDetails({ description: e.target.value })} /></Field></div>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {step === 3 && (
                        <div className="space-y-4">
                          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-4">
                              <div className="text-lg font-black text-slate-950">{t("service_form.step_value", { defaultValue: "Ценность" })}</div>
                              <div className="text-sm font-medium text-slate-500">{t("service_form.step_value_hint", { defaultValue: "Что включено и proof" })}</div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label={t("transfer", { defaultValue: "Трансфер" })}>
                                <SelectInput value={details.transfer} onChange={(e) => patchDetails({ transfer: e.target.value })}>
                                  <option value="">{t("food_options.select", { defaultValue: "Выберите вариант" })}</option>
                                  {transferOptions.map((x) => <option key={x} value={x}>{x}</option>)}
                                </SelectInput>
                              </Field>
                              <Toggle checked={details.visaIncluded} onChange={(v) => patchDetails({ visaIncluded: v })} label={t("visa_included", { defaultValue: "Виза включена" })} />
                              <Toggle checked={details.insuranceIncluded} onChange={(v) => patchDetails({ insuranceIncluded: v })} label={t("insurance_included", { defaultValue: "Страховка включена" })} />
                              <Toggle checked={details.earlyCheckIn} onChange={(v) => patchDetails({ earlyCheckIn: v })} label={t("early_check_in", { defaultValue: "Раннее заселение" })} />
                              <Toggle checked={details.arrivalFastTrack} onChange={(v) => patchDetails({ arrivalFastTrack: v })} label={t("arrival_fast_track", { defaultValue: "Arrival Fast Track" })} />
                              <Toggle checked={details.changeable} onChange={(v) => patchDetails({ changeable: v })} label={t("changeable", { defaultValue: "Можно вносить изменения" })} />
                            </div>
                          </div>
                          <ImageUploader
                            title={t("service_form.proof_trust_title", { defaultValue: "Подтверждение подлинности" })}
                            hint={t("service_form.proof_trust_hint", { defaultValue: "Скриншоты подтверждения помогают клиенту быстрее решиться открыть контакты поставщика." })}
                            images={details.proofImages || []}
                            onChange={(next) => patchDetails({ proofImages: next })}
                            max={6}
                          />
                          <div className={cx("rounded-[1.5rem] border p-4", (details.proofImages || []).filter(Boolean).length ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-amber-100 bg-amber-50 text-amber-800")}>
                            <div className="flex items-start gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white text-lg shadow-sm">
                                {(details.proofImages || []).filter(Boolean).length ? "✅" : "⚠️"}
                              </span>
                              <div>
                                <div className="text-sm font-black">
                                  {(details.proofImages || []).filter(Boolean).length
                                    ? t("service_form.proof_ok_title", { defaultValue: "Proof добавлен" })
                                    : t("service_form.proof_missing_title", { defaultValue: "Без proof нельзя отправить отказную услугу на модерацию" })}
                                </div>
                                <div className="mt-1 text-xs font-semibold leading-5 opacity-80">
                                  {(details.proofImages || []).filter(Boolean).length
                                    ? t("service_form.proof_ok_hint", { defaultValue: "Админ увидит подтверждение, а карточка будет выглядеть надежнее для клиента." })
                                    : t("service_form.proof_missing_hint", { defaultValue: "Загрузите скрин/ваучер/подтверждение брони. Это защищает маркетплейс от фейковых отказов." })}
                                </div>
                                <div className="mt-2 text-xs font-black">
                                  {t("service_form.proof_count", { defaultValue: "Proof-файлов" })}: {(details.proofImages || []).filter(Boolean).length}/6
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {step === 4 && (
                        <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="mb-4">
                            <div className="text-lg font-black text-slate-950">{t("service_form.step_price", { defaultValue: "Цена" })}</div>
                            <div className="text-sm font-medium text-slate-500">{t("service_form.step_price_hint", { defaultValue: "Стоимость и актуальность" })}</div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Field label={t("net_price", { defaultValue: "Цена нетто" })} hint={t("service_form.hint_net_price", { defaultValue: "Внутренняя цена поставщика. Клиент её не видит." })}><TextInput inputMode="decimal" value={details.netPrice} onChange={(e) => patchDetails({ netPrice: e.target.value })} placeholder={t("service_form.ph_net_price", { defaultValue: "Например: 2500" })} /></Field>
                            <Field label={t("gross_price", { defaultValue: "Цена для клиента" })} hint={t("service_form.hint_gross_price", { defaultValue: "Цена, которую клиент увидит в маркетплейсе." })}><TextInput inputMode="decimal" value={details.grossPrice} onChange={(e) => patchDetails({ grossPrice: e.target.value })} placeholder={t("service_form.ph_gross_price", { defaultValue: "Например: 2750" })} /></Field>
                            <Field label={t("expiration_timer", { defaultValue: "Таймер актуальности" })} hint={t("service_form.expiration_hint", { defaultValue: "После этого времени предложение станет менее актуальным." })}>
                              <TextInput type="datetime-local" value={details.expiration} onChange={(e) => patchDetails({ expiration: e.target.value })} />
                            </Field>
                            <Toggle checked={details.isActive} onChange={(v) => patchDetails({ isActive: v })} label={t("is_active", { defaultValue: "Актуально" })} />
                          </div>
                        </div>
                      )}

                      {step === 5 && (
                        <div className="rounded-[1.5rem] border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-4 shadow-sm">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="text-lg font-black text-slate-950">{t("service_form.step_preview", { defaultValue: "Предпросмотр" })}</div>
                              <p className="mt-1 text-sm font-medium leading-6 text-slate-600">{t("service_form.step_preview_hint", { defaultValue: "Проверьте, как клиент увидит вашу услугу." })}</p>
                            </div>
                            <div className={cx("rounded-2xl px-3 py-2 text-xs font-black ring-1", readinessAllDone ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-amber-50 text-amber-700 ring-amber-100")}>
                              {readinessDone}/{readinessItems.length} {t("service_form.ready_done", { defaultValue: "готово" })}
                            </div>
                          </div>

                          <div className="mt-4 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="mb-3 text-sm font-black text-slate-950">{t("service_form.ready_checklist", { defaultValue: "Checklist перед модерацией" })}</div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {readinessItems.map((item) => (
                                <div key={item.label} className={cx("flex items-center gap-2 rounded-2xl px-3 py-2 text-xs font-black ring-1", item.ok ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-slate-50 text-slate-500 ring-slate-100")}>
                                  <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]", item.ok ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500")}>{item.ok ? "✓" : "•"}</span>
                                  <span>{item.label}</span>
                                </div>
                              ))}
                            </div>
                            {!readinessAllDone && (
                              <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800 ring-1 ring-amber-100">
                                {t("service_form.ready_hint", { defaultValue: "Можно сохранить черновик сейчас, но перед модерацией лучше закрыть все пункты checklist." })}
                              </div>
                            )}
                          </div>

                          <div className="mt-4">
                            <MarketplacePreviewCard
                              category={category}
                              title={title}
                              routeText={routeText}
                              dateRangeText={dateRangeText}
                              priceText={priceText}
                              images={images}
                              details={details}
                              includedPreview={includedPreview}
                              t={t}
                            />
                          </div>

                          {moderationValidationIssues.length > 0 && (
                            <div className="mt-4 rounded-[1.5rem] border border-rose-100 bg-rose-50 p-4 text-rose-800">
                              <div className="text-sm font-black">{t("service_form.cannot_submit_yet", { defaultValue: "Пока нельзя отправить на модерацию" })}</div>
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs font-semibold leading-5">
                                {moderationValidationIssues.slice(0, 8).map((issue) => <li key={issue}>{issue}</li>)}
                              </ul>
                            </div>
                          )}                        </div>
                      )}
                    </>
                  )}

                  <ImageUploader title={t("service_images", { defaultValue: "Фото услуги" })} hint={t("images_hint", { defaultValue: "До 10 изображений, ≤ 3 МБ каждое" })} images={images} onChange={setImages} max={10} />

                  <div className="sticky bottom-0 z-20 -mx-4 flex gap-2 border-t border-slate-100 bg-white/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
                    {isExtended && step > 1 && (
                      <button type="button" onClick={() => setStep((v) => Math.max(1, v - 1))} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600">
                        {t("service_form.prev_step", { defaultValue: "Назад" })}
                      </button>
                    )}
                    {isExtended && step < steps.length ? (
                      <button type="button" onClick={() => setStep((v) => Math.min(steps.length, v + 1))} className="w-full rounded-2xl bg-slate-950 py-3 text-sm font-black text-white shadow-sm hover:bg-slate-800">
                        {t("service_form.next_step", { defaultValue: "Следующий шаг" })}
                      </button>
                    ) : (
                      <button type="button" onClick={saveService} disabled={saving} className="w-full rounded-2xl bg-orange-500 py-3 text-sm font-black text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-60">
                        {saving ? t("saving", { defaultValue: "Сохраняю…" }) : t("save_service", { defaultValue: "Сохранить услугу" })}
                      </button>
                    )}
                    {selectedService?.id && <button type="button" onClick={() => deleteService(selectedService)} className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-white">{t("delete", { defaultValue: "Удалить" })}</button>}
                  </div>
                </div>

                <aside className="hidden xl:block">
                  <div className="sticky top-5 space-y-4">
                    <MarketplacePreviewCard
                      category={category}
                      title={title}
                      routeText={routeText}
                      dateRangeText={dateRangeText}
                      priceText={priceText}
                      images={images}
                      details={details}
                      includedPreview={includedPreview}
                      t={t}
                    />
                    <div className="rounded-2xl bg-orange-50 p-3 text-xs font-semibold leading-5 text-orange-800 ring-1 ring-orange-100">
                      {t("service_form.preview_tip", { defaultValue: "Так клиент будет воспринимать вашу услугу. Фото и proof повышают доверие." })}
                    </div>
                  </div>
                </aside>
              </div>
            )}
            </div>
          </section>
        </div>
      </div>

      <SupportAfterCreateModal
        open={!!supportPromptService}
        service={supportPromptService}
        busy={supportPayBusy}
        error={supportPayError}
        onClose={() => {
          if (!supportPayBusy) {
            setSupportPayError("");
            setSupportPromptService(null);
          }
        }}
        onPay={createSupportPaymentAfterService}
      />

      <ConfirmModal
        open={!!confirmModal}
        danger={confirmModal?.type === "delete"}
        busy={confirmBusy}
        title={
          confirmModal?.type === "delete"
            ? t("confirm_delete_service_title", { defaultValue: "Удалить услугу" })
            : t("confirm_restore_service_title", { defaultValue: "Восстановить услугу" })
        }
        message={
          confirmModal?.type === "delete"
            ? t("confirm_delete_service_full", {
                defaultValue: `Удалить #R${confirmModal?.service?.id || ""}? Услуга уйдет в корзину и будет скрыта из активных.`,
              })
            : t("confirm_restore_service", {
                defaultValue: `Восстановить #R${confirmModal?.service?.id || ""} в черновики?`,
              })
        }
        confirmLabel={
          confirmModal?.type === "delete"
            ? t("delete", { defaultValue: "Удалить" })
            : t("restore_service", { defaultValue: "Восстановить" })
        }
        cancelLabel={t("actions.cancel", { defaultValue: "Отмена" })}
        onClose={() => {
          if (!confirmBusy) setConfirmModal(null);
        }}
        onConfirm={handleConfirmModalConfirm}
      />
    </div>
  );
}
