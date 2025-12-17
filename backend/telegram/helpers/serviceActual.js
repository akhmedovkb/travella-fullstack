// backend/telegram/helpers/serviceActual.js

// безопасный парсинг дат для сортировки
function parseDateSafe(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;

  // пробуем формат 2026.01.02
  const s2 = s.replace(/\./g, "-");
  d = new Date(s2);
  if (!Number.isNaN(d.getTime())) return d;

  return null;
}

// нормализуем дату: 2025-12-15 / 2025.12.15 / 2025/12/15 -> 2025-12-15
function normalizeDateInput(raw) {
  if (!raw) return null;
  const txt = String(raw).trim();
  if (/^нет$/i.test(txt)) return null;

  const m = txt.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
  if (!m) return null;

  const [, y, mm, dd] = m;
  return `${y}-${mm}-${dd}`;
}

// ✅ Дата+время: 2025-12-15 21:30 / 2025.12.15 21:30 / 2025-12-15T21:30
// Возвращает ISO-строку: YYYY-MM-DDTHH:mm (или YYYY-MM-DD если времени нет)
function normalizeDateTimeInput(raw) {
  if (!raw) return null;
  const txt = String(raw).trim();
  if (/^нет$/i.test(txt)) return null;

  // 1) Если пришла просто дата — оставим как раньше
  const ymdOnly = normalizeDateInput(txt);
  if (ymdOnly) return ymdOnly;

  // 2) Дата + время
  const m = txt.match(
    /^(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!m) return null;

  const [, y, mo, d, hh, mm] = m;
  // seconds игнорируем, чтобы стабильно хранить
  return `${y}-${mo}-${d}T${hh}:${mm}`;
}

function parseDateFlexible(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;

  // сначала пробуем существующий безопасный парсер
  const d1 = parseDateSafe(s);
  if (d1) return d1;

  // если это YYYY-MM-DD или YYYY.MM.DD — приводим к YYYY-MM-DD и пробуем ещё раз
  const ymd = normalizeDateInput(s);
  if (ymd) {
    const d2 = parseDateSafe(ymd);
    if (d2) return d2;
  }

  // ✅ если это YYYY-MM-DD HH:mm / YYYY.MM.DD HH:mm / YYYY-MM-DDTHH:mm
  const dt = normalizeDateTimeInput(s);
  if (dt) {
    const d3 = parseDateSafe(dt);
    if (d3) return d3;
  }
  return null;
}

// === Актуальность услуги (для inline/списков) ===
// Правила:
// - если details.isActive === false -> неактуально
// - если expiration (details.expiration или svc.expiration) в прошлом -> неактуально
// - если endDate/returnFlightDate/endFlightDate в прошлом -> неактуально
function isServiceActual(detailsRaw, svc) {
  let d = detailsRaw || {};
  if (typeof d === "string") {
    try {
      d = JSON.parse(d);
    } catch {
      d = {};
    }
  }

  // isActive
  if (typeof d.isActive === "boolean" && d.isActive === false) return false;

  const now = new Date();

  // expiration
  const expirationRaw = d.expiration || svc?.expiration || null;
  if (expirationRaw) {
    const exp = parseDateFlexible(expirationRaw);
    if (exp && exp.getTime() < now.getTime()) return false;
  }

  // end date (tour/hotel) or return flight date
  const endRaw = d.endFlightDate || d.returnFlightDate || d.endDate || null;
  if (endRaw) {
    const endD = parseDateFlexible(endRaw);
    if (endD && endD.getTime() < now.getTime()) return false;
  }

  return true;
}

module.exports = {
  parseDateFlexible,
  isServiceActual,
  normalizeDateInput, // пригодится для "плашки" истечения
  normalizeDateTimeInput,
};

