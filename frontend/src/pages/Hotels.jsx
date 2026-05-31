// frontend/src/pages/Hotels.jsx
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { NavLink, Link } from "react-router-dom";
import { listRanked, searchHotels } from "../api/hotels";
import { useTranslation } from "react-i18next";

function normalizeHotel(h) {
  return {
    id: h.id ?? h.hotel_id ?? h._id ?? Math.random().toString(36).slice(2),
    name: h.name ?? h.title ?? "",
    city: h.city ?? h.location ?? h.town ?? "",
    country: h.country ?? "",
    rating: h.rating ?? h.avg_rating ?? h.average_rating ?? h.stars ?? h.score ?? null,
    views: h.views ?? h.view_count ?? h.popularity ?? h.seen ?? h.hits ?? 0,
    created_at: h.created_at ?? h.createdAt ?? null,
    my_inspection: h.my_inspection || h.myInspection || null,
  };
}

function RatingPill({ value }) {
  const n = Number(value);
  const label = Number.isFinite(n) && n > 0 ? n.toFixed(1) : "—";
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-black text-amber-700 ring-1 ring-amber-100">
      ⭐ {label}
    </span>
  );
}

function MyInspectionBadge({ inspection }) {
  if (!inspection) return null;
  const status = String(inspection.moderation_status || inspection.status || "").toLowerCase();
  const cfg = {
    pending: ["⏳", "Ваш обзор на модерации", "bg-amber-50 text-amber-800 ring-amber-100"],
    approved: ["✅", "Ваш обзор опубликован", "bg-emerald-50 text-emerald-800 ring-emerald-100"],
    published: ["✅", "Ваш обзор опубликован", "bg-emerald-50 text-emerald-800 ring-emerald-100"],
    rejected: ["⛔", "Ваш обзор отклонён", "bg-red-50 text-red-800 ring-red-100"],
    hidden: ["🙈", "Ваш обзор скрыт", "bg-slate-100 text-slate-700 ring-slate-200"],
    draft: ["📝", "Ваш обзор в черновике", "bg-slate-50 text-slate-700 ring-slate-200"],
  }[status] || ["🧾", "Ваш обзор есть", "bg-slate-50 text-slate-700 ring-slate-200"];
  return (
    <div className={`mt-3 rounded-2xl px-3 py-2 text-xs font-black ring-1 ${cfg[2]}`}>
      <div>{cfg[0]} {cfg[1]}</div>
      {status === "pending" && <div className="mt-0.5 text-[11px] font-bold opacity-80">Видите только вы и админ. После одобрения обзор станет публичным.</div>}
      {status === "rejected" && inspection.rejection_reason && <div className="mt-0.5 text-[11px] font-bold opacity-80">Причина: {inspection.rejection_reason}</div>}
    </div>
  );
}

function HotelResultCard({ hotel, t }) {
  return (
    <NavLink
      to={`/hotels/${hotel.id}`}
      className="group block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-black text-slate-950 group-hover:text-orange-700">
            {hotel.name || "—"}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-500">
            {[hotel.city, hotel.country].filter(Boolean).join(", ") || "—"}
          </div>
        </div>
        <RatingPill value={hotel.rating} />
      </div>

      <MyInspectionBadge inspection={hotel.my_inspection} />

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs font-bold text-slate-500">
        <span>{hotel.my_inspection ? "Открыть / редактировать обзор" : t("hotels.open_card", { defaultValue: "Открыть карточку" })}</span>
        <span className="text-orange-600">→</span>
      </div>
    </NavLink>
  );
}

export default function HotelsPage() {
  const { t } = useTranslation();
  const abortRef = useRef(null);
  const hasClient = !!localStorage.getItem("clientToken");
  const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
  const role = hasClient ? "client" : hasProvider ? "provider" : null;

  const [tab, setTab] = useState("popular");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showResults, setShowResults] = useState(true);

  const limit = 12;

  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const toNum = (v) => (v == null ? null : Number(v));
  const sortByRatingDesc = useCallback((arr) => [...arr].sort((a, b) => (toNum(b.rating) ?? -1) - (toNum(a.rating) ?? -1)), []);
  const sortByRatingAsc = useCallback((arr) => [...arr].sort((a, b) => (toNum(a.rating) ?? 1) - (toNum(b.rating) ?? 1)), []);
  const sortByViewsDesc = useCallback((arr) => [...arr].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)), []);
  const sortByNewestFirst = useCallback((arr) => [...arr].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)), []);

  const loadRanked = useCallback(async (type) => {
    try {
      const rows = await listRanked({ type, limit });
      let norm = rows.map(normalizeHotel);
      if (type === "worst") norm = sortByRatingAsc(norm);
      return norm;
    } catch {
      try {
        const rows = await searchHotels({ page: 1, limit: 50 });
        const norm = rows.map(normalizeHotel);
        if (type === "top") return sortByRatingDesc(norm).slice(0, limit);
        if (type === "popular") return sortByViewsDesc(norm).slice(0, limit);
        if (type === "worst") return sortByRatingAsc(norm).slice(0, limit);
        return sortByNewestFirst(norm).slice(0, limit);
      } catch {
        return [];
      }
    }
  }, [sortByRatingAsc, sortByRatingDesc, sortByViewsDesc, sortByNewestFirst]);

  const loadSearch = useCallback(async () => {
    try {
      const rows = await searchHotels({ name: name || "", city: city || "", page: 1, limit: 50 });
      return rows.map(normalizeHotel);
    } catch {
      return [];
    }
  }, [name, city]);

  const run = useCallback(async (kind) => {
    setLoading(true);
    setError("");
    try {
      let rows = [];
      if (kind === "top") rows = await loadRanked("top");
      else if (kind === "popular") rows = await loadRanked("popular");
      else if (kind === "new") rows = await loadRanked("new");
      else if (kind === "worst") rows = await loadRanked("worst");
      else rows = await loadSearch();
      setItems(rows);
    } catch (e) {
      if (e?.name !== "CanceledError" && e?.code !== "ERR_CANCELED") {
        setError(t("common.load_failed", { defaultValue: "Не удалось загрузить данные" }));
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [loadRanked, loadSearch, t]);

  useEffect(() => {
    setShowResults(true);
    void run(tab || "popular");
  }, [tab, run]);

  const TabBtn = ({ value, children }) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      disabled={loading}
      className={[
        "rounded-full px-3 py-1.5 text-sm font-black transition",
        loading ? "cursor-not-allowed opacity-60" : "",
        tab === value ? "bg-orange-500 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100",
      ].join(" ")}
    >
      {children}
    </button>
  );

  const onFind = async (e) => {
    e.preventDefault();
    setTab("search");
    setShowResults(true);
    await run("search");
  };

  const rows = useMemo(() => items, [items]);

  return (
    <div className="p-3 md:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-orange-600 ring-1 ring-orange-100">
                Hotel hub
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-[-0.03em] text-slate-950">
                {t("hotels.title", { defaultValue: "Отели" })}
              </h1>
              <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-500">
                {t("hotels.subtitle", { defaultValue: "Ищите отели, открывайте карточки и смотрите Hotel Passport с реальными инспекциями." })}
              </p>
            </div>

            {role && (
              <div className="flex flex-wrap items-center gap-2">
                <TabBtn value="top">{t("hotels.tabs.top", { defaultValue: "Топ" })}</TabBtn>
                <TabBtn value="popular">{t("hotels.tabs.popular", { defaultValue: "Популярные" })}</TabBtn>
                <TabBtn value="new">{t("hotels.tabs.new", { defaultValue: "Новые" })}</TabBtn>
                <TabBtn value="worst">{t("hotels.tabs.worst", { defaultValue: "Худшие" })}</TabBtn>

                <Link
                  to="/hotels/inspections"
                  className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-black text-amber-800 transition hover:bg-amber-100"
                >
                  🏨 {t("hotels.passport", { defaultValue: "Hotel Passport" })}
                </Link>
              </div>
            )}
          </div>

          <form onSubmit={onFind} className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto]">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("hotels.search_by_name", { defaultValue: "Поиск по названию" })}
              className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50"
            />
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={t("hotels.city_placeholder", { defaultValue: "Город" })}
              className="w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-medium outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-50"
            />
            <button
              type="submit"
              disabled={loading}
              className={`rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white transition ${loading ? "cursor-not-allowed opacity-60" : "hover:bg-black"}`}
            >
              {loading ? t("hotels.searching", { defaultValue: "Поиск..." }) : t("hotels.find_btn", { defaultValue: "Найти" })}
            </button>
          </form>

          {error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
              {error}
            </div>
          )}
        </div>

        {showResults && (
          <div className="mt-5">
            {loading ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500 shadow-sm">
                {t("common.loading", { defaultValue: "Загрузка…" })}
              </div>
            ) : rows.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((h) => <HotelResultCard key={h.id} hotel={h} t={t} />)}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-2xl">🏨</div>
                <div className="mt-3 text-base font-black text-slate-900">
                  {t("hotels.empty", { defaultValue: "Ничего не найдено" })}
                </div>
                <div className="mt-1 text-sm font-medium text-slate-500">
                  {t("hotels.empty_hint_search", { defaultValue: "Попробуйте изменить название или город." })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
