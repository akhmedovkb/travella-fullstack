// ProviderStatsHeader.jsx (расширенная версия)
export default function ProviderStatsHeader({
  rating = 0,
  stats = {},
  bonusTarget = null, // например 500; если не передан — считаем от бронирований
  t,
}) {
  const _t = (k, d) => (t ? t(k) : d);
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  const rounded = Math.round(r * 10) / 10;

  const requests_total  = Number(stats.requests_total)  || 0;
  const requests_active = Number(stats.requests_active) || 0;
  const bookings_total  = Number(stats.bookings_total)  || 0;
  const completed       = Number(stats.completed)       || 0;
  const cancelled       = Number(stats.cancelled)       || 0;

  // Если есть bonusTarget, прогресс считаем по очкам; иначе по брони: completed / bookings_total
  const points = Number(stats.points) || completed;
  const base   = bonusTarget ?? (bookings_total || 1);
  const progressPct = Math.min(100, Math.round((points / base) * 100));

  // Уровень по «очкам» (можно поправить пороги)
  const tier =
    points >= 300 ? "Gold" :
    points >= 100 ? "Silver" : "Bronze";

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">
          {_t("stats.level", "Уровень")} {tier}
        </div>
        <div className="flex items-center gap-1">
          {[1,2,3,4,5].map(i => (
            <svg key={i} viewBox="0 0 24 24" className={`w-5 h-5 ${i <= Math.round(r) ? "text-yellow-500" : "text-gray-300"}`} fill={i <= Math.round(r) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
              <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            </svg>
          ))}
          <span className="ml-2 text-sm text-gray-600">{rounded.toFixed(1)}</span>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{_t("stats.bonus_progress", "Бонусный прогресс")}</span>
          <span>
            {points} / {base} ({progressPct}%)
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <div className="h-2 bg-emerald-500" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatChip label={_t("stats.requests_total", "Запросов (всего)")} value={requests_total} />
        <StatChip label={_t("stats.requests_active", "Запросов (активные)")} value={requests_active} />
        <StatChip label={_t("stats.bookings_total", "Бронирований (всего)")} value={bookings_total} />
        <StatChip label={_t("stats.completed", "Завершено")} value={completed} />
        <StatChip label={_t("stats.cancelled", "Отменено")} value={cancelled} />
      </div>
    </div>
  );
}
