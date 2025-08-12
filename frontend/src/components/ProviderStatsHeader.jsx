// frontend/src/components/ProviderStatsHeader.jsx
import React from "react";

function StatChip({ label, value }) {
  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-sm">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Star({ filled }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`w-5 h-5 ${filled ? "text-yellow-500" : "text-gray-300"}`}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
    </svg>
  );
}

export default function ProviderStatsHeader({
  rating = 0,
  stats = {},
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

  const progress = bookings_total > 0 ? Math.round((completed / bookings_total) * 100) : 0;

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      {/* Рейтинг */}
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">
          {_t("stats.tier_label", "Уровень / Рейтинг")}
        </div>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} filled={i <= Math.round(r)} />
          ))}
          <span className="ml-2 text-sm text-gray-600">{rounded.toFixed(1)}</span>
        </div>
      </div>

      {/* Прогресс-бар по завершённым бронированиям */}
      <div className="mt-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{_t("stats.bonus_progress", "Бонусный прогресс")}</span>
          <span>
            {completed} / {bookings_total} ({progress}%)
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-2 bg-emerald-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Чипы со статистикой */}
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
