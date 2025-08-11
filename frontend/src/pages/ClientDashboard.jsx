import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPut, apiPost } from "../api";

export default function ClientDashboard() {
  const { t } = useTranslation();

  // ----- Профиль -----
  const [me, setMe] = useState(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [err, setErr] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatar, setAvatar] = useState("");
  const [languages, setLanguages] = useState([]);
  const [location, setLocation] = useState(null);
  const [saveMsg, setSaveMsg] = useState("");

  // ----- Витрина отказных туров -----
  const [results, setResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);

  // ----- Вкладки: Мои запросы / Мои бронирования -----
  const [activeTab, setActiveTab] = useState("requests"); // 'requests' | 'bookings'

  // Requests
  const [myRequests, setMyRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [replyTextById, setReplyTextById] = useState({}); // { [requestId]: "text" }

  // Bookings
  const [myBookings, setMyBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);

  // ===== Init profile =====
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

  // ===== Load lists on mount =====
  useEffect(() => {
    if (!loadingMe) {
      loadMyRequests();
      loadMyBookings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMe]);

  // ----- Profile -----
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

  // ----- Refused tours -----
  const searchRefusedTours = async () => {
    setLoadingSearch(true);
    setResults([]);
    try {
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
    try {
      await apiPost("/api/requests", { serviceId, text });
      await loadMyRequests();
      alert(t("request_sent") || "Request sent");
    } catch (e) {
      alert(e.message);
    }
  };

  const handleBook = async (serviceId) => {
    try {
      await apiPost("/api/bookings", { serviceId });
      await loadMyBookings();
      alert(t("booking_requested") || "Booking requested");
    } catch (e) {
      alert(e.message);
    }
  };

  // ----- Requests API -----
  async function loadMyRequests() {
    setLoadingRequests(true);
    try {
      const rows = await apiGet("/api/requests/my");
      setMyRequests(rows || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoadingRequests(false);
    }
  }

  async function sendReply(requestId) {
    const text = (replyTextById[requestId] || "").trim();
    if (!text) return;
    try {
      await apiPost(`/api/requests/${requestId}/reply`, { text });
      setReplyTextById((prev) => ({ ...prev, [requestId]: "" }));
      await loadMyRequests();
    } catch (e) {
      alert(e.message);
    }
  }

  async function acceptProposal(requestId) {
    try {
      await apiPost(`/api/requests/${requestId}/accept`, {});
      await loadMyRequests();
      // После принятия предложения клиент может сразу создать бронирование по этому requestId
      // (оставляем вручную: клиент выберет подходящую услугу в списке запросов)
    } catch (e) {
      alert(e.message);
    }
  }

  async function declineProposal(requestId) {
    try {
      await apiPost(`/api/requests/${requestId}/decline`, {});
      await loadMyRequests();
    } catch (e) {
      alert(e.message);
    }
  }

  async function bookFromRequest(serviceId, requestId) {
    try {
      await apiPost("/api/bookings", { serviceId, requestId });
      await loadMyBookings();
      alert(t("booking_requested") || "Booking requested");
    } catch (e) {
      alert(e.message);
    }
  }

  // ----- Bookings API -----
  async function loadMyBookings() {
    setLoadingBookings(true);
    try {
      const rows = await apiGet("/api/bookings/my");
      setMyBookings(rows || []);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoadingBookings(false);
    }
  }

  async function cancelBooking(id) {
    const reason = prompt(t("cancel_reason_optional") || "Reason (optional):") || undefined;
    try {
      await apiPost(`/api/bookings/${id}/cancel`, { reason });
      await loadMyBookings();
    } catch (e) {
      alert(e.message);
    }
  }

  // ===== Render =====
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

        {/* Вкладки: Мои запросы / Мои бронирования */}
        <div className="md:col-span-2 bg-white p-6 rounded-xl shadow">
          <div className="flex gap-2 mb-4">
            <TabButton
              active={activeTab === "requests"}
              onClick={() => setActiveTab("requests")}
              label={t("my_requests") || "My requests"}
            />
            <TabButton
              active={activeTab === "bookings"}
              onClick={() => setActiveTab("bookings")}
              label={t("my_bookings") || "My bookings"}
            />
          </div>

          {activeTab === "requests" ? (
            <RequestsList
              items={myRequests}
              loading={loadingRequests}
              replyTextById={replyTextById}
              setReplyTextById={setReplyTextById}
              onReply={sendReply}
              onAccept={acceptProposal}
              onDecline={declineProposal}
              onBookFromRequest={bookFromRequest}
              t={t}
            />
          ) : (
            <BookingsList
              items={myBookings}
              loading={loadingBookings}
              onCancel={cancelBooking}
              t={t}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label }) {
  return (
    <button
      className={`px-4 py-2 rounded-lg font-semibold border ${active ? "bg-orange-500 text-white border-orange-500" : "bg-white text-gray-700 border-gray-300"}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function RequestsList({
  items, loading, replyTextById, setReplyTextById,
  onReply, onAccept, onDecline, onBookFromRequest, t
}) {
  if (loading) return <div>{t("loading") || "Loading..."}</div>;
  if (!items || items.length === 0) return <div className="text-sm text-gray-500">{t("no_requests") || "No requests yet."}</div>;

  return (
    <div className="space-y-4">
      {items.map((r) => {
        const created = r.created_at ? new Date(r.created_at).toLocaleString() : "";
        const proposal = r.proposal || null;
        const canAccept = r.status === "proposed";
        const canDecline = r.status === "proposed";

        return (
          <div key={r.id} className="border rounded-lg p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div className="font-semibold">
                {t("request") || "Request"} #{r.id} · {t("service") || "Service"} #{r.service_id}
              </div>
              <div className="text-sm text-gray-600">
                {t("status") || "Status"}: <b>{r.status}</b> · {created}
              </div>
            </div>

            {/* Сообщения */}
            <div className="mt-3 bg-gray-50 rounded p-3 max-h-56 overflow-auto">
              {(r.messages || []).map((m) => (
                <div key={m.id} className="text-sm mb-2">
                  <span className="font-semibold">{m.sender_role}</span>: {m.text}{" "}
                  <span className="text-gray-500">· {new Date(m.created_at).toLocaleString()}</span>
                </div>
              ))}
              {(!r.messages || r.messages.length === 0) && (
                <div className="text-sm text-gray-500">{t("no_messages") || "No messages yet."}</div>
              )}
            </div>

            {/* Предложение провайдера */}
            {proposal && (
              <div className="mt-3 border rounded p-3">
                <div className="font-semibold mb-1">{t("provider_proposal") || "Provider proposal"}</div>
                <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(proposal, null, 2)}</pre>
              </div>
            )}

            {/* Действия: ответ, принять/отклонить, забронировать по запросу */}
            <div className="mt-3 flex flex-col md:flex-row gap-2">
              <div className="flex-1">
                <input
                  className="w-full border px-3 py-2 rounded text-sm"
                  placeholder={t("write_a_message") || "Write a message..."}
                  value={replyTextById[r.id] || ""}
                  onChange={(e) => setReplyTextById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                />
              </div>
              <button
                className="md:w-40 bg-orange-500 text-white py-2 rounded font-bold"
                onClick={() => onReply(r.id)}
              >
                {t("send") || "Send"}
              </button>
              {canAccept && (
                <button
                  className="md:w-40 border border-green-600 text-green-700 py-2 rounded font-bold"
                  onClick={() => onAccept(r.id)}
                >
                  {t("accept") || "Accept"}
                </button>
              )}
              {canDecline && (
                <button
                  className="md:w-40 border border-red-600 text-red-700 py-2 rounded font-bold"
                  onClick={() => onDecline(r.id)}
                >
                  {t("decline") || "Decline"}
                </button>
              )}
              {/* Кнопка бронирования из запроса: разрешаем при accepted или когда есть proposal */}
              {(r.status === "accepted" || r.proposal) && (
                <button
                  className="md:w-52 bg-gray-800 text-white py-2 rounded font-bold"
                  onClick={() => onBookFromRequest(r.service_id, r.id)}
                >
                  {t("book_with_this_proposal") || "Book with this proposal"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BookingsList({ items, loading, onCancel, t }) {
  if (loading) return <div>{t("loading") || "Loading..."}</div>;
  if (!items || items.length === 0) return <div className="text-sm text-gray-500">{t("no_bookings") || "No bookings yet."}</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {items.map((b) => {
        const created = b.created_at ? new Date(b.created_at).toLocaleString() : "";
        const details = b.details || null;

        return (
          <div key={b.id} className="border rounded-lg p-4">
            <div className="font-semibold">
              {t("booking") || "Booking"} #{b.id} · {t("service") || "Service"} #{b.service_id}
            </div>
            <div className="text-sm text-gray-600 mt-1">
              {t("status") || "Status"}: <b>{b.status}</b> · {created}
            </div>

            {details && (
              <div className="mt-2 bg-gray-50 rounded p-2">
                <div className="text-sm font-semibold mb-1">{t("details") || "Details"}</div>
                <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(details, null, 2)}</pre>
              </div>
            )}

            <div className="mt-3 flex gap-2">
              {(b.status === "pending" || b.status === "confirmed") && (
                <button
                  className="border border-red-600 text-red-700 py-2 px-4 rounded font-bold"
                  onClick={() => onCancel(b.id)}
                >
                  {t("cancel") || "Cancel"}
                </button>
              )}
            </div>
          </div>
        );
      })}
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
