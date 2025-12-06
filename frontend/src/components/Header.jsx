// frontend/src/components/Header.jsx
import { useEffect, useRef, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import LanguageSelector from "./LanguageSelector";
import { apiGet } from "../api";
import { useTranslation } from "react-i18next";
import { apiProviderFavorites } from "../api/providerFavorites";
import AdminQuickTools from "./admin/AdminQuickTools";

/* --- Inline SVG icons --- */
const IconChecklist = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
    <path d="M8 8h8M8 12h8M8 16h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M7 4.5l1 1 2-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconModeration = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M4 5h16v4H4zM7 9v10m10-10v7m-5-7v10" stroke="currentColor" strokeWidth="2" />
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
    <path
      d="M12 21s-6.716-4.35-9.192-7.2C.818 11.48 1.04 8.72 2.88 7.2a5 5 0 0 1 6.573.33L12 9.08l2.547-1.55a5 5 0 0 1 6.573.33c1.84 1.52 2.062 4.28.072 6.6C18.716 16.65 12 21 12 21Z"
      stroke="currentColor"
      strokeWidth="1.8"
    />
  </svg>
);

const IconUsers = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" />
    <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="2" />
    <path d="M20 21v-2a3 3 0 0 0-3-3h-1" stroke="currentColor" strokeWidth="2" />
    <circle cx="17" cy="7" r="2" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const IconHotel = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M3 20h18M5 20V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14" stroke="currentColor" strokeWidth="2" />
    <path d="M7 9h4M7 12h4M7 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M14 11h5a2 2 0 0 1 2 2v7" stroke="currentColor" strokeWidth="2" />
    <path d="M14 14h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconTicket = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M4 7h16v10H4z" stroke="currentColor" strokeWidth="2" />
    <path d="M9 7v10M15 7v10" stroke="currentColor" strokeWidth="2" strokeDasharray="2 3" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" />
  </svg>
);

const IconDoc = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M7 3h7l5 5v13H7z" stroke="currentColor" strokeWidth="2" />
    <path d="M14 3v6h6" stroke="currentColor" strokeWidth="2" />
    <path d="M10 13h7M10 17h7M10 9h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconBurger = (p) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconClose = (p) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IconChevron = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// иконка Профиля
const IconProfile = (p) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}>
    <circle cx="12" cy="8" r="3" stroke="currentColor" strokeWidth="2" />
    <path d="M6 19a6 6 0 0 1 12 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const YES = new Set(["1", "true", "yes", "on"]);
function detectAdmin(profile) {
  const p = profile || {};
  const roles = []
    .concat(p.role || [])
    .concat(p.roles || [])
    .flatMap((r) => String(r).split(","))
    .map((s) => s.trim());
  const perms = [].concat(p.permissions || p.perms || []).map(String);
  let is =
    !!(p.is_admin || p.isAdmin || p.admin || p.moderator || p.is_moderator) ||
    roles.some((r) => ["admin", "moderator", "super", "root"].includes(r.toLowerCase())) ||
    perms.some((x) => ["moderation", "admin:moderation"].includes(x.toLowerCase()));
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
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const claims = JSON.parse(json);
    const roles = []
      .concat(claims.role || [])
      .concat(claims.roles || [])
      .flatMap((r) => String(r).split(","))
      .map((s) => s.trim());
    const perms = [].concat(claims.permissions || claims.perms || []).map(String);
    return (
      claims.role === "admin" ||
      claims.is_admin === true ||
      claims.moderator === true ||
      roles.some((r) => ["admin", "moderator", "super", "root"].includes(r.toLowerCase())) ||
      perms.some((x) => ["moderation", "admin:moderation"].includes(x.toLowerCase()))
    );
  } catch {
    return false;
  }
}

export default function Header() {
  const hasClient = !!localStorage.getItem("clientToken");
  const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
  const role = hasClient ? "client" : hasProvider ? "provider" : null;

  const { t } = useTranslation();
  const location = useLocation();

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const adminRef = useRef(null);

  const [servicesOpen, setServicesOpen] = useState(false);
  const servicesRef = useRef(null);

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
      if (jwtAdmin) {
        if (alive) setIsAdmin(true);
        return;
      }
      if (role !== "provider") {
        if (alive) setIsAdmin(false);
        return;
      }
      try {
        const p = await apiGet("/api/providers/profile", role);
        if (alive) setIsAdmin(detectAdmin(p));
      } catch {
        const v = localStorage.getItem("isAdminUiHint");
        if (alive) setIsAdmin(!!(v && YES.has(String(v).toLowerCase())));
      }
    })();
    return () => {
      alive = false;
    };
  }, [role]);

  // close dropdowns on outside click
  useEffect(() => {
    const onDoc = (e) => {
      if (adminRef.current && !adminRef.current.contains(e.target)) {
        setAdminOpen(false);
      }
      if (servicesRef.current && !servicesRef.current.contains(e.target)) {
        setServicesOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

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
    return () => {
      alive = false;
      window.removeEventListener("provider:favorites:changed", onChanged);
    };
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
    return () => {
      cancelled = true;
      clearInterval(id);
    };
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
      } catch {
        setFavCount(0);
      }
    };
    fetchFavs();
    const onFavChanged = () => fetchFavs();
    window.addEventListener("wishlist:changed", onFavChanged);
    fetchFavs(location.pathname + location.search);
    return () => window.removeEventListener("wishlist:changed", onFavChanged);
  }, [role, location]);

  const providerRequests = (counts?.requests_open || 0) + (counts?.requests_accepted || 0);
  const bookingsBadge = (counts?.bookings_pending ?? counts?.bookings_total ?? 0) || 0;

  // close mobile & dropdowns on route change
  useEffect(() => {
    setMobileOpen(false);
    setAdminOpen(false);
    setServicesOpen(false);
  }, [location]);

  return (
    <header className="sticky top-0 z-40 bg-[#111] text-white border-b border-black/40 relative">
      {/* LOGO — в самом левом углу */}
      <Link
        to="/"
        className="absolute left-2 sm:left-3 md:left-4 top-1/2 -translate-y-1/2 inline-flex items-center"
        aria-label="Travella Home"
      >
        <img
          src="/logo1.jpg"
          alt="Travella"
          className="h-10 w-auto object-contain sm:h-11 md:h-12"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = "/logo7.jpg";
          }}
        />
      </Link>

      {/* Внутренний контейнер навигации */}
      <div className="mx-auto max-w-7xl px-2 sm:px-3">
        {/* One-row desktop header */}
        <div className="h-14 flex items-center justify-between gap-2 pl-16 sm:pl-20 md:pl-24">
          {/* Left group */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-orange-400"
              aria-label="Menu"
            >
              {mobileOpen ? <IconClose /> : <IconBurger />}
            </button>

            {/* Products */}
            <nav className="hidden md:flex items-center gap-2 lg:gap-3">
              <NavItemDark to="/" label="MARKETPLACE" end />
              {role === "provider" && (
                <NavItemDark to="/tour-builder" label={t("nav.tour_builder", "Tour Builder")} />
              )}
              <NavItemDark to="/hotels" label={t("nav.hotels", "Отели")} icon={<IconHotel />} />
            </nav>

            {/* Admin dropdown (desktop) */}
            {isAdmin && (
              <div className="hidden md:block relative ml-1" ref={adminRef}>
                <button
                  type="button"
                  onClick={() => setAdminOpen((v) => !v)}
                  className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full text-sm transition
                    ${
                      adminOpen
                        ? "bg-white/10 text-white"
                        : "text-white/80 hover:text-white hover:bg-white/10"
                    }`}
                >
                  <IconModeration className="opacity-90" />
                  <span>{t("nav.admin", "Админ")}</span>
                  <IconChevron className={`transition ${adminOpen ? "rotate-180" : ""}`} />
                </button>

                {adminOpen && (
                  <div className="absolute left-0 mt-2 w-64 rounded-2xl bg-[#171717] ring-1 ring-white/10 shadow-xl overflow-hidden">
                    <DropdownItem
                      to="/admin/moderation"
                      label={t("moderation.title", "Модерация")}
                      icon={<IconModeration />}
                    />
                    <DropdownItem
                      to="/admin/inside-requests"
                      label={t("nav.inside_requests", "Inside заявки")}
                      icon={<IconChecklist />}
                    />
                    <DropdownItem
                      to="/admin/providers"
                      label={t("nav.providers_admin", "Провайдеры")}
                      icon={<IconUsers />}
                    />
                    <DropdownItem
                      to="/admin/entry-fees"
                      label={t("nav.entry_fees_admin", "Entry fees")}
                      icon={<IconTicket />}
                    />
                    <DropdownItem
                      to="/admin/hotels"
                      label={t("nav.hotels_admin", "Отели (админ)")}
                      icon={<IconHotel />}
                    />
                    <DropdownItem
                      to="/admin/pages"
                      label={t("nav.cms_pages", "Подвал")}
                      icon={<IconDoc />}
                    />
                    <div className="border-t border-white/10 p-2">
                      <AdminQuickTools />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right group */}
          <div className="hidden md:flex items-center gap-1">
            {role === "provider" && (
              <>
                <NavBadgeDark
                  to="/dashboard"
                  label={t("nav.dashboard")}
                  icon={<IconDashboard />}
                />

                {/* ▼ УСЛУГИ: дропдаун с тремя пунктами */}
                <div className="relative" ref={servicesRef}>
                  <button
                    type="button"
                    onClick={() => setServicesOpen((v) => !v)}
                    className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full text-sm transition 
                      ${
                        servicesOpen
                          ? "bg-white/10 text-white"
                          : "text-white/80 hover:text-white hover:bg-white/10"
                      }`}
                  >
                    <IconChecklist />
                    <span>{t("nav.services_tab", "Услуги")}</span>
                    <IconChevron className={`transition ${servicesOpen ? "rotate-180" : ""}`} />
                  </button>

                  {servicesOpen && (
                    <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-[#171717] ring-1 ring-white/10 shadow-xl overflow-hidden z-30">
                      <DropdownItem
                        to="/dashboard/services/tourbuilder"
                        label={t(
                          "nav.services_tourbuilder",
                          "Услуги для Tour Builder"
                        )}
                        icon={<IconChecklist />}
                      />
                      <DropdownItem
                        to="/dashboard/services/marketplace"
                        label={t(
                          "nav.services_marketplace",
                          "Услуги для MARKETPLACE"
                        )}
                        icon={<IconChecklist />}
                      />
                      <DropdownItem
                        to="/dashboard/calendar"
                        label={t("nav.provider_calendar", "Календарь")}
                        icon={<IconBookings />}
                      />
                    </div>
                  )}
                </div>

                <NavBadgeDark
                  to="/dashboard/requests"
                  label={t("nav.requests")}
                  icon={<IconRequests />}
                  value={providerRequests}
                  loading={loading}
                />
                <NavBadgeDark
                  to="/dashboard/favorites"
                  label={t("nav.favorites") || "Избранное"}
                  icon={<IconHeart />}
                  value={favCount}
                />
                <NavBadgeDark
                  to="/dashboard/bookings"
                  label={t("nav.bookings")}
                  icon={<IconBookings />}
                  value={bookingsBadge}
                  loading={loading}
                />
                {/* Профиль провайдера — как раньше */}
                <NavItemDark
                  to="/dashboard/profile"
                  label={t("nav.profile", "Профиль")}
                  icon={<IconProfile />}
                />
              </>
            )}

            {role === "client" && (
              <>
                <NavBadgeDark
                  to="/client/dashboard"
                  label={t("client.header.cabinet", "Кабинет")}
                  icon={<IconDashboard />}
                />
                <NavBadgeDark
                  to="/client/dashboard?tab=favorites"
                  label={t("client.header.favorites", "Избранное")}
                  icon={<IconHeart />}
                  value={favCount}
                />
              </>
            )}

            <div className="ml-2 pl-2 border-l border-white/10">
              <LanguageSelector />
            </div>
          </div>

          {/* Mobile lang only */}
          <div className="md:hidden flex items-center">
            <LanguageSelector />
          </div>
        </div>

        {/* ===== Mobile drawer ===== */}
        <div
          className={`md:hidden overflow-hidden transition-[max-height] duration-300 ${
            mobileOpen ? "max-h-[80vh]" : "max-h-0"
          }`}
          aria-hidden={!mobileOpen}
        >
          <nav className="pb-3 -mx-1">
            {role && (
              <RowGroupDark title={t("nav.ops", "Операционка")}>
                {role === "provider" && (
                  <>
                    <NavItemMobileDark
                      to="/dashboard"
                      label={t("nav.dashboard")}
                      icon={<IconDashboard />}
                      end
                    />
                    {/* Услуги в мобиле просто списком */}
                    <NavItemMobileDark
                      to="/dashboard/services/tourbuilder"
                      label={t(
                        "nav.services_tourbuilder",
                        "Услуги для Tour Builder"
                      )}
                      icon={<IconChecklist />}
                    />
                    <NavItemMobileDark
                      to="/dashboard/services/marketplace"
                      label={t(
                        "nav.services_marketplace",
                        "Услуги для MARKETPLACE"
                      )}
                      icon={<IconChecklist />}
                    />
                    <NavItemMobileDark
                      to="/dashboard/calendar"
                      label={t("nav.provider_calendar", "Календарь")}
                      icon={<IconBookings />}
                    />

                    <NavItemMobileDark
                      to="/dashboard/requests"
                      label={t("nav.requests")}
                      icon={<IconRequests />}
                      badge={providerRequests}
                      loading={loading}
                    />
                    <NavItemMobileDark
                      to="/dashboard/favorites"
                      label={t("nav.favorites") || "Избранное"}
                      icon={<IconHeart />}
                      badge={favCount}
                    />
                    <NavItemMobileDark
                      to="/dashboard/bookings"
                      label={t("nav.bookings")}
                      icon={<IconBookings />}
                      badge={bookingsBadge}
                      loading={loading}
                    />
                    <NavItemMobileDark
                      to="/dashboard/profile"
                      label={t("nav.profile", "Профиль")}
                      icon={<IconProfile />}
                    />
                  </>
                )}
                {role === "client" && (
                  <>
                    <NavItemMobileDark
                      to="/client/dashboard"
                      label={t("client.header.cabinet", "Кабинет")}
                      icon={<IconDashboard />}
                    />
                    <NavItemMobileDark
                      to="/client/dashboard?tab=favorites"
                      label={t("client.header.favorites", "Избранное")}
                      icon={<IconHeart />}
                      badge={favCount}
                    />
                  </>
                )}
              </RowGroupDark>
            )}

            <RowGroupDark title={t("nav.products", "Продукты")}>
              <NavItemMobileDark to="/marketplace" label="MARKETPLACE" />
              {role === "provider" && (
                <NavItemMobileDark
                  to="/tour-builder"
                  label={t("nav.tour_builder", "Tour Builder")}
                />
              )}
              <NavItemMobileDark
                to="/hotels"
                label={t("nav.hotels", "Отели")}
                icon={<IconHotel />}
              />
            </RowGroupDark>

            {isAdmin && (
              <RowGroupDark title={t("nav.admin", "Админ")}>
                <NavItemMobileDark
                  to="/admin/moderation"
                  label={t("moderation.title", "Модерация")}
                  icon={<IconModeration />}
                />
                <NavItemMobileDark
                  to="/admin/inside-requests"
                  label={t("nav.inside_requests", "Inside заявки")}
                  icon={<IconChecklist />}
                />
                <NavItemMobileDark
                  to="/admin/providers"
                  label={t("nav.providers_admin", "Провайдеры")}
                  icon={<IconUsers />}
                />
                <NavItemMobileDark
                  to="/admin/entry-fees"
                  label={t("nav.entry_fees_admin", "Entry fees")}
                  icon={<IconTicket />}
                />
                <NavItemMobileDark
                  to="/admin/hotels"
                  label={t("nav.hotels_admin", "Отели (админ)")}
                  icon={<IconHotel />}
                />
                <NavItemMobileDark
                  to="/admin/pages"
                  label={t("nav.cms_pages", "Подвал")}
                  icon={<IconDoc />}
                />
              </RowGroupDark>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

/* ---------- Subcomponents ---------- */

function RowGroupDark({ title, children }) {
  return (
    <div className="mb-2 rounded-xl ring-1 ring-white/10 bg-[#171717] overflow-hidden text-white">
      <div className="px-3 py-2 text-[13px] font-semibold text-white/70 bg-black/20">{title}</div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function NavItemDark({ to, label, icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "relative shrink-0 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full transition-colors whitespace-nowrap",
          "text-sm",
          isActive
            ? "bg-white/10 text-white font-semibold after:content-[''] after:absolute after:left-3 after:right-3 after:-bottom-1 after:h-[2px] after:bg-orange-400 after:rounded-full"
            : "text-white/80 hover:text-white hover:bg-white/10",
        ].join(" ")
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

function NavBadgeDark({ to, label, value, loading, icon }) {
  const show = Number.isFinite(value) && value > 0;
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "relative shrink-0 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full transition-colors whitespace-nowrap",
          "text-sm",
          isActive
            ? "bg-white/10 text-white font-semibold after:content-[''] after:absolute after:left-3 after:right-3 after:-bottom-1 after:h-[2px] after:bg-orange-400 after:rounded-full"
            : "text-white/80 hover:text-white hover:bg-white/10",
        ].join(" ")
      }
    >
      {icon}
      <span>{label}</span>
      <span
        className={[
          "ml-1 min-w-[20px] h-[20px] px-1 rounded-full text-[11px] leading-none flex items-center justify-center transition-colors",
          show ? "bg-orange-500 text-white" : "bg-white/10 text-white/70",
        ].join(" ")}
      >
        {loading ? "…" : show ? value : 0}
      </span>
    </NavLink>
  );
}

function DropdownItem({ to, label, icon }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
          isActive ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/10 hover:text-white",
        ].join(" ")
      }
    >
      <div className="w-5 h-5">{icon}</div>
      <div className="flex-1">{label}</div>
    </NavLink>
  );
}

function NavItemMobileDark({ to, label, icon, end, badge, loading }) {
  const show = Number.isFinite(badge) && badge > 0;
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
          isActive ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/10 hover:text-white",
        ].join(" ")
      }
    >
      <div className="w-5 h-5">{icon}</div>
      <div className="flex-1">{label}</div>
      {badge != null && (
        <span
          className={[
            "min-w-[20px] h-[20px] px-1 rounded-full text-[11px] leading-none flex items-center justify-center",
            show ? "bg-orange-500 text-white" : "bg-white/10 text-white/70",
          ].join(" ")}
        >
          {loading ? "…" : show ? badge : 0}
        </span>
      )}
    </NavLink>
  );
}
