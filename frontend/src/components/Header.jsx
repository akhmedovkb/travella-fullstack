import { useEffect, useMemo, useState } from "react";
import LanguageSelector from "./LanguageSelector";
import { apiGet } from "../api";

export default function Header() {
  const hasClient = !!localStorage.getItem("clientToken");
  const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
  const role = useMemo(() => (hasClient ? "client" : hasProvider ? "provider" : null), [hasClient, hasProvider]);

  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(false);

  async function fetchCounts() {
    if (!role) return;
    setLoading(true);
    try {
      const data = await apiGet("/api/notifications/counts");
      setCounts(data?.counts || null);
    } catch (_) {
      setCounts(null); // важно: не падать
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCounts();
    const id = setInterval(fetchCounts, 30000);
    return () => clearInterval(id);
  }, [role]);

  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <a href="/" className="text-xl font-bold text-gray-800">Travella</a>

        {role === "client" && (
          <div className="flex items-center gap-2">
            <BadgeLink href="/client/dashboard" label="Requests" value={(counts?.requests_open || 0) + (counts?.requests_proposed || 0)} loading={loading} />
            <BadgeLink href="/client/dashboard" label="Bookings" value={counts?.bookings_pending || 0} loading={loading} />
          </div>
        )}

        {role === "provider" && (
          <div className="flex items-center gap-2">
            <BadgeLink href="/dashboard/requests" label="Requests" value={(counts?.requests_open || 0) + (counts?.requests_accepted || 0)} loading={loading} />
            <BadgeLink href="/dashboard/bookings" label="Bookings" value={counts?.bookings_pending || 0} loading={loading} />
          </div>
        )}
      </div>

      <LanguageSelector />
    </div>
  );
}

function BadgeLink({ href, label, value, loading }) {
  const show = Number.isFinite(value) && value > 0;
  return (
    <a href={href} className="relative inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900">
      <span>{label}</span>
      <span className={`min-w-[22px] h-[22px] px-1 rounded-full text-xs flex items-center justify-center ${show ? "bg-orange-500 text-white" : "bg-gray-200 text-gray-600"}`}>
        {loading ? "…" : (show ? value : 0)}
      </span>
    </a>
  );
}
