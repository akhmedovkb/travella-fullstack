import React, { useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import { toast } from "react-toastify";

/**
 * Модалка бронирования услуги (гид/транспорт).
 * props:
 *  - open: boolean
 *  - onClose: () => void
 *  - service: { id, title, category, provider_id? } | null
 *
 * details:
 *  - если выбран диапазон -> { startDate, endDate }
 *  - если выбран один день -> { dates: ["YYYY-MM-DD"] }
 */
export default function BookServiceModal({ open, onClose, service }) {
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const token = localStorage.getItem("token");

  const [mode, setMode] = useState("range"); // 'range' | 'single'
  const [selected, setSelected] = useState(undefined); // DayPicker value
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const title = service?.title || "";
  const isGuideOrTransport = useMemo(() => {
    const c = (service?.category || "").toLowerCase();
    return (
      c.includes("guide") ||
      c.includes("transport") ||
      c.includes("transfer")
    );
  }, [service]);

  if (!open) return null;

  const toIso = (d) => {
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const buildDetails = () => {
    if (mode === "single") {
      const day = selected;
      const iso = day instanceof Date ? toIso(day) : null;
      const base = iso ? { dates: [iso] } : {};
      return note ? { ...base, note } : base;
    }
    // range
    const r = selected || {};
    const from = r?.from instanceof Date ? toIso(r.from) : null;
    const to = r?.to instanceof Date ? toIso(r.to) : from;
    const base =
      from && to ? { startDate: from, endDate: to } : from ? { dates: [from] } : {};
    return note ? { ...base, note } : base;
  };

  const canSubmit = useMemo(() => {
    if (mode === "single") return selected instanceof Date;
    if (!selected) return false;
    return selected?.from instanceof Date;
  }, [mode, selected]);

  const onSubmit = async () => {
    if (!service?.id) return;
    if (!canSubmit) {
      toast.warn("Выберите дату(ы)");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        service_id: service.id,
        details: buildDetails(),
      };
      const res = await axios.post(`${API_BASE}/api/bookings`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success("Заявка на бронирование отправлена");
      onClose?.();
      setSelected(undefined);
      setNote("");
      return res.data;
    } catch (e) {
      const status = e?.response?.status;
      if (status === 409 && Array.isArray(e?.response?.data?.conflicts)) {
        const conflicts = e.response.data.conflicts
          .map((x) => `${x.date} • ${x.reason === "booked" ? "занято" : "заблокировано"}`)
          .join("\n");
        toast.error(`Выбранные даты недоступны:\n${conflicts}`);
      } else {
        toast.error(e?.response?.data?.message || "Ошибка бронирования");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-xl font-semibold">Бронирование</h3>
            <div className="text-sm text-gray-600">{title}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1 bg-gray-100 hover:bg-gray-200 text-sm"
          >
            ✕
          </button>
        </div>

        {/* Режим выбора дат */}
        <div className="flex items-center gap-3 mb-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="book_mode"
              checked={mode === "range"}
              onChange={() => setMode("range")}
            />
            Диапазон дат
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="book_mode"
              checked={mode === "single"}
              onChange={() => setMode("single")}
            />
            Один день
          </label>
        </div>

        {/* Календарь */}
        <DayPicker
          mode={mode === "single" ? "single" : "range"}
          selected={selected}
          onSelect={setSelected}
          disabled={{ before: new Date() }}
          className="border rounded-md p-3 mb-3"
        />

        {/* Примечание */}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={isGuideOrTransport ? "Пожелания по маршруту/часам" : "Комментарий"}
          className="w-full border rounded-md px-3 py-2 mb-3"
        />

        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200"
          >
            Отмена
          </button>
          <button
            onClick={onSubmit}
            disabled={!canSubmit || submitting}
            className="px-4 py-2 rounded-md bg-orange-500 text-white font-semibold disabled:opacity-60"
          >
            {submitting ? "Отправка..." : "Забронировать"}
          </button>
        </div>
      </div>
    </div>
  );
}
