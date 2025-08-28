// frontend/src/components/ProviderCalendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";

// YYYY-MM-DD -> Date (локаль, без сдвигов)
function ymdToDate(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Date -> YYYY-MM-DD (локально)
function dateToYmd(date) {
  const dt = new Date(date);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Сервер может отдать: "2025-08-29" ИЛИ {date:"2025-08-29"} ИЛИ {day:"2025-08-29"} ИЛИ ISO "2025-08-29T00:00:00.000Z"
function normalizeServerItem(item) {
  const raw = typeof item === "string" ? item : item?.date || item?.day || "";
  if (!raw) return null;
  const str = String(raw);
  // если пришло ISO — забираем только YYYY-MM-DD
  return str.includes("T") ? str.split("T")[0] : str;
}

const ProviderCalendar = ({ token }) => {
  const { t } = useTranslation();

  // что пришло с сервера (массив строк YYYY-MM-DD)
  const [initial, setInitial] = useState([]);
  // что выделено сейчас (тоже массив строк YYYY-MM-DD)
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  const API = import.meta.env.VITE_API_BASE_URL;
  const config = useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } }), [token]);

  // Загрузка
  useEffect(() => {
    if (!token) return;
    axios
      .get(`${API}/api/providers/booked-dates`, config)
      .then(({ data }) => {
        const arr = Array.isArray(data) ? data.map(normalizeServerItem).filter(Boolean) : [];
        setInitial(arr);
        setSelected(arr);
      })
      .catch((err) => {
        console.error("Ошибка загрузки занятых дат", err);
        toast.error(t("calendar.load_error") || "Не удалось загрузить занятые даты");
      });
  }, [token]);

  // Для DayPicker нужны Date-объекты
  const selectedAsDates = useMemo(() => selected.map(ymdToDate).filter(Boolean), [selected]);

  // Тоггл даты
  const onDayClick = (day) => {
    const ymd = dateToYmd(day);
    setSelected((prev) => (prev.includes(ymd) ? prev.filter((x) => x !== ymd) : [...prev, ymd]));
  };

  // Сохранение: сначала пробуем контракт {dates:[...]} (полная замена),
  // если бэкенд ждёт дифф — шлём {add, remove}
  const handleSave = async () => {
    const final = Array.from(new Set(selected)).sort();
    setSaving(true);
    try {
      await axios.post(`${API}/api/providers/blocked-dates`, { dates: final }, config);
      setInitial(final);
      toast.success(t("calendar.saved_successfully") || "Даты сохранены");
    } catch (e1) {
      try {
        const initSet = new Set(initial);
        const finSet = new Set(final);
        const add = final.filter((d) => !initSet.has(d));
        const remove = initial.filter((d) => !finSet.has(d));
        await axios.post(`${API}/api/providers/blocked-dates`, { add, remove }, config);
        setInitial(final);
        toast.success(t("calendar.saved_successfully") || "Даты сохранены");
      } catch (e2) {
        console.error("Ошибка сохранения занятых дат", e2);
        toast.error(t("calendar.save_error") || "Ошибка сохранения дат");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded shadow border max-w-3xl mx-auto">
      <h3 className="text-lg font-semibold mb-4 text-orange-600">
        {t("calendar.blocking_title") || "Календарь занятости"}
      </h3>

      <DayPicker
        mode="multiple"
        selected={selectedAsDates}
        onDayClick={onDayClick}
        disabled={[{ before: new Date() }]}
        modifiersClassNames={{ selected: "bg-red-500 text-white" }}
      />

      <div className="mt-2 text-sm text-gray-600 flex gap-4">
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-red-500 inline-block" />
          <span>{t("calendar.label_blocked_manual") || "Заблокировано вручную"}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-blue-500 inline-block" />
          <span>{t("calendar.label_booked_by_clients") || "Занято по бронированиям"}</span>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-4 px-4 py-2 rounded bg-orange-500 text-white font-semibold disabled:opacity-60"
      >
        {saving ? (t("saving") || "Сохраняю…") : (t("calendar.save_blocked_dates") || "Сохранить занятые даты")}
      </button>
    </div>
  );
};

export default ProviderCalendar;
