// backend/utils/serviceCategoryContract.js
// Travella Wizard Engine v2 — single source of truth for refused service fields.
// Every category contract below defines one ordered field list used by:
// Telegram create wizard, Telegram edit wizard, draft progress, quality,
// submit validation and moderation blockers.

const { normalizeCategory } = require("./serviceCategories");

const STEP = Object.freeze({
  TITLE: "svc_create_title",
  COUNTRY: "svc_create_tour_country",
  FROM: "svc_create_tour_from",
  TO: "svc_create_tour_to",
  TOUR_START: "svc_create_tour_start",
  TOUR_END: "svc_create_tour_end",
  FLIGHT_TYPE: "svc_create_flight_type",
  FLIGHT_DEPARTURE: "svc_create_flight_departure",
  FLIGHT_RETURN: "svc_create_flight_return",
  FLIGHT_AIRLINE: "svc_create_flight_airline",
  FLIGHT_DETAILS: "svc_create_flight_details",
  TOUR_HOTEL: "svc_create_tour_hotel",
  TOUR_ACCOMMODATION: "svc_create_tour_accommodation",
  TOUR_ROOM: "svc_create_tour_roomcat",
  TOUR_FOOD: "svc_create_tour_food",
  TOUR_TRANSFER: "svc_create_tour_transfer",
  TOUR_INSURANCE: "svc_create_tour_insurance",
  TOUR_VISA: "svc_create_tour_visa",
  TOUR_EARLY_CHECKIN: "svc_create_tour_early_checkin",
  TOUR_FAST_TRACK: "svc_create_tour_fast_track",
  HOTEL_COUNTRY: "svc_hotel_country",
  HOTEL_CITY: "svc_hotel_city",
  HOTEL_NAME: "svc_hotel_name",
  HOTEL_CHECKIN: "svc_hotel_checkin",
  HOTEL_CHECKOUT: "svc_hotel_checkout",
  HOTEL_ROOM: "svc_hotel_roomcat",
  HOTEL_ACCOMMODATION: "svc_hotel_accommodation",
  HOTEL_FOOD: "svc_hotel_food",
  HOTEL_HALAL: "svc_hotel_halal",
  HOTEL_TRANSFER: "svc_hotel_transfer",
  HOTEL_CHANGEABLE: "svc_hotel_changeable",
  HOTEL_PAX: "svc_hotel_pax",
  HOTEL_INSURANCE: "svc_hotel_insurance",
  HOTEL_EARLY_CHECKIN: "svc_hotel_early_checkin",
  HOTEL_FAST_TRACK: "svc_hotel_fast_track",
  TICKET_EVENT_DATE: "svc_ticket_event_date",
  PRICE: "svc_create_price",
  GROSS_PRICE: "svc_create_grossPrice",
  URGENCY: "svc_create_urgency",
  EXPIRATION: "svc_create_expiration",
  PHOTO: "svc_create_photo",
});

const EDIT_STEP_BY_CREATE_STEP = Object.freeze({
  [STEP.TITLE]: "svc_edit_title",
  [STEP.COUNTRY]: "svc_edit_tour_country",
  [STEP.FROM]: "svc_edit_tour_from",
  [STEP.TO]: "svc_edit_tour_to",
  [STEP.TOUR_START]: "svc_edit_tour_start",
  [STEP.TOUR_END]: "svc_edit_tour_end",
  [STEP.FLIGHT_TYPE]: "svc_edit_flight_type",
  [STEP.FLIGHT_DEPARTURE]: "svc_edit_flight_departure",
  [STEP.FLIGHT_RETURN]: "svc_edit_flight_return",
  [STEP.FLIGHT_AIRLINE]: "svc_edit_flight_airline",
  [STEP.FLIGHT_DETAILS]: "svc_edit_flight_details",
  [STEP.TOUR_HOTEL]: "svc_edit_tour_hotel",
  [STEP.TOUR_ACCOMMODATION]: "svc_edit_tour_accommodation",
  [STEP.TOUR_ROOM]: "svc_edit_tour_roomcat",
  [STEP.TOUR_FOOD]: "svc_edit_tour_food",
  [STEP.TOUR_TRANSFER]: "svc_edit_tour_transfer",
  [STEP.TOUR_INSURANCE]: "svc_edit_tour_insurance",
  [STEP.TOUR_VISA]: "svc_edit_tour_visa",
  [STEP.TOUR_EARLY_CHECKIN]: "svc_edit_tour_early_checkin",
  [STEP.TOUR_FAST_TRACK]: "svc_edit_tour_fast_track",
  [STEP.HOTEL_COUNTRY]: "svc_edit_hotel_country",
  [STEP.HOTEL_CITY]: "svc_edit_hotel_city",
  [STEP.HOTEL_NAME]: "svc_edit_hotel_name",
  [STEP.HOTEL_CHECKIN]: "svc_edit_hotel_checkin",
  [STEP.HOTEL_CHECKOUT]: "svc_edit_hotel_checkout",
  [STEP.HOTEL_ROOM]: "svc_edit_hotel_roomcat",
  [STEP.HOTEL_ACCOMMODATION]: "svc_edit_hotel_accommodation",
  [STEP.HOTEL_FOOD]: "svc_edit_hotel_food",
  [STEP.HOTEL_HALAL]: "svc_edit_hotel_halal",
  [STEP.HOTEL_TRANSFER]: "svc_edit_hotel_transfer",
  [STEP.HOTEL_CHANGEABLE]: "svc_edit_hotel_changeable",
  [STEP.HOTEL_PAX]: "svc_edit_hotel_pax",
  [STEP.HOTEL_INSURANCE]: "svc_edit_hotel_insurance",
  [STEP.HOTEL_EARLY_CHECKIN]: "svc_edit_hotel_early_checkin",
  [STEP.HOTEL_FAST_TRACK]: "svc_edit_hotel_fast_track",
  [STEP.TICKET_EVENT_DATE]: "svc_edit_ticket_date",
  [STEP.PRICE]: "svc_edit_price",
  [STEP.GROSS_PRICE]: "svc_edit_grossPrice",
  [STEP.EXPIRATION]: "svc_edit_expiration",
  [STEP.PHOTO]: "svc_edit_images",
});

const edit = (step, fallback) => EDIT_STEP_BY_CREATE_STEP[step] || fallback || step;

function f(key, label, createStep, opts = {}) {
  return Object.freeze({
    key,
    label,
    createStep,
    editStep: Object.prototype.hasOwnProperty.call(opts, "editStep") ? opts.editStep : edit(createStep),
    required: opts.required !== false,
    recommended: opts.recommended === true || opts.required === false,
    weight: Number(opts.weight || (opts.required === false ? 1 : 2)),
    code: opts.code || `${String(key || "FIELD").toUpperCase()}_REQUIRED`,
    skipWhen: opts.skipWhen || null,
  });
}

const COMMERCIAL_FIELDS = Object.freeze([
  f("netPrice", "Цена нетто", STEP.PRICE, { code: "NET_PRICE_REQUIRED", weight: 3 }),
  f("grossPrice", "Цена для клиента", STEP.GROSS_PRICE, { code: "GROSS_PRICE_REQUIRED", weight: 3 }),
  f("grossPriceNotBelowNet", "Цена для клиента не ниже нетто", null, { code: "GROSS_PRICE_TOO_LOW", weight: 1 }),
  f("urgency", "Срочность продажи", STEP.URGENCY, { required: false, recommended: true, weight: 1, editStep: null }),
  f("expiration", "Срок актуальности", STEP.EXPIRATION, { required: false, recommended: true, weight: 1 }),
  f("photo", "Фото услуги", STEP.PHOTO, { required: false, recommended: true, weight: 1 }),
  f("proof", "Proof / подтверждение", null, { code: "PROOF_IMAGES_REQUIRED", weight: 3 }),
]);

const CONTRACTS = Object.freeze({
  refused_tour: Object.freeze([
    f("title", "Название", STEP.TITLE, { code: "TITLE_REQUIRED", weight: 2 }),
    f("country", "Страна направления", STEP.COUNTRY, { code: "COUNTRY_REQUIRED", weight: 2 }),
    f("from", "Город вылета", STEP.FROM, { code: "FROM_REQUIRED", weight: 2 }),
    f("to", "Город прибытия / курорт", STEP.TO, { code: "TO_REQUIRED", weight: 2 }),
    f("startDate", "Дата начала тура", STEP.TOUR_START, { code: "START_DATE_REQUIRED", weight: 2 }),
    f("endDate", "Дата окончания тура", STEP.TOUR_END, { code: "END_DATE_REQUIRED", weight: 2 }),
    f("departureDate", "Дата рейса вылета", STEP.FLIGHT_DEPARTURE, { required: false, recommended: true, weight: 1 }),
    f("returnDate", "Дата рейса обратно", STEP.FLIGHT_RETURN, { required: false, recommended: true, weight: 1 }),
    f("airline", "Авиакомпания", STEP.FLIGHT_AIRLINE, { required: false, recommended: true, weight: 1 }),
    f("flightDetails", "Номер/время рейса", STEP.FLIGHT_DETAILS, { required: false, recommended: true, weight: 1 }),
    f("hotel", "Отель", STEP.TOUR_HOTEL, { code: "HOTEL_REQUIRED", weight: 3 }),
    f("accommodation", "Размещение", STEP.TOUR_ACCOMMODATION, { code: "ACCOMMODATION_REQUIRED", weight: 2 }),
    f("room", "Категория номера", STEP.TOUR_ROOM, { required: false, recommended: true, weight: 1 }),
    f("meal", "Питание", STEP.TOUR_FOOD, { required: false, recommended: true, weight: 1 }),
    f("transfer", "Трансфер", STEP.TOUR_TRANSFER, { required: false, recommended: true, weight: 1 }),
    f("insurance", "Страховка", STEP.TOUR_INSURANCE, { required: false, recommended: true, weight: 1 }),
    f("visa", "Виза", STEP.TOUR_VISA, { required: false, recommended: true, weight: 1 }),
    f("earlyCheckIn", "Раннее заселение", STEP.TOUR_EARLY_CHECKIN, { required: false, recommended: true, weight: 1 }),
    f("arrivalFastTrack", "Fast Track", STEP.TOUR_FAST_TRACK, { required: false, recommended: true, weight: 1 }),
    ...COMMERCIAL_FIELDS,
  ]),

  refused_hotel: Object.freeze([
    f("title", "Название", STEP.TITLE, { code: "TITLE_REQUIRED", weight: 2 }),
    f("country", "Страна", STEP.HOTEL_COUNTRY, { code: "COUNTRY_REQUIRED", weight: 2 }),
    f("city", "Город / курорт", STEP.HOTEL_CITY, { code: "CITY_REQUIRED", weight: 2 }),
    f("hotel", "Отель", STEP.HOTEL_NAME, { code: "HOTEL_REQUIRED", weight: 3 }),
    f("checkin", "Дата заезда", STEP.HOTEL_CHECKIN, { code: "CHECKIN_REQUIRED", weight: 2 }),
    f("checkout", "Дата выезда", STEP.HOTEL_CHECKOUT, { code: "CHECKOUT_REQUIRED", weight: 2 }),
    f("room", "Категория номера", STEP.HOTEL_ROOM, { required: false, recommended: true, weight: 1 }),
    f("accommodation", "Размещение", STEP.HOTEL_ACCOMMODATION, { code: "ACCOMMODATION_REQUIRED", weight: 2 }),
    f("meal", "Питание", STEP.HOTEL_FOOD, { required: false, recommended: true, weight: 1 }),
    f("halal", "Halal", STEP.HOTEL_HALAL, { required: false, recommended: true, weight: 1 }),
    f("transfer", "Трансфер", STEP.HOTEL_TRANSFER, { required: false, recommended: true, weight: 1 }),
    f("changeable", "Можно менять", STEP.HOTEL_CHANGEABLE, { required: false, recommended: true, weight: 1 }),
    f("pax", "Количество гостей", STEP.HOTEL_PAX, { required: false, recommended: true, weight: 1 }),
    f("insurance", "Страховка", STEP.HOTEL_INSURANCE, { required: false, recommended: true, weight: 1 }),
    f("earlyCheckIn", "Раннее заселение", STEP.HOTEL_EARLY_CHECKIN, { required: false, recommended: true, weight: 1 }),
    f("arrivalFastTrack", "Fast Track", STEP.HOTEL_FAST_TRACK, { required: false, recommended: true, weight: 1 }),
    ...COMMERCIAL_FIELDS,
  ]),

  refused_flight: Object.freeze([
    f("title", "Название", STEP.TITLE, { code: "TITLE_REQUIRED", weight: 2 }),
    f("from", "Город вылета", STEP.FROM, { code: "FROM_REQUIRED", weight: 2, editStep: "svc_edit_flight_from" }),
    f("to", "Город прибытия", STEP.TO, { code: "TO_REQUIRED", weight: 2, editStep: "svc_edit_flight_to" }),
    f("flightType", "Тип перелёта", STEP.FLIGHT_TYPE, { required: false, recommended: true, weight: 1 }),
    f("departureDate", "Дата вылета", STEP.FLIGHT_DEPARTURE, { code: "DEPARTURE_DATE_REQUIRED", weight: 3 }),
    f("returnDate", "Дата обратного рейса", STEP.FLIGHT_RETURN, { code: "RETURN_DATE_REQUIRED", weight: 2, skipWhen: "one_way" }),
    f("airline", "Авиакомпания", STEP.FLIGHT_AIRLINE, { code: "AIRLINE_REQUIRED", weight: 2 }),
    f("flightDetails", "Номер/время рейса", STEP.FLIGHT_DETAILS, { code: "FLIGHT_DETAILS_REQUIRED", weight: 2 }),
    ...COMMERCIAL_FIELDS,
  ]),

  refused_ticket: Object.freeze([
    f("title", "Название мероприятия", STEP.TITLE, { code: "EVENT_NAME_REQUIRED", weight: 3 }),
    f("country", "Страна", STEP.COUNTRY, { required: false, recommended: true, weight: 1, editStep: "svc_edit_ticket_country" }),
    f("eventCity", "Город / площадка", STEP.TO, { code: "EVENT_CITY_REQUIRED", weight: 2, editStep: "svc_edit_ticket_city" }),
    f("eventDate", "Дата мероприятия", STEP.TICKET_EVENT_DATE, { code: "EVENT_DATE_REQUIRED", weight: 3 }),
    f("ticketDetails", "Сектор/ряд/место или тип билета", null, { required: false, recommended: true, code: "TICKET_DETAILS_RECOMMENDED", weight: 1 }),
    f("quantity", "Количество билетов", null, { required: false, recommended: true, weight: 1 }),
    ...COMMERCIAL_FIELDS,
  ]),

  refused_event_ticket: Object.freeze([
    f("title", "Название мероприятия", STEP.TITLE, { code: "EVENT_NAME_REQUIRED", weight: 3 }),
    f("country", "Страна", STEP.COUNTRY, { required: false, recommended: true, weight: 1, editStep: "svc_edit_ticket_country" }),
    f("eventCity", "Город / площадка", STEP.TO, { code: "EVENT_CITY_REQUIRED", weight: 2, editStep: "svc_edit_ticket_city" }),
    f("eventDate", "Дата мероприятия", STEP.TICKET_EVENT_DATE, { code: "EVENT_DATE_REQUIRED", weight: 3 }),
    f("ticketDetails", "Сектор/ряд/место или тип билета", null, { required: false, recommended: true, code: "TICKET_DETAILS_RECOMMENDED", weight: 1 }),
    f("quantity", "Количество билетов", null, { required: false, recommended: true, weight: 1 }),
    ...COMMERCIAL_FIELDS,
  ]),

  author_tour: Object.freeze([
    f("title", "Название", "svc_author_title", { required: false, recommended: true, code: "TITLE_REQUIRED", weight: 2 }),
    f("country", "Страна / направление", "svc_author_country", { code: "COUNTRY_REQUIRED", weight: 2 }),
    f("from", "Город отправления", "svc_author_from", { code: "FROM_REQUIRED", weight: 2 }),
    f("to", "Маршрут / город прибытия", "svc_author_to", { code: "TO_REQUIRED", weight: 2 }),
    f("startDate", "Дата начала тура", "svc_author_start", { code: "START_DATE_REQUIRED", weight: 2 }),
    f("endDate", "Дата окончания тура", "svc_author_end", { code: "END_DATE_REQUIRED", weight: 2 }),
    f("format", "Формат тура", "svc_author_format", { required: false, recommended: true, weight: 1 }),
    f("stays", "Проживание тура", "svc_author_stays", { required: false, recommended: true, weight: 1 }),
    f("program", "Программа авторского тура", "svc_author_program_days", { code: "PROGRAM_REQUIRED", weight: 3 }),
    f("included", "Что включено", "svc_author_included", { code: "INCLUDED_REQUIRED", weight: 2 }),
    f("notIncluded", "Что не включено", "svc_author_not_included", { required: false, recommended: true, weight: 1 }),
    f("pax", "Количество человек", "svc_author_pax", { required: false, recommended: true, weight: 1 }),
    f("language", "Язык гида", "svc_author_language", { required: false, recommended: true, weight: 1 }),
    f("meeting", "Место встречи", "svc_author_meeting", { required: false, recommended: true, weight: 1 }),
    f("cancel", "Условия отмены", "svc_author_cancel", { required: false, recommended: true, weight: 1 }),
    ...COMMERCIAL_FIELDS,
  ]),
});

function getEffectiveCategoryFromInput(category = "", details = {}) {
  const normalized = normalizeCategory(category || details?.category || "");
  return CONTRACTS[normalized] ? normalized : "refused_tour";
}

function getServiceCategoryContract(category = "", details = {}) {
  return CONTRACTS[getEffectiveCategoryFromInput(category, details)] || CONTRACTS.refused_tour;
}

function shouldSkipField(field, draftOrDetails = {}) {
  if (!field?.skipWhen) return false;
  if (field.skipWhen === "one_way") {
    const type = String(draftOrDetails.flightType || draftOrDetails.flight_type || "").trim().toLowerCase();
    return type === "one_way" || draftOrDetails.oneWay === true || draftOrDetails.one_way === true;
  }
  return false;
}

function getCreateWizardSteps(category = "", draft = {}) {
  return getServiceCategoryContract(category, draft)
    .filter((field) => field.createStep && !shouldSkipField(field, draft))
    .map((field) => field.createStep);
}

function getEditWizardStepsFromContract(category = "", draft = {}) {
  return getServiceCategoryContract(category, draft)
    .filter((field) => field.editStep && field.createStep && !shouldSkipField(field, draft))
    .map((field) => field.editStep);
}

function getFieldByCreateStep(category = "", step = "") {
  const s = String(step || "");
  return getServiceCategoryContract(category).find((field) => field.createStep === s) || null;
}

function getFieldByEditStep(category = "", step = "") {
  const s = String(step || "");
  return getServiceCategoryContract(category).find((field) => field.editStep === s) || null;
}

function getContractCategories() {
  return Object.keys(CONTRACTS);
}

module.exports = {
  STEP,
  CONTRACTS,
  COMMERCIAL_FIELDS,
  getContractCategories,
  getEffectiveCategoryFromInput,
  getServiceCategoryContract,
  getCreateWizardSteps,
  getEditWizardStepsFromContract,
  getFieldByCreateStep,
  getFieldByEditStep,
  shouldSkipField,
};
