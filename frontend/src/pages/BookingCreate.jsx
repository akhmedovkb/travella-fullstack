//frontend/src/pages/BookingCreate.jsx

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";

function normalizeSvc(obj) {
  if (!obj) return null;
  // если пришла уже услуга
  if (obj.id && (obj.title || obj.name || obj.service)) {
    return obj.service ? { ...obj.service, ...obj } : obj;
  }
  // если пришёл контейнер { service: {...} }
  if (obj.service && (obj.service.id || obj.service.title)) return obj.service;
  return null;
}

export default function BookingCreate() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { serviceId } = useParams();

  const [loading, setLoading] = useState(true);
  const [service, setService] = useState(null);
  const [error, setError] = useState(null);

  const [note, setNote] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const clientToken = localStorage.getItem("clientToken");

  // пробуем подтянуть данные услуги (не обязательно, но приятно для UX)
  useEffect(() => {
    let mounted = true;

    async function fetchService() {
      setLoading(true);
      setError(null);
      const endpoints = [
        `/api/services/${serviceId}`,
        `/api/service/${serviceId}`,
        `/api/marketplace/${serviceId}`,
        `/api/marketplace/item/${serviceId}`,
        `/api/marketplace/by-id?id=${encodeURIComponent(serviceId)}`,
      ];

      let found = null;
      for (const url of endpoints) {
        try {
          const r = await apiGet(url);
          const svc = normalizeSvc(r);
          if (svc && (svc.id || svc.title || svc.name)) {
            found = svc; break;
          }
        } catch {
          // пробуем следующий
        }
      }
      if (mounted) {
        setService(found);
        setLoading(false);
      }
    }

    fetchService();
    return () => { mounted = false; };
  }, [serviceId]);

  const title = useMemo(() => {
    const s = service || {};
    const d = typeof s.details === "string" ? (() => { try { return JSON.parse(s.details); } catch { return {}; } })() : (s.details || {});
    return s.title || s.name || d?.title || d?.name || "";
  }, [service]);

  async function submit() {
    if (!clientToken) {
      alert(t("auth.login_required") || "Чтобы бронировать, войдите как клиент");
      nav("/login"); // если есть страница логина
      return;
    }

    try {
      setLoading(true);
      const payload = {
        service_id: Number(serviceId),
        // при желании можно прокинуть цену/валюту — они опциональны
        details: {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          note: note || undefined,
        },
      };

      const resp = await apiPost("/api/bookings", payload);
      // успешное создание
      alert(t("booking.created") || "Бронирование создано");
      // если у тебя есть страница «мои брони»
      nav("/me/bookings", { replace: true });
    } catch (e) {
      console.error(e);
      setError(t("booking.create_error") || "Не удалось создать бронирование");
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <div className="bg-white border rounded-xl shadow p-6">
        <h1 className="text-xl font-bold mb-3">
          {t("booking.new") || "Новое бронирование"}
        </h1>

        {!clientToken && (
          <div className="mb-4 p-3 rounded bg-yellow-50 border border-yellow-200 text-yellow-800">
            {t("auth.login_required") || "Чтобы бронировать, войдите как клиент"}
          </div>
        )}

        {loading && <div>{t("common.loading") || "Загрузка…"}</div>}
        {!loading && error && (
          <div className="text-red-600 mb-3">{error}</div>
        )}

        {!loading && (
          <>
            <div className="mb-4">
              <div className="text-sm text-gray-500 mb-1">
                {t("booking.service") || "Услуга"}
              </div>
              <div className="font-medium">
                {title || `#${serviceId}`}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  {t("booking.date_from") || "Дата начала (необязательно)"}
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  {t("booking.date_to") || "Дата конца (необязательно)"}
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-sm text-gray-600 mb-1">
                {t("booking.note") || "Комментарий к брони (необязательно)"}
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                className="w-full border rounded-lg px-3 py-2"
                placeholder={t("booking.note_ph") || "Пожелания, детали встречи и т.п."}
              />
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={submit}
                disabled={loading}
                className="px-5 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-60"
              >
                {t("actions.book") || "Забронировать"}
              </button>
              <button
                onClick={() => nav(-1)}
                className="px-5 py-2 rounded-lg border font-semibold"
              >
                {t("actions.cancel") || "Отмена"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
