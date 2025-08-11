import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
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

export default function Header() {
  const { t } = useTranslation();

  const hasClient = !!localStorage.getItem("clientToken");
  const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
  const role = useMemo(() => (hasClient ? "client" : hasProvider ? "provider" : null), [hasClient, hasProvider]);

  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchCounts = async () => {
    if (!role) return;
    setLoading(true);
    try {
      const data = await apiGet("/api/notifications/counts", role);
      setCounts(data?.counts || null);
    } catch {
      setCounts(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCounts();
    const id = setInterval(fetchCounts, 30000);
    return () => clearInterval(id);
  }, [role]);

  const bookingsBadge = (counts?.bookings_pending ?? counts?.bookings_total ?? 0) || 0;
  const clientRequests = (counts?.requests_open || 0) + (counts?.requests_proposed || 0);
  const providerRequests = (counts?.requests_open || 0) + (counts?.requests_accepted || 0);

  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <NavLink to="/" className="text-xl font-bold text-gray-800">
          Travella
        </NavLink>

        {role && (
          <nav className="flex items-center gap-2 text-sm bg-white/60 rounded-full px-2 py-1 shadow-sm">
            {role === "client" ? (
              <>
                <NavItem to="/client/dashboard" label={t("nav.dashboard")} icon={<IconDashboard />} end />
                <NavBadge to="/client/dashboard" label={t("nav.requests")} value={clientRequests} loading={loading} icon={<IconRequests />} />
                <NavBadge to="/client/dashboard" label={t("nav.bookings")} value={bookingsBadge} loading={loading} icon={<IconBookings />} />
              </>
            ) : (
              <>
                <NavItem to="/dashboard" label={t("nav.dashboard")} icon={<IconDashboard />} end />
                <NavBadge to="/dashboard/requests" label={t("nav.requests")} value={providerRequests} loading={loading} icon={<IconRequests />} />
                <NavBadge to="/dashboard/bookings" label={t("nav.bookings")} value={bookingsBadge} loading={loading} icon={<IconBookings />} />
              </>
            )}
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
