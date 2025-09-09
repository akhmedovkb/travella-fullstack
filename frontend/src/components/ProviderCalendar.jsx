// frontend/src/components/ProviderCalendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import { enUS, ru, uz } from "date-fns/locale";

/** YYYY-MM-DD из строки/объекта/Date */
const toYMD = (val) => {
  if (!val) return "";
  if (typeof val === "string") return val.slice(0, 10);
  if (val instanceof Date && !isNaN(val)) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = val?.date || val?.day || "";
  return String(s).slice(0, 10);
};

/** Локальная Date из YYYY-MM-DD */
const ymdToLocalDate = (ymd) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

// локальная «полночь сегодня» — чтобы не блочить текущий день из-за времени
const getStartOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const ProviderCalendar = ({ token }) => {
  const { t, i18n } = useTranslation();

  // ручные блокировки (YYYY-MM-DD)
  const [manual, setManual] = useState([]);
  const [manualInitial, setManualInitial] = useState([]);

  // системно занятые по бронированиям (YYYY-MM-DD)
  const [booked, setBooked] = useState([]);

  const cfg = useMemo(() => {
    const stored =
      token ||
      localStorage.getItem("providerToken") ||
      localStorage.getItem("token");
    return { headers: { Authorization: `Bearer ${stored}` } };
  }, [token]);

  // Загрузка данных календаря: сначала единый /api/providers/calendar, затем фолбэк на 2 ручки
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { data } = await axios.get(
          `${import.meta.env.VITE_API_BASE_URL}/api/providers/calendar`,
          cfg
        );

        if (cancelled) return;

        const blockedArr = (Array.isArray(data?.blocked) ? data.blocked : [])
          .map(toYMD)
          .filter(Boolean);
        const bookedArr = (Array.isArray(data?.booked) ? data.booked : [])
          .map(toYMD)
          .filter(Boolean);

        setManual(blockedArr);
        setManualInitial(blockedArr);
        setBooked(bookedArr);
      } catch {
        try {
          const [blk, bkd] = await Promise.all([
            axios
              .get(
                `${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`,
                cfg
              )
              .then((r) => r.data)
              .catch(() => []),
            axios
              .get(
                `${import.meta.env.VITE_API_BASE_URL}/api/providers/booked-dates`,
                cfg
              )
              .then((r) => r.data)
              .catch(() => []),
          ]);

          if (cancelled) return;

          const blockedArr = (Array.isArray(blk) ? blk : [])
            .map(toYMD)
            .filter(Boolean);
          const bookedArr = (Array.isArray(bkd) ? bkd : [])
            .map(toYMD)
            .filter(Boolean);

          setManual(blockedArr);
          setManualInitial(blockedArr);
          setBooked(bookedArr);
        } catch (e) {
          if (!cancelled) {
            console.error("Ошибка загрузки календаря", e);
            toast.error(
              t("calendar.load_error") || "Не удалось загрузить календарь"
            );
          }
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [cfg, t]);

  // преобразование для DayPicker
  const manualAsDates = useMemo(
    () => manual.map(ymdToLocalDate).filter(Boolean),
    [manual]
  );
  const bookedAsDates = useMemo(
    () => booked.map(ymdToLocalDate).filter(Boolean),
    [booked]
  );

  // локаль и первый день недели как в ProviderProfile
  const dpLocale = useMemo(() => {
    const lang = (i18n.language || "en").split("-")[0];
    if (lang === "ru") return ru;
    if (lang === "uz") return uz;
    return enUS;
  }, [i18n.language]);

  const weekStartsOn = useMemo(() => {
    const lang = (i18n.language || "en").split("-")[0];
    return lang === "ru" || lang === "uz" ? 1 : 0;
  }, [i18n.language]);

  const startOfToday = useMemo(() => getStartOfToday(), []);
  const pastMatcher = useMemo(() => ({ before: startOfToday }), [startOfToday]);

  // клик по дню — меняем ТОЛЬКО ручные, и только если день не системно занят
  const toggleDate = (day) => {
    const ymd = toYMD(day);
    if (booked.includes(ymd)) return; // нельзя трогать занятые системой
    setManual((prev) =>
      prev.includes(ymd) ? prev.filter((x) => x !== ymd) : [...prev, ymd]
    );
  };

  const handleSave = async () => {
    const final = Array.from(new Set(manual)).sort();

    try {
      const { data } = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`,
        { dates: final },
        cfg
      );
      setManualInitial(final);
      toast.success(
        data?.message || t("calendar.saved_successfully") || "Даты сохранены"
      );
    } catch (e) {
      console.error("Ошибка сохранения занятых дат", e);
      toast.error(t("calendar.save_error") || "Ошибка сохранения дат");
    }
  };

  // запрет на прошлые дни (с полуночи) и системно занятые
  const disabledMatchers = useMemo(
    () => [pastMatcher, ...bookedAsDates],
    [pastMatcher, bookedAsDates]
  );

  return (
    <div className="bg-white p-4 rounded-lg shadow-md mt-6">
      {/* Шапка: заголовок слева, легенда справа */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-800">
          {t("calendar.availability_calendar", {
            defaultValue: "Bandlik kalendari",
          })}
        </h3>
        <div className="flex items-center gap-4 text-sm text-gray-700">
          <span>
            <span className="inline-block w-3 h-3 bg-gray-300 rounded-sm align-middle mr-2" />
            {t("calendar.busy", { defaultValue: "band" })}
          </span>
          <span>
            <span className="inline-block w-3 h-3 bg-orange-500 rounded-sm align-middle mr-2" />
            {t("calendar.selected", { defaultValue: "tanlangan" })}
          </span>
        </div>
      </div>

      <DayPicker
        locale={dpLocale}
        weekStartsOn={weekStartsOn}
        mode="multiple"
        selected={manualAsDates}
        onDayClick={toggleDate}
        disabled={disabledMatchers}
        modifiers={{ past: pastMatcher, booked: bookedAsDates }}
        modifiersClassNames={{
          // как в ProviderProfile: выбранные — оранжевые, занятые — серые
          selected: "bg-orange-500 text-white",
          booked: "bg-gray-300 text-white cursor-not-allowed",
          past: "text-gray-400 cursor-not-allowed",
        }}
        modifiersStyles={{
          selected: { backgroundColor: "#f97316", color: "#fff" },
          booked: { backgroundColor: "#d1d5db", color: "#fff", opacity: 1 },
          past: { color: "#9ca3af", background: "transparent" },
        }}
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
