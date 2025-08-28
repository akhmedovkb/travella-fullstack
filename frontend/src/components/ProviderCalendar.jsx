// frontend/src/components/ProviderCalendar.jsximport React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";

/** Возвращает YYYY-MM-DD из строки/объекта/Date */
const toYMD = (val) => {
  if (!val) return "";
  if (typeof val === "string") {
    // если это ISO с T...Z — отрежем время
    return val.slice(0, 10);
  }
  if (val instanceof Date && !isNaN(val)) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  // бэкенд мог прислать {date: "..."} или {day: "..."}
  const s = val?.date || val?.day || "";
  return String(s).slice(0, 10);
};

/** Превращает YYYY-MM-DD в локальную дату (без TZ-сдвига) */
const ymdToLocalDate = (ymd) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const ProviderCalendar = ({ token }) => {
  const { t } = useTranslation();

  // то, что пришло с бэка (массив YYYY-MM-DD)
  const [initial, setInitial] = useState([]);
  // текущее выделение (массив YYYY-MM-DD)
  const [selected, setSelected] = useState([]);

  const config = useMemo(
    () => ({ headers: { Authorization: `Bearer ${token}` } }),
    [token]
  );

  // Загрузка занятых/заблокированных дат
  useEffect(() => {
    if (!token) return;
    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`, config)
      .then(({ data }) => {
        const arr = (Array.isArray(data) ? data : [])
          .map(toYMD)
          .filter(Boolean);
        setInitial(arr);
        setSelected(arr);
      })
      .catch((err) => {
        console.error("Ошибка загрузки занятых дат", err);
        toast.error(t("calendar.load_error") || "Не удалось загрузить занятые даты");
      });
  }, [token]);

  // Преобразуем строки YYYY-MM-DD в Date для DayPicker
  const selectedAsDates = useMemo(
    () => selected.map(ymdToLocalDate).filter(Boolean),
    [selected]
  );

  const toggleDate = (day) => {
    const ymd = toYMD(day);
    setSelected((prev) =>
      prev.includes(ymd) ? prev.filter((x) => x !== ymd) : [...prev, ymd]
    );
  };

  const handleSave = async () => {
    // итоговый набор без дублей
    const finalSet = Array.from(new Set(selected)).sort();

    // сначала пробуем формат { dates }
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
      // если сервер ждёт diff { add, remove } — отправим diff
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
        {t("calendar.save_blocked") || "Сохранить занятые даты"}
      </button>
      <p className="text-sm mt-2 text-gray-600">
        🔴 {t("calendar.manual_blocked") || "Заблокировано вручную"}
      </p>
    </div>
  );
};

export default ProviderCalendar;
