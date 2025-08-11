import { useEffect, useState } from "react";
import { NavLink, Link } from "react-router-dom";
import LanguageSelector from "./LanguageSelector";
import { apiGet } from "../api";
import { useTranslation } from "react-i18next";

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
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M12 21s-7-4.35-9.33-7.67C.83 10.5 2.04 7 5.2 7c2.06 0 3.13 1.22 3.8 2 .67-.78 1.74-2 3.8-2 3.16 0 4.37 3.5 2.53 6.33C19 16.65 12 21 12 21Z"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default function Header() {
  const { t } = useTranslation();

  const hasClient = !!localStorage.getItem("clientToken");
  const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
  const role = hasClient ? "client" : hasProvider ? "provider" : null;

  const [counts, setCounts] = useState(null);         // провайдерские счётчики
  const [favCount, setFavCount] = useState(null);     // клиентское избранное
  const [loadingProv, setLoadingProv] = useState(false);
  const [loadingFav, setLoadingFav] = useState(false);

  // провайдерские счётчики
  useEffect(() => {
    if (role !== "provider") return;
    const fetchCounts = async () => {
      setLoadingProv(true);
      try {
        const data = await apiGet("/api/notifications/counts");
        setCounts(data?.counts || null);
      } catch {
        setCounts(null);
      } finally {
        setLoadingProv(false);
      }
    };
    fetchCounts();
    const id = setInterval(fetchCounts, 30000);
    return () => clearInterval(id);
  }, [role]);

  // клиентский счётчик избранного
  useEffect(() => {
    if (role !== "client") return;
    const fetchFav = async () => {
      setLoadingFav(true);
      try {
        const data = await apiGet("/api/wishlist?expand=service");
        const arr = Array.isArray(data) ? data : data?.items || [];
        setFavCount(arr.length);
      } catch {
        setFavCount(0);
      } finally {
        setLoadingFav(false);
      }
    };
    fetchFav();
    const id = setInterval(fetchFav, 30000);
    return () => clearInterval(id);
  }, [role]);

  const bookingsBadge = (counts?.bookings_pending ?? counts?.bookings_total ?? 0) || 0;
  const providerRequests = (counts?.requests_open || 0) + (counts?.requests_accepted || 0);

  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-6">
        {/* Логотип → маркетплейс */}
        <Link
          to="/marketplace"
          className="text-xl font-bold text-gray-800 hover:text-orange-600 transition-colors
             focus:outline-none focus:ring-2 focus:ring-orange-400 rounded px-1"
          aria-label="Go to marketplace"
        >
          Travella
        </Link>

        {/* Провайдерская навигация */}
        {role === "provider" && (
          <nav className="flex items-center gap-2 text-sm bg-white/60 rounded-full px-2 py-1 shadow-sm">
            <NavItem to="/dashboard" label={t("nav.dashboard")} icon={<IconDashboard />} end />
            <NavBadge to="/dashboard/requests" label={t("nav.requests")} value={providerRequests} loading={loadingProv} icon={<IconRequests />} />
            <NavBadge to="/dashboard/bookings" label={t("nav.bookings")} value={bookingsBadge} loading={loadingProv} icon={<IconBookings />} />
          </nav>
        )}

        {/* Клиентский мини-набор: Кабинет + Избранное */}
        {role === "client" && (
          <nav className="flex items-center gap-2 text-sm bg-white/60 rounded-full px-2 py-1 shadow-sm">
            <NavItem to="/client/dashboard" label={t("nav.clientDashboard", "Кабинет")} icon={<IconDashboard />} end />
            <NavBadge to="/client/dashboard?tab=fav" label={t("nav.favorites", "Избранное")} value={favCount ?? 0} loading={loadingFav} icon={<IconHeart />} />
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
