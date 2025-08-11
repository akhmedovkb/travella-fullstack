import { useEffect, useState } from "react";
import { apiGet, apiPut } from "../api";
import { useTranslation } from "react-i18next";

export default function ClientDashboard() {
  const { t } = useTranslation();

  // профиль
  const [profile, setProfile] = useState({
    name: "",
    phone: "",
    avatar_url: "",
    languages_csv: "",
  });
  const [saving, setSaving] = useState(false);

  // отказные туры
  const [refused, setRefused] = useState([]);
  const [loadingRefused, setLoadingRefused] = useState(false);

  // вкладки
  const [tab, setTab] = useState<"req" | "book">("req");
  const [myRequests, setMyRequests] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [loadingTab, setLoadingTab] = useState(false);

  // ----- loaders -----
  async function loadProfile() {
    try {
      const me = await apiGet("/api/clients/me"); // GET профиль клиента
      if (me) {
        setProfile((p) => ({
          ...p,
          name: me.name ?? "",
          phone: me.phone ?? "",
          avatar_url: me.avatar_url ?? "",
          languages_csv: me.languages_csv ?? "",
        }));
      }
    } catch (e) {
      console.warn("profile load:", e.message);
    }
  }

  async function loadRefused() {
    setLoadingRefused(true);
    try {
      // если эндпоинта нет — поймаем и покажем пусто
      const rows = await apiGet("/api/marketplace/refused").catch(() => []);
      setRefused(Array.isArray(rows) ? rows : []);
    } finally {
      setLoadingRefused(false);
    }
  }

  async function loadTab(which) {
    setLoadingTab(true);
    try {
      if (which === "req") {
        const rows = await apiGet("/api/requests/my").catch(() => []);
        setMyRequests(Array.isArray(rows) ? rows : []);
      } else {
        const rows = await apiGet("/api/bookings/my").catch(() => []);
        setMyBookings(Array.isArray(rows) ? rows : []);
      }
    } finally {
      setLoadingTab(false);
    }
  }

  // init
  useEffect(() => {
    loadProfile();
    loadRefused();
    loadTab("req");
  }, []);

  // переключение вкладок — подгружаем лениво
  useEffect(() => {
    if (tab === "req" && myRequests.length === 0) loadTab("req");
    if (tab === "book" && myBookings.length === 0) loadTab("book");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiPut("/api/clients/me", profile); // PUT профиль клиента
    } catch (e2) {
      alert(e2.message || "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Профиль */}
        <div className="bg-white p-6 rounded-xl shadow">
          <h2 className="text-xl font-bold mb-4">{t("client.dashboard.profileTitle")}</h2>
          <form onSubmit={saveProfile} className="space-y-3">
            <input
              className="w-full border rounded px-3 py-2"
              placeholder={t("client.dashboard.name")}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
            <input
              className="w-full border rounded px-3 py-2"
              placeholder={t("client.dashboard.phone")}
              value={profile.phone}
              onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
            />
            <input
              className="w-full border rounded px-3 py-2"
              placeholder={t("client.dashboard.avatarUrl")}
              value={profile.avatar_url}
              onChange={(e) => setProfile({ ...profile, avatar_url: e.target.value })}
            />
            <input
              className="w-full border rounded px-3 py-2"
              placeholder={t("client.dashboard.languagesCsv")}
              value={profile.languages_csv}
              onChange={(e) => setProfile({ ...profile, languages_csv: e.target.value })}
            />
            <button
              type="submit"
              disabled={saving}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded transition"
            >
              {saving ? t("common.loading") : t("client.dashboard.saveBtn")}
            </button>
          </form>
        </div>

        {/* Отказные туры */}
        <div className="bg-white p-6 rounded-xl shadow">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">{t("client.dashboard.refusedTours")}</h2>
            <button
              onClick={loadRefused}
              className="text-orange-600 hover:underline"
              disabled={loadingRefused}
            >
              {t("client.dashboard.refresh")}
            </button>
          </div>

          {loadingRefused ? (
            <div className="text-sm text-gray-500">{t("common.loading")}</div>
          ) : refused.length === 0 ? (
            <div className="text-sm text-gray-500">{t("client.dashboard.noResults")}</div>
          ) : (
            <ul className="space-y-2">
              {refused.map((it) => (
                <li key={it.id} className="border rounded p-3">
                  <div className="font-semibold">{it.title || it.name || `#${it.id}`}</div>
                  {it.price && <div className="text-sm text-gray-600">Net: {it.price}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* нижние вкладки */}
      <div className="bg-white p-6 rounded-xl shadow mt-6">
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setTab("req")}
            className={`px-3 py-1 rounded-full text-sm ${
              tab === "req" ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-800"
            }`}
          >
            {t("client.dashboard.tabs.myRequests")}
          </button>
          <button
            onClick={() => setTab("book")}
            className={`px-3 py-1 rounded-full text-sm ${
              tab === "book" ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-800"
            }`}
          >
            {t("client.dashboard.tabs.myBookings")}
          </button>
        </div>

        {loadingTab ? (
          <div className="text-sm text-gray-500">{t("common.loading")}</div>
        ) : tab === "req" ? (
          myRequests.length === 0 ? (
            <div className="text-sm text-gray-500">{t("client.dashboard.noRequests")}</div>
          ) : (
            <ul className="space-y-2">
              {myRequests.map((r) => (
                <li key={r.id} className="border rounded p-3">
                  <div className="font-semibold">
                    Request #{r.id} · Service #{r.service_id}
                  </div>
                  <div className="text-sm text-gray-600">
                    {r.status} · {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : myBookings.length === 0 ? (
          <div className="text-sm text-gray-500">{t("client.dashboard.noBookings")}</div>
        ) : (
          <ul className="space-y-2">
            {myBookings.map((b) => (
              <li key={b.id} className="border rounded p-3">
                <div className="font-semibold">
                  Booking #{b.id} · Service #{b.service_id}
                </div>
                <div className="text-sm text-gray-600">
                  {b.status || ""} {b.created_at ? `· ${new Date(b.created_at).toLocaleString()}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
