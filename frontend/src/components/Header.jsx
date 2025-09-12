import { useEffect, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import LanguageSelector from "./LanguageSelector";
import { apiGet } from "../api";
import { useTranslation } from "react-i18next";
import { apiProviderFavorites } from "../api/providerFavorites";

/* --- Inline SVG иконки --- */
const IconDashboard = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M3 13h8V3H3v10Zm10 8h8V3h-8v18ZM3 21h8v-6H3v6Z" stroke="currentColor" strokeWidth="2" />
  </svg>
);
const IconRequests = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M4 4h16v12H7l-3 3V4Z" stroke="currentColor" strokeWidth="2" />
    <path d="M8 8h8M8 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const IconBookings = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M7 3v4M17 3v4M4 8h16v13H4V8Z" stroke="currentColor" strokeWidth="2" />
    <path d="M8 12h8M8 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const IconHeart = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M12 21s-6.716-4.35-9.192-7.2C.818 11.48 1.04 8.72 2.88 7.2a5 5 0 0 1 6.573.33L12 9.08l2.547-1.55a5 5 0 0 1 6.573.33c1.84 1.52 2.062 4.28.072 6.6C18.716 16.65 12 21 12 21Z" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export default function Header() {
  const { t } = useTranslation();
  const location = useLocation();

  const hasClient = !!localStorage.getItem("clientToken");
  const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
  const role = hasClient ? "client" : hasProvider ? "provider" : null;

  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0); // для ручного перезапроса счётчиков

   // провайдерское избранное – считаем элементы
   useEffect(() => {
     if (role !== "provider") return;
     let alive = true;
     const load = async () => {
       try {
         const list = await apiProviderFavorites();
         if (alive) setFavCount(Array.isArray(list) ? list.length : 0);
       } catch {
         if (alive) setFavCount(0);
       }
     };
     load();
     // обновлять бейдж при изменениях
     const onChanged = () => load();
     window.addEventListener("provider:favorites:changed", onChanged);
     return () => { alive = false; window.removeEventListener("provider:favorites:changed", onChanged); };
   }, [role]);


  /* Provider counters (requests / bookings) — без /api/notifications/counts */
  useEffect(() => {
    if (role !== "provider") return;

    let cancelled = false;

    const fetchCounts = async () => {
      setLoading(true);
      try {
        // 1) заявки провайдера: показываем именно "new"
        const rs = await apiGet("/api/requests/provider/stats", role);
        const requestsNew = Number(rs?.new || 0);

        // 2) бронирования: сначала пытаемся взять готовые счётчики,
        // если нет — считаем из списка (pending/total)
        let bookingsPending = 0;
        let bookingsTotal = 0;

        try {
              // правильный эндпоинт
              const bs = await apiGet("/api/providers/stats", role);
            
              // total берём из bookings_total (или total — на всякий случай)
              bookingsTotal = Number(bs?.bookings_total ?? bs?.total ?? 0);
            
              // если бекенд вдруг отдаёт pending/awaiting/new — используем
              if (bs && (bs.pending != null || bs.awaiting != null || bs.new != null)) {
                bookingsPending = Number(bs.pending ?? bs.awaiting ?? bs.new ?? 0);
              }
            } catch {
              // фоллбэк на список бронирований (тоже providers/*)
              const bl = await apiGet("/api/providers/bookings", role);
              const list = Array.isArray(bl) ? bl : bl?.items || [];
              bookingsPending = list.filter(
                (x) => String(x.status).toLowerCase() === "pending"
              ).length;
              bookingsTotal = list.length;
            }
        if (!cancelled) {
          setCounts({
            requests_open: requestsNew,  // тут — новые
            requests_accepted: 0,        // чтобы сумма в бейдже = новые
            bookings_pending: bookingsPending,
            bookings_total: bookingsTotal,
          });
        }
      } catch {
        if (!cancelled) setCounts(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchCounts();
    const id = setInterval(fetchCounts, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [role, refreshTick]);

  // дергаем обновление по событиям от списка заявок
  useEffect(() => {
    const bump = () => setRefreshTick((x) => x + 1);
    window.addEventListener("provider:counts:refresh", bump);
    window.addEventListener("provider:inbox:changed", bump);
    return () => {
      window.removeEventListener("provider:counts:refresh", bump);
      window.removeEventListener("provider:inbox:changed", bump);
    };
  }, []);

  /* Client wishlist counter */
  useEffect(() => {
    if (role !== "client") return;

    const fetchFavs = async () => {
      try {
        const res = await apiGet("/api/wishlist", true);
        const list = Array.isArray(res) ? res : res?.items || [];
        setFavCount(list.length);
      } catch {
        setFavCount(0);
      }
    };

    fetchFavs();

    const onFavChanged = () => fetchFavs();
    window.addEventListener("wishlist:changed", onFavChanged);

    // на смену роутов (как было)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    fetchFavs(location.pathname + location.search);

    return () => window.removeEventListener("wishlist:changed", onFavChanged);
  }, [role, location]);

  const bookingsBadge = (counts?.bookings_pending ?? counts?.bookings_total ?? 0) || 0;
  const providerRequests = (counts?.requests_open || 0) + (counts?.requests_accepted || 0);

  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link
          to="/marketplace"
          className="text-xl font-bold text-gray-800 hover:text-orange-600 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 rounded px-1"
          aria-label="Go to marketplace"
        >
          MARKETPLACE
        </Link>

        {/* Provider nav */}
        {role === "provider" && (
          <nav className="flex items-center gap-2 text-sm bg-white/60 rounded-full px-2 py-1 shadow-sm">
            <NavItem to="/dashboard" label={t("nav.dashboard")} icon={<IconDashboard />} end />
            <NavBadge
              to="/dashboard/requests"
              label={t("nav.requests")}
              value={providerRequests}
              loading={loading}
              icon={<IconRequests />}
            />
            <NavBadge
              to="/dashboard/favorites"
              label={t("nav.favorites") || "Избранное"}
              value={favCount}
              loading={false}
              icon={<IconHeart />}
            />
            <NavBadge
              to="/dashboard/bookings"
              label={t("nav.bookings")}
              value={bookingsBadge}
              loading={loading}
              icon={<IconBookings />}
            />
          </nav>
        )}

        {/* Client shortcuts: cabinet + favorites */}
        {role === "client" && (
          <nav className="flex items-center gap-2 text-sm">
            <Link
              to="/client/dashboard"
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-gray-700 hover:text-gray-900 hover:bg-gray-100"
            >
              <IconDashboard />
              <span>{t("client.header.cabinet", "Кабинет")}</span>
            </Link>

            <Link
              to="/client/dashboard?tab=favorites"
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-gray-700 hover:text-gray-900 hover:bg-gray-100"
              title={t("client.header.favorites", "Избранное")}
            >
              <IconHeart />
              <span>{t("client.header.favorites", "Избранное")}</span>
              <span className="min-w-[22px] h-[22px] px-1 rounded-full text-xs flex items-center justify-center bg-orange-500 text-white">
                {favCount}
              </span>
            </Link>
          </nav>
        )}
      </div>

      <LanguageSelector />
    </div>
  );
}

function NavItem({ to, label, icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "inline-flex items-center gap-2 px-3 py-1 rounded-full transition-colors",
          isActive
            ? "text-orange-600 font-semibold border-b-2 border-orange-500"
            : "text-gray-700 hover:text-gray-900 hover:bg-gray-100",
        ].join(" ")
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

function NavBadge({ to, label, value, loading, icon }) {
  const show = Number.isFinite(value) && value > 0;
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "relative inline-flex items-center gap-2 px-3 py-1 rounded-full transition-colors",
          isActive
            ? "text-orange-600 font-semibold border-b-2 border-orange-500"
            : "text-gray-700 hover:text-gray-900 hover:bg-gray-100",
        ].join(" ")
      }
    >
      {icon}
      <span>{label}</span>
      <span
        className={[
          "min-w-[22px] h-[22px] px-1 rounded-full text-xs flex items-center justify-center transition-transform",
          show ? "bg-orange-500 text-white" : "bg-gray-200 text-gray-600",
        ].join(" ")}
      >
        {loading ? "…" : show ? value : 0}
      </span>
    </NavLink>
  );
}
