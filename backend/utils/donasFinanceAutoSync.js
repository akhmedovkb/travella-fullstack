// backend/utils/donasFinanceAutoSync.js

const monthsCtrl = require("../controllers/donasFinanceMonthsController");

function ymFromDateLike(x) {
  if (!x && x !== 0) return "";

  if (x instanceof Date && !Number.isNaN(x.getTime())) {
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  if (typeof x === "number" && Number.isFinite(x)) {
    const d = new Date(x);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      return `${y}-${m}`;
    }
  }

  const s = String(x || "").trim();
  if (!s) return "";

  if (/^\d{4}-\d{2}$/.test(s)) return s;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);

  if (s.includes("T")) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      return `${y}-${m}`;
    }
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  return "";
}

/**
 * Автосинк: обновляет агрегаты месяца (если не locked) + пересчитывает cash_end цепочкой до конца.
 * action: строка для аудита (например "sales.add", "purchases.delete")
 */
async function autoSyncMonthsForDate(req, dateLike, action = "auto") {
  const i = monthsCtrl?._internal;
  if (!i) return;

  const ym = ymFromDateLike(dateLike);
  if (!i.isYm(ym)) return;

  const endYm = (await i.getMaxYmFromMonthsOrData(ym)) || ym;
  const chainStart = ym;

  // 1) пересчёт агрегатов месяца (если не locked)
  await i.updateMonthAgg(ym);

  // 2) пересчёт цепочки cash_end до endYm
  //    Внутри recomputeCashChainFrom база берётся из prevYm(chainStart)
  //    (или settings.cash_start, если prev отсутствует).
  await i.recomputeCashChainFrom(chainStart, endYm);

  // 3) audit
  try {
    await i.auditMonthAction(req, ym, "months.auto_sync", { action, ym }, { endYm });
  } catch {}
}

module.exports = { autoSyncMonthsForDate };
