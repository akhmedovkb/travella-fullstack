import { useEffect, useMemo, useState } from "react";
import LanguageSelector from "./LanguageSelector";

const API_URL = import.meta.env.VITE_API_BASE_URL;

export default function Header() {
  const clientToken = localStorage.getItem("clientToken");
  const providerToken = localStorage.getItem("token") || localStorage.getItem("providerToken"); // на случай разных имен
  const role = useMemo(() => (clientToken ? "client" : providerToken ? "provider" : null), [clientToken, providerToken]);

  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(false);

  async function fetchCounts() {
    if (!role) return;
    setLoading(true);
    try {
      const token = role === "client" ? clientToken : providerToken;
      const res = await fetch(`${API_URL}/api/notifications/counts`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (res.ok) setCounts(data.counts || null);
    } catch (e) {
      // no-op
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCounts();
    const id = setInterval(fetchCounts, 30000); // обновление каждые 30 сек
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <a href="/" className="text-xl font-bold text-gray-800">Travella</a>

        {role === "client" && (
          <div className="flex items-center gap-2">
            <BadgeLink href="/client/dashboard" label="Requests" value={counts?.requests_open + counts?.requests_proposed} loading={loading} />
            <BadgeLink href="/client/dashboard" label="Bookings" value={counts?.bookings_pending} loading={loading} />
          </div>
        )}

        {role === "provider" && (
          <div className="flex items-center gap-2">
            <BadgeLink href="/dashboard" label="Requests" value={counts?.requests_open + counts?.requests_accepted} loading={loading} />
            <BadgeLink href="/dashboard" label="Bookings" value={counts?.bookings_pending} loading={loading} />
          </div>
        )}
      </div>

      <LanguageSelector />
    </div>
  );
}

function BadgeLink({ href, label, value, loading }) {
  const show = typeof value === "number" && value > 0;
  return (
    <a href={href} className="relative inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900">
      <span>{label}</span>
      <span className={`min-w-[22px] h-[22px] px-1 rounded-full text-xs flex items-center justify-center ${show ? "bg-orange-500 text-white" : "bg-gray-200 text-gray-600"}`}>
        {loading ? "…" : (show ? value : 0)}
      </span>
    </a>
  );
}
