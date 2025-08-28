// frontend/src/components/ProviderCalendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";

/** ===== helpers ===== */
const toYMD = (d) => {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// нормализация того, что вернул сервер: "YYYY-MM-DD" ИЛИ { date|day: "YYYY-MM-DD" }
const normalizeServerDatesToStrings = (arr) => {
  const out = new Set();
  (Array.isArray(arr) ? arr : []).forEach((v) => {
    const s =
      typeof v === "string"
        ? v
        : v?.date || v?.day || (typeof v === "object" ? String(v) : "");
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) out.add(`${m[1]}-${m[2]}-${m[3]}`);
  });
  return Array.from(out).sort();
};

// превращаем "YYYY-MM-DD" в локальный Date без сдвига часового пояса
const ymdListToLocalDates = (list) =>
  (list || []).map((s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  });

/** ===== component ===== */
const ProviderCalendar = ({ token }) => {
  const { t } = useTranslation();

  // то, что уже лежит в БД (строки YYYY-MM-DD)
  const [serverDates, setServerDates] = useState([]);
  // текущее выделение в UI (строки YYYY-MM-DD)
  const [selectedDates, setSelectedDates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const config = useMemo(
    () => ({ headers: { Authorization: `Bearer ${token}` } }),
    [token]
  );

  // загрузка текущих блокировок (используем /booked-dates — как у тебя в проде)
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/booked-dates`, config)
      .then(({ data }) => {
        const normalized = normalizeServerDatesToStrings(data);
        setServerDates(normalized);
        // по умолчанию выделяем то, что уже есть на сервере
        setSelectedDates(normalized);
      })
      .catch((err) => {
        console.error("Ошибка загрузки занятых дат", err);
        toast.error(t("calendar.load_error") || "Не удалось загрузить занятые даты");
      })
      .finally(() => setLoading(false));
  }, [token]);

  // преобразуем выбранные строки в Date для DayPicker
  const selectedAsDates = useMemo(
    () => ymdListToLocalDates(selectedDates),
    [selectedDates]
  );

  // переключение даты по клику
  const toggleDate = (day) => {
    const ymd = toYMD(day);
    setSelectedDates((prev) =>
      prev.includes(ymd) ? prev.filter((x) => x !== ymd) : [...prev, ymd]
    );
  };

  // сохранить: отправляем дифф { add, remove }
  const handleSave = async () => {
    setSaving(true);
    try {
      const before = new Set(serverDates);
      const after = Array.from(new Set(selectedDates)).sort();

      const add = after.filter((d) => !before.has(d));
      const remove = serverDates.filter((d) => !after.includes(d));

      await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`,
        { add, remove },
        config
      );

      setServerDates(after);
      toast.success(t("calendar.saved_successfully") || "Даты сохранены");
    } catch (e) {
      console.error("Ошибка сохранения занятых дат", e);
      toast.error(t("calendar.save_error") || "Ошибка сохранения дат");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-md mt-6">
      <DayPicker
        mode="multiple"
        selected={selectedAsDates}
        onDayClick={toggleDate}
        disabled={[{ before: new Date() }]}
        modifiersClassNames={{ selected: "bg-red-500 text-white" }}
      />

      <button
        onClick={handleSave}
        disabled={saving || loading}
        className="mt-4 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-60"
      >
        {saving
          ? t("saving") || "Сохраняю…"
          : t("calendar.save_blocked_dates") || "Сохранить занятые даты"}
      </button>

      <p className="text-sm mt-2 text-gray-600">
        🔴 {t("calendar.manual_blocked", "Ручные блокировки")}
      </p>
    </div>
  );
};

export default ProviderCalendar;
