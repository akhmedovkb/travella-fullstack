import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function Stars({ value = 0, size = 18 }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  const total = 5;
  const stars = Array.from({ length: total }, (_, i) => {
    if (i < full) return "★";
    if (i === full && half) return "☆"; // можно заменить на половинку, если используете иконки
    return "☆";
  });
  return (
    <div aria-label={`rating ${value.toFixed(1)}`} style={{ fontSize: size, lineHeight: 1 }}>
      <span style={{ letterSpacing: 2 }}>{stars.join(" ")}</span>
      <span style={{ marginLeft: 8, fontSize: size * 0.85, color: "#6b7280" }}>
        {value.toFixed(1)}
      </span>
    </div>
  );
}

export default function ProviderStatsHeader() {
  const { t } = useTranslation();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await fetch("/api/provider/stats", { credentials: "include" });
        const data = await res.json();
        if (isMounted) setStats(data);
      } catch (e) {
        if (isMounted) setStats(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => (isMounted = false);
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        {t("common.loading_stats")}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-gray-500">{t("stats.tier_label")}</div>
          <div className="text-xl font-semibold">{stats.tier || "Bronze"}</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-500">{t("stats.rating")}</div>
          <Stars value={Number(stats.rating) || 3} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label={t("stats.requests_total")} value={stats.requests_total} />
        <StatCard label={t("stats.requests_active")} value={stats.requests_active} />
        <StatCard label={t("stats.bookings_total")} value={stats.bookings_total} />
        <StatCard label={t("stats.completed")} value={stats.completed} />
        <StatCard label={t("stats.cancelled")} value={stats.cancelled} />
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{Number(value) || 0}</div>
    </div>
  );
}
