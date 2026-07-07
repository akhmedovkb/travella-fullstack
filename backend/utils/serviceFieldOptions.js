// backend/utils/serviceFieldOptions.js
// Единый справочник быстрых вариантов для wizard создания/редактирования услуг.
// Здесь держим только самые частые варианты. Всё нестандартное вводится через «Свой вариант».

const SERVICE_FIELD_OPTIONS = Object.freeze({
  accommodation: Object.freeze([
    { code: "SGL", label: "одноместное" },
    { code: "DBL", label: "двухместное" },
    { code: "TRPL", label: "трёхместное" },
    { code: "QDPL", label: "четырёхместное" },
  ]),

  meal: Object.freeze([
    { code: "RO", label: "без питания" },
    { code: "BB", label: "завтраки" },
    { code: "HB", label: "завтрак + ужин" },
    { code: "FB", label: "полный пансион" },
    { code: "AI", label: "всё включено" },
    { code: "UAI", label: "ультра всё включено" },
  ]),

  roomCategory: Object.freeze([
    "Standard",
    "Superior",
    "Deluxe",
    "Family Room",
    "Suite",
    "Villa",
  ]),

  hotelTransfer: Object.freeze([
    { code: "individual", label: "Индивидуальный" },
    { code: "group", label: "Групповой" },
    { code: "none", label: "Отсутствует" },
  ]),

  airline: Object.freeze([
    { code: "HY", label: "Uzbekistan Airways" },
    { code: "HH", label: "Qanot Sharq" },
    { code: "C6", label: "Centrum Air" },
    { code: "TK", label: "Turkish Airlines" },
    { code: "FZ", label: "Flydubai" },
    { code: "G9", label: "Air Arabia" },
    { code: "LO", label: "LOT" },
    { code: "KC", label: "Air Astana" },
  ]),
});

function normalizeOptionCode(value) {
  return String(value || "").trim().toUpperCase();
}

function findOptionByCode(field, value) {
  const code = normalizeOptionCode(value);
  const list = SERVICE_FIELD_OPTIONS[field] || [];
  return list.find((x) => normalizeOptionCode(x && x.code) === code) || null;
}

function optionLabel(field, value, formatter) {
  const found = findOptionByCode(field, value);
  if (!found) return String(value || "").trim();
  return typeof formatter === "function" ? formatter(found) : (found.label || found.code);
}

function normalizeOptionValue(field, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const found = findOptionByCode(field, raw);
  return found ? found.code : raw;
}

module.exports = {
  SERVICE_FIELD_OPTIONS,
  findOptionByCode,
  normalizeOptionValue,
  optionLabel,
};
