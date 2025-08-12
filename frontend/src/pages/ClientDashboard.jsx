import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) ||
  (typeof window !== "undefined" && window.__API_URL__) ||
  "https://travella-fullstack-backend-production.up.railway.app";

const http = axios.create({
  baseURL: API_BASE,
  withCredentials: false,
});

export default function ProviderInbox() {
  const [requests, setRequests] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [forms, setForms] = useState({}); // { [requestId]: {price, currency, hotel, room, terms, message} }
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const providerToken = useMemo(
    () => localStorage.getItem("providerToken") || localStorage.getItem("token"),
    []
  );

  const authHeader = useMemo(
    () => ({ headers: { Authorization: `Bearer ${providerToken}` } }),
    [providerToken]
  );

  const guard = () => {
    if (!providerToken) {
      setMsg("В localStorage нет providerToken/token. Залогинься как провайдер.");
      return false;
    }
    return true;
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAll() {
    if (!guard()) return;
    try {
      setLoading(true);
      const [rq, bk] = await Promise.all([
        http.get("/api/requests/provider", authHeader),
        http.get("/api/bookings/provider", authHeader),
      ]);
      setRequests(rq.data || []);
      setBookings(bk.data || []);
      setMsg("Данные обновлены.");
    } catch (e) {
      setMsg(e?.response?.data?.message || "Ошибка загрузки.");
    } finally {
      setLoading(false);
    }
  }

  function changeForm(id, field, value) {
    setForms((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function sendProposal(id) {
    if (!guard()) return;
    const f = forms[id] || {};
    try {
      setLoading(true);
      await http.post(`/api/requests/${id}/proposal`, f, authHeader);
      setMsg("Предложение отправлено.");
      await refreshAll();
    } catch (e) {
      setMsg(e?.response?.data?.message || "Ошибка отправки предложения.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmBooking(id) {
    if (!guard()) return;
    try {
      setLoading(true);
      await http.post(`/api/bookings/${id}/confirm`, {}, authHeader);
      setMsg("Бронь подтверждена.");
      await refreshAll();
    } catch (e) {
      setMsg(e?.response?.data?.message || "Ошибка подтверждения.");
    } finally {
      setLoading(false);
    }
  }

  async function rejectBooking(id) {
    if (!guard()) return;
    try {
      setLoading(true);
      await http.post(`/api/bookings/${id}/reject`, {}, authHeader);
      setMsg("Бронь отклонена.");
      await refreshAll();
    } catch (e) {
      setMsg(e?.response?.data?.message || "Ошибка отклонения.");
    } finally {
      setLoading(false);
    }
  }

  async function cancelBooking(id) {
    if (!guard()) return;
    try {
      setLoading(true);
      await http.post(`/api/bookings/${id}/cancel`, {}, authHeader);
      setMsg("Бронь отменена.");
      await refreshAll();
    } catch (e) {
      setMsg(e?.response?.data?.message || "Ошибка отмены.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {msg && (
        <div className="p-3 rounded bg-blue-50 border border-blue-200 text-sm">{msg}</div>
      )}

      {/* Входящие запросы */}
      <div className="bg-white p-4 rounded-xl shadow">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Входящие запросы</div>
          <button onClick={refreshAll} className="text-sm text-orange-600 underline">
            Обновить
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {requests.length === 0 && (
            <div className="text-sm text-gray-500">Запросов нет.</div>
          )}

          {requests.map((r) => (
            <div key={r.id} className="border rounded-lg p-3">
              <div className="text-sm">
                <div className="font-medium">
                  #{r.id} • service:{r.service_id} • {r.status}
                </div>
                {r.note && <div>Заметка: {r.note}</div>}
              </div>

              {/* существующий оффер */}
              {r.proposal && (
                <div className="mt-2 p-2 bg-emerald-50 border border-emerald-200 rounded text-sm">
                  <div className="font-medium mb-1">Отправлен оффер</div>
                  <div>Цена: {r.proposal.price} {r.proposal.currency}</div>
                  {r.proposal.hotel && <div>Отель: {r.proposal.hotel}</div>}
                  {r.proposal.room && <div>Размещение: {r.proposal.room}</div>}
                  {r.proposal.terms && <div>Условия: {r.proposal.terms}</div>}
                  {r.proposal.message && <div>Сообщение: {r.proposal.message}</div>}
                </div>
              )}

              {/* форма оффера */}
              <div className="grid md:grid-cols-6 gap-2 mt-3">
                <input
                  placeholder="Цена"
                  className="border rounded px-2 py-1"
                  value={forms[r.id]?.price || ""}
                  onChange={(e) => changeForm(r.id, "price", e.target.value)}
                />
                <input
                  placeholder="Валюта (USD)"
                  className="border rounded px-2 py-1"
                  value={forms[r.id]?.currency || ""}
                  onChange={(e) => changeForm(r.id, "currency", e.target.value)}
                />
                <input
                  placeholder="Отель"
                  className="border rounded px-2 py-1"
                  value={forms[r.id]?.hotel || ""}
                  onChange={(e) => changeForm(r.id, "hotel", e.target.value)}
                />
                <input
                  placeholder="Размещение (DBL/TRPL)"
                  className="border rounded px-2 py-1"
                  value={forms[r.id]?.room || ""}
                  onChange={(e) => changeForm(r.id, "room", e.target.value)}
                />
                <input
                  placeholder="Условия"
                  className="border rounded px-2 py-1"
                  value={forms[r.id]?.terms || ""}
                  onChange={(e) => changeForm(r.id, "terms", e.target.value)}
                />
                <input
                  placeholder="Сообщение"
                  className="border rounded px-2 py-1"
                  value={forms[r.id]?.message || ""}
                  onChange={(e) => changeForm(r.id, "message", e.target.value)}
                />
              </div>

              <div className="mt-2">
                <button
                  onClick={() => sendProposal(r.id)}
                  className="bg-orange-500 text-white px-3 py-1 rounded"
                >
                  Отправить оффер
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Брони провайдера */}
      <div className="bg-white p-4 rounded-xl shadow">
        <div className="font-semibold mb-3">Мои брони</div>
        <div className="space-y-3">
          {bookings.length === 0 && (
            <div className="text-sm text-gray-500">Брони отсутствуют.</div>
          )}
          {bookings.map((b) => (
            <div
              key={b.id}
              className="border rounded-lg p-3 flex items-start justify-between gap-3"
            >
              <div className="text-sm">
                <div className="font-medium">
                  #{b.id} • {b.service_title || "услуга"} • {b.status}
                </div>
                <div>{b.price ? `${b.price} ${b.currency || ""}` : "—"}</div>
              </div>

              <div className="flex gap-2">
                {b.status === "pending" && (
                  <>
                    <button
                      onClick={() => confirmBooking(b.id)}
                      className="text-sm bg-green-600 text-white px-3 py-1 rounded"
                    >
                      Подтвердить
                    </button>
                    <button
                      onClick={() => rejectBooking(b.id)}
                      className="text-sm bg-red-600 text-white px-3 py-1 rounded"
                    >
                      Отклонить
                    </button>
                  </>
                )}
                {(b.status === "pending" || b.status === "active") && (
                  <button
                    onClick={() => cancelBooking(b.id)}
                    className="text-sm bg-gray-100 px-3 py-1 rounded hover:bg-gray-200"
                  >
                    Отменить
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
