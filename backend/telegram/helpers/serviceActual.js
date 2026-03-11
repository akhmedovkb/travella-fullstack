// backend/telegram/helpers/serviceActual.js

const TASHKENT_TZ = "Asia/Tashkent";

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function formatYmdInTz(date, timeZone = TASHKENT_TZ) {
  if (!isValidDate(date)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  if (!map.year || !map.month || !map.day) return null;
  return `${map.year}-${map.month}-${map.day}`;
}

function todayYmdInTashkent() {
  return formatYmdInTz(new Date(), TASHKENT_TZ);
}

function parseDateFlexible(val) {
  if (!val) return null;

  if (val instanceof Date) {
    return isValidDate(val) ? val : null;
  }

  const s = String(val).trim();
  if (!s) return null;

  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    let [, y, a, b] = m;
    let mm = Number(a);
    let dd = Number(b);

    // support broken values like 2026-16-03 => 2026-03-16
    if (mm > 12 && dd >= 1 && dd <= 12) {
      [mm, dd] = [dd, mm];
    }

    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const iso = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}T00:00:00`;
      const d = new Date(iso);
      return isValidDate(d) ? d : null;
    }
  }

  // YYYY.MM.DD
  m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (m) {
    const [, y, mm, dd] = m;
    const d = new Date(`${y}-${mm}-${dd}T00:00:00`);
    return isValidDate(d) ? d : null;
  }

  // DD.MM.YYYY
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) {
    const [, dd, mm, y] = m;
    const d = new Date(`${y}-${mm}-${dd}T00:00:00`);
    return isValidDate(d) ? d : null;
  }

  // timestamp number-like
  if (/^\d{10,13}$/.test(s)) {
    const num = Number(s);
    const d = new Date(s.length === 13 ? num : num * 1000);
    return isValidDate(d) ? d : null;
  }

  // fallback for ISO / datetime
  const d = new Date(s);
  return isValidDate(d) ? d : null;
}

function hasTimePart(val) {
  if (!val) return false;
  const s = String(val).trim();
  return /[T ]\d{2}:\d{2}/.test(s);
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v instanceof Date && isValidDate(v)) return v;
  }
  return null;
}

function toObj(details) {
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

function isFalseLike(v) {
  if (v === false) return true;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "false" || s === "0" || s === "no" || s === "inactive";
}

function isTrueLike(v) {
  if (v === true) return true;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "active";
}

function extractPrimaryStartField(details, svc = {}) {
  const d = toObj(details);
  const cat = String(svc.category || d.category || "").toLowerCase();

  // 1) Новый единый стандарт для всех refused_* услуг
  const unified = firstNonEmpty(d.startDate, d.start_date);
  if (unified) return unified;

  // 2) Обратная совместимость со старыми записями
  if (cat === "refused_flight") {
    return firstNonEmpty(
      d.departureFlightDate,
      d.departureDate,
      d.departure_date,
      d.flightDate,
      d.flight_date,
      d.dateFrom,
      d.date_from,
      d.date
    );
  }

  if (cat === "refused_hotel") {
    return firstNonEmpty(
      d.checkinDate,
      d.checkInDate,
      d.check_in,
      d.check_in_date,
      d.dateFrom,
      d.date_from,
      d.date
    );
  }

  if (cat === "refused_ticket") {
    return firstNonEmpty(
      d.eventDate,
      d.event_date,
      d.date,
      d.dateFrom,
      d.date_from
    );
  }

  // refused_tour и общий fallback для старых данных
  return firstNonEmpty(
    d.dateFrom,
    d.date_from,
    d.departureFlightDate,
    d.departureDate,
    d.departure_date,
    d.flightDate,
    d.flight_date,
    d.checkinDate,
    d.checkInDate,
    d.check_in,
    d.check_in_date,
    d.eventDate,
    d.event_date,
    d.date
  );
}

function extractExpirationField(details, svc = {}) {
  const d = toObj(details);
  return firstNonEmpty(
    d.expiration,
    d.expirationAt,
    d.expiration_at,
    svc.expiration,
    svc.expiration_at
  );
}

function dateOnlyIsPast(raw) {
  const parsed = parseDateFlexible(raw);
  if (!parsed) return false;

  const candidateYmd =
    typeof raw === "string" && /^\d{4}[-.]\d{2}[-.]\d{2}$/.test(raw.trim())
      ? raw.trim().replace(/\./g, "-")
      : formatYmdInTz(parsed, TASHKENT_TZ);

  const todayYmd = todayYmdInTashkent();
  if (!candidateYmd || !todayYmd) return false;

  // becomes inactive only AFTER the date passed
  return candidateYmd < todayYmd;
}

function dateTimeIsPast(raw) {
  const parsed = parseDateFlexible(raw);
  if (!parsed) return false;
  return parsed.getTime() < Date.now();
}

function isMomentPassed(raw) {
  if (!raw) return false;
  return hasTimePart(raw) ? dateTimeIsPast(raw) : dateOnlyIsPast(raw);
}

function isServiceActual(details, svc = {}) {
  const d = toObj(details);
  const status = String(svc.status || "").trim().toLowerCase();

  // deleted / archived are never actual
  if (status === "deleted" || status === "archived") {
    return false;
  }

  // explicit flags from details
  if (isFalseLike(d.isActive) || isFalseLike(d.actual) || isFalseLike(d.active)) {
    return false;
  }

  // if provider/admin explicitly marked active=true, it still must obey passed dates below
  // so we do not return true here early

  // 1) primary service date passed => inactive
  const primaryStart = extractPrimaryStartField(d, svc);
  if (primaryStart && isMomentPassed(primaryStart)) {
    return false;
  }

  // 2) expiration passed => inactive
  const expiration = extractExpirationField(d, svc);
  if (expiration && isMomentPassed(expiration)) {
    return false;
  }

  // optional positive flags
  if (isTrueLike(d.isActive) || isTrueLike(d.actual) || isTrueLike(d.active)) {
    return true;
  }

  // default: actual if nothing invalidated it
  return true;
}

module.exports = {
  isServiceActual,
  parseDateFlexible,
};
