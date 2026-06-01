// frontend/src/components/BookServiceModal.jsx
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiPost } from "../api";

function normalizeService(svcLike) {
  if (!svcLike) return null;
  if (svcLike.service && (svcLike.service.id || svcLike.service.title)) return svcLike.service;
  return svcLike;
}

function dateRangeToDates(dateFrom, dateTo) {
  const from = String(dateFrom || "").trim();
  const to = String(dateTo || "").trim();
  if (!from) return [];

  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${(to || from)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  const a = start <= end ? start : end;
  const b = start <= end ? end : start;
  const out = [];
  const cur = new Date(a);

  while (cur <= b && out.length < 370) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }

  return out;
}

export default function BookServiceModal({ open, onClose, service }) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const svc = useMemo(() => normalizeService(service), [service]);
  const serviceId = svc?.id ?? service?.id;

  useEffect(() => {
    if (!open) {
      // сбрасываем форму при закрытии
      setErr("");
      setNote("");
      setDateFrom("");
      setDateTo("");
    }
  }, [open]);

  const title = useMemo(() => {
    const d =
      typeof svc?.details === "string"
        ? (() => {
            try { return JSON.parse(svc.details); } catch { return {}; }
          })()
        : (svc?.details || {});
    return svc?.title || svc?.name || d?.title || d?.name || t("booking.new") || "Бронирование";
  }, [svc, t]);

  async function submit() {
    try {
      setErr("");
      setSubmitting(true);

      const clientToken = localStorage.getItem("clientToken");
      if (!clientToken) {
        alert(t("auth.login_required") || "Чтобы бронировать, войдите как клиент");
        // перенаправление на клиентский логин, если есть
        window.location.href = "/client/login";
        return;
      }

      const dates = dateRangeToDates(dateFrom, dateTo);
      if (!dates.length) {
        setErr(t("booking.date_required") || "Выберите дату бронирования");
        return;
      }

      const payload = {
        service_id: Number(serviceId),
        dates,
        details: {
          date_from: dates[0],
          date_to: dates[dates.length - 1],
          note: note || undefined,
        },
      };

      await apiPost("/api/bookings", payload, "client");
      alert(t("booking.created") || "Бронирование создано");
      onClose?.();
      // если есть страница «мои брони» клиента — откроем её
      try { window.location.href = "/client/dashboard"; } catch {}
    } catch (e) {
      console.error(e);
      setErr(e?.message || t("booking.create_error") || "Не удалось создать бронирование");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/40">
      <div className="w-[92%] max-w-lg bg-white rounded-xl shadow-xl border p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            onClick={() => onClose?.()}
            className="text-gray-500 hover:text-gray-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
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
            {t("booking.note") || "Комментарий (необязательно)"}
          </label>
          <textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border rounded-lg px-3 py-2"
            placeholder={t("booking.note_ph") || "Пожелания, детали встречи и т.п."}
          />
        </div>

        {!!err && <div className="mt-3 text-red-600 text-sm">{err}</div>}

        <div className="mt-5 flex gap-3">
          <button
            disabled={submitting}
            onClick={submit}
            className="px-5 py-2 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-60"
          >
            {t("actions.book") || "Забронировать"}
          </button>
          <button
            onClick={() => onClose?.()}
            className="px-5 py-2 rounded-lg border font-semibold"
          >
            {t("actions.cancel") || "Отмена"}
          </button>
        </div>
      </div>
    </div>
  );
}
