import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPut, apiPost } from "../api";

export default function ClientDashboard() {
  const { t } = useTranslation();
  const [me, setMe] = useState(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [err, setErr] = useState("");

  // Marketplace
  const [results, setResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);

  // Edit profile fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatar, setAvatar] = useState("");
  const [languages, setLanguages] = useState([]);
  const [location, setLocation] = useState(null);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const profile = await apiGet("/api/clients/profile");
        setMe(profile);
        setName(profile?.name || "");
        setPhone(profile?.phone || "");
        setAvatar(profile?.avatar || "");
        setLanguages(profile?.languages || []);
        setLocation(profile?.location || null);
      } catch (e) {
        setErr(e.message);
      } finally {
        setLoadingMe(false);
      }
    })();
  }, []);

  const handleSaveProfile = async () => {
    setSaveMsg("");
    try {
      const updated = await apiPut("/api/clients/profile", {
        name, phone, avatar, languages, location,
      });
      setMe(updated);
      setSaveMsg(t("saved") || "Saved");
    } catch (e) {
      setErr(e.message);
    }
  };

  const searchRefusedTours = async () => {
    setLoadingSearch(true);
    setResults([]);
    try {
      // Пример простого поиска отказных туров без фильтров
      const data = await apiPost("/api/marketplace/search", {
        category: "refused_tour",
        page: 1,
        pageSize: 12,
      });
      setResults(data?.items || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoadingSearch(false);
    }
  };

  const handleRequestChange = async (serviceId, text) => {
    // Черновой маршрут — реализуем позже
    try {
      await apiPost("/api/requests", { serviceId, text });
      alert(t("request_sent") || "Request sent");
    } catch (e) {
      alert(e.message);
    }
  };

  const handleBook = async (serviceId) => {
    // Черновик — создадим реальный бронирование-роут позже
    try {
      await apiPost("/api/bookings", { serviceId });
      alert(t("booking_requested") || "Booking requested");
    } catch (e) {
      alert(e.message);
    }
  };

  if (loadingMe) {
    return <div className="p-6">{t("loading") || "Loading..."}</div>;
  }

  if (!me) {
    return (
      <div className="p-6">
        {t("unauthorized") || "Unauthorized"} —{" "}
        <a className="text-orange-600 underline" href="/client/login">
          {t("login") || "Login"}
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Профиль */}
        <div className="bg-white p-6 rounded-xl shadow">
          <h2 className="text-2xl font-bold mb-4">{t("client.profile") || "Client Profile"}</h2>
          {err && <div className="mb-3 text-red-600 text-sm">{err}</div>}

          <div className="space-y-3">
            <input
              className="w-full border px-3 py-2 rounded"
              placeholder={t("name") || "Name"}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full border px-3 py-2 rounded"
              placeholder={t("phone") || "Phone"}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <input
              className="w-full border px-3 py-2 rounded"
              placeholder={t("avatar_url") || "Avatar URL (optional)"}
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
            />
            <input
              className="w-full border px-3 py-2 rounded"
              placeholder={t("languages_csv") || "Languages (comma-separated)"}
              value={languages.join(",")}
              onChange={(e) => setLanguages(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
            />

            <button
              className="w-full bg-orange-500 text-white py-2 rounded font-bold"
              onClick={handleSaveProfile}
            >
              {t("save") || "Save"}
            </button>

            {saveMsg && <div className="text-green-600 text-sm">{saveMsg}</div>}
          </div>
        </div>

        {/* Витрина отказных туров */}
        <div className="bg-white p-6 rounded-xl shadow">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">{t("refused_tours") || "Refused Tours"}</h2>
            <button
              className="text-sm text-orange-600 underline"
              onClick={searchRefusedTours}
              disabled={loadingSearch}
            >
              {loadingSearch ? (t("loading") || "Loading...") : (t("refresh") || "Refresh")}
            </button>
          </div>

          {results.length === 0 ? (
            <div className="text-sm text-gray-500">
              {t("no_results") || "No results yet. Click Refresh."}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {results.map((s) => {
                const d = s.details || {};
                return (
                  <div key={s.id} className="border rounded-lg p-3">
                    <div className="font-semibold text-lg mb-1">{d.title || s.title || t("tour") || "Tour"}</div>
                    <div className="text-sm text-gray-600">
                      {(d.directionCountry ? `${d.directionCountry}` : "")}
                      {d.directionFrom ? ` · ${d.directionFrom}` : ""}
                      {d.directionTo ? ` → ${d.directionTo}` : ""}
                    </div>
                    <div className="text-sm text-gray-600">
                      {d.startDate && d.endDate ? `${d.startDate} — ${d.endDate}` : ""}
                    </div>
                    {d.netPrice && (
                      <div className="font-bold mt-1">{t("price") || "Price"}: {d.netPrice}</div>
                    )}

                    <div className="mt-3 flex gap-2">
                      <button
                        className="flex-1 bg-orange-500 text-white py-2 rounded font-bold"
                        onClick={() => handleBook(s.id)}
                      >
                        {t("book") || "Book"}
                      </button>
                      {d.changeable && (
                        <ChangeRequestButton
                          onSend={(text) => handleRequestChange(s.id, text)}
                          t={t}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChangeRequestButton({ onSend, t }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  return (
    <div className="flex-1">
      {!open ? (
        <button
          className="w-full border border-orange-500 text-orange-600 py-2 rounded font-bold"
          onClick={() => setOpen(true)}
        >
          {t("request_change") || "Request change"}
        </button>
      ) : (
        <div className="border rounded p-2">
          <textarea
            className="w-full border px-2 py-1 rounded text-sm"
            rows={3}
            placeholder={t("describe_change") || "Describe your request (hotel, room, add infant, etc.)"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <button
              className="flex-1 bg-orange-500 text-white py-2 rounded font-bold"
              onClick={() => { if (text.trim()) onSend(text.trim()); setOpen(false); setText(""); }}
            >
              {t("send") || "Send"}
            </button>
            <button
              className="flex-1 border py-2 rounded font-bold"
              onClick={() => { setOpen(false); setText(""); }}
            >
              {t("cancel") || "Cancel"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
