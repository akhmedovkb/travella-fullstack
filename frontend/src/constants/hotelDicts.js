export const ROOM_TYPES = [
  { code: "single",     label: "Single",      baseCapacity: 1, maxCapacity: 1 },
  { code: "double",     label: "Double",      baseCapacity: 2, maxCapacity: 2 },
  { code: "triple",     label: "Triple",      baseCapacity: 3, maxCapacity: 3 },
  { code: "quadruple",  label: "Quadruple",   baseCapacity: 4, maxCapacity: 4 },
  { code: "suite",      label: "Suite",       baseCapacity: 2, maxCapacity: 4 },
  { code: "family",     label: "Family",      baseCapacity: 4, maxCapacity: 6 },
];

export const AMENITIES = [
  { key: "wifi_free",          label: "Бесплатный Wi-Fi" },
  { key: "parking_free",       label: "Бесплатная парковка" },
  { key: "ac",                 label: "Кондиционер" },
  { key: "breakfast_buffet",   label: "Разнообразный завтрак" },
  { key: "gym",                label: "Фитнес-зал" },
  { key: "library",            label: "Библиотека" },
  { key: "luggage_storage",    label: "Камера хранения багажа" },
];

export const SERVICES = [
  { key: "airport_shuttle_free", label: "Трансфер от/до аэропорта (бесплатно)" },
  { key: "frontdesk_24h",        label: "Круглосуточная стойка регистрации" },
  { key: "restaurant",           label: "Ресторан" },
  { key: "breakfast_included",   label: "Завтрак включён" },
  { key: "pay_at_hotel",         label: "Оплата в отеле" },
  { key: "instant_confirm",      label: "Мгновенное подтверждение" }
];
