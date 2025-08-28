// frontend/src/components/ProviderCalendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";

const toYMD = (d) => {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const da = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
};

const ProviderCalendar = ({ token }) => {
  const { t } = useTranslation();

  // что пришло с сервера (строки YYYY-MM-DD)
  const [initial, setInitial] = useState([]);
  // что сейчас выделено в UI (строки YYYY-MM-DD)
  const [selected, setSelected] = useState([]);

  const config = useMemo(
    () => ({ headers: { Authorization: `Bearer ${token}` } }),
    [token]
  );

  // Загрузка: бекенд отдаёт массив строк, НЕ объекты {date}
  useEffect(() => {
    if (!token) return;
    axios
      .get(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/booked-dates`,
        config
      )
      .then(({ data }) => {
        const arr = Array.isArray(data) ? data.filter(Boolean) : [];
        setInitial(arr);
        setSelected(arr);
      })
      .catch((err) => {
        console.error("Ошибка загрузки занятых дат", err);
        toast.error(t("calendar.load_error") || "Не удалось загрузить занятые даты");
      });
  }, [token]);

  const selectedAsDates = useMemo(
    () => selected.map((s) => new Date(`${s}T00:00:00`)),
    [selected]
  );

  const toggleDate = (day) => {
    const ymd = toYMD(day);
    setSelected((prev) =>
      prev.includes(ymd) ? prev.filter((x) => x !== ymd) : [...prev, ymd]
    );
  };

  const handleSave = async () => {
    const finalSet = Array.from(new Set(selected)).sort();

    // 1) пробуем Legacy-формат: полная замена
    try {
      const { data } = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`,
        { dates: finalSet },
        config
      );
      setInitial(finalSet);
      toast.success(
        data?.message || t("calendar.saved_successfully") || "Даты сохранены"
      );
      return;
    } catch (e1) {
      // 2) если сервер ждёт дифф, отправим { add, remove }
      const initialSet = new Set(initial);
      const final = new Set(finalSet);
      const add = finalSet.filter((d) => !initialSet.has(d));
      const remove = initial.filter((d) => !final.has(d));

      try {
        await axios.post(
          `${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`,
          { add, remove },
          config
        );
        setInitial(finalSet);
        toast.success(t("calendar.saved_successfully") || "Даты сохранены");
      } catch (e2) {
        console.error("Ошибка сохранения занятых дат", e2);
        toast.error(t("calendar.save_error") || "Ошибка сохранения дат");
      }
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
        className="mt-4 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
      >
        {t("calendar.save_blocked_dates") || "Сохранить занятые даты"}
      </button>
    </div>
  );
};

export default ProviderCalendar;
