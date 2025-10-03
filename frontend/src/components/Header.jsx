// frontend/src/components/Header.jsx
import { useEffect, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import LanguageSelector from "./LanguageSelector";
import { apiGet } from "../api";
import { useTranslation } from "react-i18next";
import { apiProviderFavorites } from "../api/providerFavorites";

/* --- Inline SVG icons --- */
const IconModeration = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M4 5h16v4H4zM7 9v10m10-10v7m-5-7v10" stroke="currentColor" strokeWidth="2"/>
  </svg>
);
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
const IconHotel = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M3 20h18M5 20V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14" stroke="currentColor" strokeWidth="2"/>
    <path d="M7 9h4M7 12h4M7 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <path d="M14 11h5a2 2 0 0 1 2 2v7" stroke="currentColor" strokeWidth="2"/>
    <path d="M14 14h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);
const IconTicket = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M4 7h16v10H4z" stroke="currentColor" strokeWidth="2"/>
    <path d="M9 7v10M15 7v10" stroke="currentColor" strokeWidth="2" strokeDasharray="2 3"/>
    <circle cx="12" cy="12" r="1.6" fill="currentColor"/>
  </svg>
);
const IconBurger = (p) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);
const IconClose = (p) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const YES = new Set(["1","true","yes","on"]);
function detectAdmin(profile) {
  const p = profile || {};
  const roles = []
    .concat(p.role || [])
    .concat(p.roles || [])
    .flatMap(r => String(r).split(","))
    .map(s => s.trim());
  const perms = []
    .concat(p.permissions || p.perms || [])
    .map(String);
  let is =
    !!(p.is_admin || p.isAdmin || p.admin || p.moderator || p.is_moderator) ||
    roles.some(r => ["admin","moderator","super","root"].includes(r.toLowerCase())) ||
    perms.some(x => ["moderation","admin:moderation"].includes(x.toLowerCase()));
  if (typeof window !== "undefined" && import.meta?.env?.DEV) {
    const v = localStorage.getItem("isAdminUiHint");
    if (v && YES.has(String(v).toLowerCase())) is = true;
  }
  return is;
}
function detectAdminFromJwt() {
  try {
    const tok = localStorage.getItem("token") || localStorage.getItem("providerToken");
    if (!tok) return false;
    const b64 = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const base64 = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(base64).split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    const claims = JSON.parse(json);
    const roles = []
      .concat(claims.role || [])
      .concat(claims.roles || [])
      .flatMap(r => String(r).split(","))
      .map(s => s.trim());
    const perms = []
      .concat(claims.permissions || claims.perms || [])
      .map(String);
    return (
      claims.role === "admin" || claims.is_admin === true || claims.moderator === true ||
      roles.some(r => ["admin","moderator","super","root"].includes(r.toLowerCase())) ||
      perms.some(x => ["moderation","admin:moderation"].includes(x.toLowerCase()))
    );
  } catch { return false; }
}

export default function Header() {
  const hasClient = !!localStorage.getItem("clientToken");
  const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
  const role = hasClient ? "client" : hasProvider ? "provider" : null;

  const { t } = useTranslation();
  const location = useLocation();

  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [favCount, setFavCount] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);

  // Admin detect
  useEffect(() => {
    let alive = true;
    (async () => {
      const jwtAdmin = detectAdminFromJwt();
      if (jwtAdmin) { if (alive) setIsAdmin(true); return; }
      if (role !== "provider") { if (alive) setIsAdmin(false); return; }
      try {
        const p = await apiGet("/api/providers/profile", role);
        if (alive) setIsAdmin(detectAdmin(p));
      } catch {
        const v = localStorage.getItem("isAdminUiHint");
        if (alive) setIsAdmin(!!(v && YES.has(String(v).toLowerCase())));
      }
    })();
    return () => { alive = false; };
  }, [role]);

  // Favorites (provider)
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
    const onChanged = () => load();
    window.addEventListener("provider:favorites:changed", onChanged);
    return () => { alive = false; window.removeEventListener("provider:favorites:changed", onChanged); };
  }, [role]);

  // Counters (provider)
  useEffect(() => {
    if (role !== "provider") return;
    let cancelled = false;
    const fetchCounts = async () => {
      setLoading(true);
      try {
        const rs = await apiGet("/api/requests/provider/stats", role);
        const requestsNew = Number(rs?.new || 0);

        let bookingsPending = 0;
        let bookingsTotal = 0;

        try {
          const bs = await apiGet("/api/providers/stats", role);
          bookingsTotal = Number(bs?.bookings_total ?? bs?.total ?? 0);
          if (bs && (bs.pending != null || bs.awaiting != null || bs.new != null)) {
            bookingsPending = Number(bs.pending ?? bs.awaiting ?? bs.new ?? 0);
          }
        } catch {
          const bl = await apiGet("/api/providers/bookings", role);
          const list = Array.isArray(bl) ? bl : bl?.items || [];
          bookingsPending = list.filter((x) => String(x.status).toLowerCase() === "pending").length;
          bookingsTotal = list.length;
        }
        if (!cancelled) {
          setCounts({
            requests_open: Number(rs?.open || 0) + requestsNew,
            requests_accepted: Number(rs?.accepted || 0),
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
    return () => { cancelled = true; clearInterval(id); };
  }, [role, refreshTick]);

  // External events
  useEffect(() => {
    const bump = () => setRefreshTick((x) => x + 1);
    window.addEventListener("provider:counts:refresh", bump);
    window.addEventListener("provider:inbox:changed", bump);
    return () => {
      window.removeEventListener("provider:counts:refresh", bump);
      window.removeEventListener("provider:inbox:changed", bump);
    };
  }, []);

  // Client favorites
  useEffect(() => {
    if (role !== "client") return;
    const fetchFavs = async () => {
      try {
        const res = await apiGet("/api/wishlist", true);
        const list = Array.isArray(res) ? res : res?.items || [];
        setFavCount(list.length);
      } catch { setFavCount(0); }
    };
    fetchFavs();
    const onFavChanged = () => fetchFavs();
    window.addEventListener("wishlist:changed", onFavChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    fetchFavs(location.pathname + location.search);
    return () => window.removeEventListener("wishlist:changed", onFavChanged);
  }, [role, location]);

  const providerRequests = (counts?.requests_open || 0) + (counts?.requests_accepted || 0);
  const bookingsBadge = (counts?.bookings_pending ?? counts?.bookings_total ?? 0) || 0;

  // close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [location]);

  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-gray-200">
      <div className="mx-auto max-w-7xl px-3 sm:px-4">
        {/* колонка: Row1 (операционка) + Row2 (продукты/админ) */}
        <div className="flex flex-col gap-0">
          {/* ===== Row 1: верхняя операционка ===== */}
          <div className="h-14 flex items-center justify-between gap-2">
            {/* Left: burger + бренд */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileOpen((v) => !v)}
                className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
                aria-label="Menu"
              >
                {mobileOpen ? <IconClose /> : <IconBurger />}
              </button>
              <Link
                to="/marketplace"
                className="text-lg sm:text-xl font-extrabold tracking-tight text-gray-900 hover:text-orange-600 transition-colors focus:outline-none focus:ring-2 focus:ring-orange-400 rounded px-1"
                aria-label="Go to marketplace"
              >
                MARKETPLACE
              </Link>
            </div>
            {/* Right: операционка (desktop/tablet) */}
            <div className="hidden md:flex items-center gap-1">
              {role === "provider" ? (
                <>
                  <NavItem to="/dashboard" label={t("nav.dashboard")} icon={<IconDashboard />} end />
                  <NavBadge to="/dashboard/requests" label={t("nav.requests")} value={providerRequests} loading={loading} icon={<IconRequests />} />
                  <NavBadge to="/dashboard/favorites" label={t("nav.favorites") || "Избранное"} value={favCount} loading={false} icon={<IconHeart />} />
                  <NavBadge to="/dashboard/bookings" label={t("nav.bookings")} value={bookingsBadge} loading={loading} icon={<IconBookings />} />
                </>
              ) : (
                <>
                  <NavItem to="/client/dashboard" label={t("client.header.cabinet", "Кабинет")} icon={<IconDashboard />} />
                  <NavBadge to="/client/dashboard?tab=favorites" label={t("client.header.favorites", "Избранное")} value={favCount} loading={false} icon={<IconHeart />} />
                </>
              )}
            </div>
            {/* язык */}
            <div className="shrink-0 flex items-center justify-end h-9">
              <LanguageSelector />
            </div>
          </div>

          {/* ===== Row 2: продукты слева + админ сразу после них ===== */}
          <div className="hidden md:block border-t">
            <div className="py-2 flex items-center gap-2">
              {/* Продукты */}
              <nav className="flex items-center gap-1">
                <NavItem to="/marketplace" label="MARKETPLACE" />
                {role === "provider" && (
                  <NavItem to="/tour-builder" label={t("nav.tour_builder", "Tour Builder")} />
                )}
                <NavItem to="/hotels" label={t("nav.hotels", "Отели")} icon={<IconHotel />} />
              </nav>
              {/* разделитель */}
              <div className="mx-2 h-5 w-px bg-gray-200" />
              {/* Админ */}
              {isAdmin && (
                <nav className="flex items-center gap-1">
                  <NavItem to="/admin/moderation" label={t("moderation.title", "Модерация")} icon={<IconModeration />} />
                  <NavItem to="/admin/entry-fees" label={t("nav.entry_fees_admin","Entry fees")} icon={<IconTicket />} />
                  <NavItem to="/admin/hotels" label={t("nav.hotels_admin","Отели (админ)")} icon={<IconHotel />} />
                </nav>
              )}
            </div>
          </div>
        </div>

        {/* ===== Mobile drawer ===== */}
        <div
          className={`md:hidden overflow-hidden transition-[max-height] duration-300 ${mobileOpen ? "max-h-[80vh]" : "max-h-0"}`}
          aria-hidden={!mobileOpen}
        >
          <nav className="pb-3 -mx-1">
            {/* Операционка */}
            <RowGroup title={t("nav.ops", "Операционка")}>
              {role === "provider" ? (
            <>
                <NavItemMobile to="/dashboard" label={t("nav.dashboard")} icon={<IconDashboard />} end />
                <NavItemMobile to="/dashboard/requests" label={t("nav.requests")} icon={<IconRequests />} badge={providerRequests} loading={loading} />
                <NavItemMobile to="/dashboard/favorites" label={t("nav.favorites") || "Избранное"} icon={<IconHeart />} badge={favCount} />
                <NavItemMobile to="/dashboard/bookings" label={t("nav.bookings")} icon={<IconBookings />} badge={bookingsBadge} loading={loading} />
            </>
              ) : (
                <>
                  <NavItemMobile to="/client/dashboard" label={t("client.header.cabinet", "Кабинет")} icon={<IconDashboard />} />
                  <NavItemMobile to="/client/dashboard?tab=favorites" label={t("client.header.favorites", "Избранное")} icon={<IconHeart />} badge={favCount} />
                </>
              )}
            </RowGroup>

            {/* Продукты */}
            <RowGroup title={t("nav.products","Продукты")}>
              <NavItemMobile to="/marketplace" label="MARKETPLACE" />
              {role === "provider" && (
                <NavItemMobile to="/tour-builder" label={t("nav.tour_builder", "Tour Builder")} />
              )}
              <NavItemMobile to="/hotels" label={t("nav.hotels", "Отели")} icon={<IconHotel />} />
            </RowGroup>

            {/* Админ */}
            {isAdmin && (
              <RowGroup title={t("nav.admin","Админ")}>
                <NavItemMobile to="/admin/moderation" label={t("moderation.title", "Модерация")} icon={<IconModeration />} />
                <NavItemMobile to="/admin/entry-fees" label={t("nav.entry_fees_admin","Entry fees")} icon={<IconTicket />} />
                <NavItemMobile to="/admin/hotels" label={t("nav.hotels_admin","Отели (админ)")} icon={<IconHotel />} />
              </RowGroup>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

/* ---------- Subcomponents ---------- */

function RowGroup({ title, children }) {
  return (
    <div className="mb-2 rounded-xl ring-1 ring-gray-200 bg-white/70 overflow-hidden">
      <div className="px-3 py-2 text-[13px] font-semibold text-gray-600 bg-gray-50">{title}</div>
      <div className="flex flex-col">{children}</div>
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
          "shrink-0 inline-flex items-center gap-2 px-3 py-1 rounded-full transition-colors whitespace-nowrap",
          isActive
            ? "text-orange-600 font-semibold border border-orange-200 bg-orange-50"
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
          "relative shrink-0 inline-flex items-center gap-2 px-3 py-1 rounded-full transition-colors whitespace-nowrap",
          isActive
            ? "text-orange-600 font-semibold border border-orange-200 bg-orange-50"
            : "text-gray-700 hover:text-gray-900 hover:bg-gray-100",
        ].join(" ")
      }
    >
      {icon}
      <span>{label}</span>
      <span
        className={[
          "ml-1 min-w-[20px] h-[20px] px-1 rounded-full text-[11px] leading-none flex items-center justify-center transition-colors",
          show ? "bg-orange-500 text-white" : "bg-gray-200 text-gray-600",
        ].join(" ")}
      >
        {loading ? "…" : show ? value : 0}
      </span>
    </NavLink>
  );
}

function NavItemMobile({ to, label, icon, end, badge, loading }) {
  const show = Number.isFinite(badge) && badge > 0;
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
          isActive ? "bg-orange-50 text-orange-700" : "hover:bg-gray-100",
        ].join(" ")
      }
    >
      <div className="w-5 h-5 text-gray-700">{icon}</div>
      <div className="flex-1">{label}</div>
      <span
        className={[
          "min-w-[20px] h-[20px] px-1 rounded-full text-[11px] leading-none flex items-center justify-center",
          show ? "bg-orange-500 text-white" : "bg-gray-200 text-gray-600",
        ].join(" ")}
      >
        {loading ? "…" : show ? badge : 0}
      </span>
    </NavLink>
  );
}
