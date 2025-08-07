import React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";

const ProviderCalendar = ({ token }) => {
  const { t } = useTranslation();
  const [blockedDatesFromServer, setBlockedDatesFromServer] = useState([]);
  const [blockedDatesLocal, setBlockedDatesLocal] = useState([]);

  const config = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  // 📦 Загружаем даты при входе
  useEffect(() => {
    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`, config)
      .then((response) => {
        const formatted = response.data.map((item) => new Date(item.date));
        setBlockedDatesFromServer(formatted);
      })
      .catch((err) => console.error("Ошибка загрузки занятых дат", err));
  }, []);

  // 🧠 Объединяем даты
  const allBlockedDates = useMemo(() => {
    const all = new Set();

    blockedDatesFromServer.forEach((d) => {
      const dateStr = new Date(d).toISOString().split("T")[0];
      all.add(dateStr);
    });

    blockedDatesLocal.forEach((d) => {
      all.add(d);
    });

    return Array.from(all).map((str) => new Date(str));
  }, [blockedDatesFromServer, blockedDatesLocal]);

  // 🎯 Клик по дате
  const handleDateClick = (date) => {
    const dateStr = date.toISOString().split("T")[0];

    const isFromServer = blockedDatesFromServer.some((d) => {
      const dStr = new Date(d).toISOString().split("T")[0];
      return dStr === dateStr;
    });

    const isLocal = blockedDatesLocal.includes(dateStr);

    if (isLocal) {
      // снятие локальной блокировки
      setBlockedDatesLocal((prev) => prev.filter((d) => d !== dateStr));
    } else if (!isFromServer) {
      // добавление локальной блокировки
      setBlockedDatesLocal((prev) => [...prev, dateStr]);
    } else {
      // снятие серверной блокировки
      setBlockedDatesFromServer((prev) =>
        prev.filter((d) => {
          const dStr = new Date(d).toISOString().split("T")[0];
          return dStr !== dateStr;
        })
      );
    }
  };

  const handleSaveBlockedDates = async () => {
    try {
      const res = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`,
        { dates: [...blockedDatesFromServer.map((d) => d.toISOString().split("T")[0]), ...blockedDatesLocal] },
        config
      );
      toast.success(t(res.data.message));
      setBlockedDatesLocal([]);
      const refreshed = await axios.get(
        `${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`,
        config
      );
      setBlockedDatesFromServer(refreshed.data.map((item) => new Date(item.date)));
    } catch (error) {
      console.error(error);
      toast.error(t("calendar.save_error"));
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow-md mt-6">
      <DayPicker
        mode="multiple"
        selected={allBlockedDates}
        onDayClick={handleDateClick}
        modifiersClassNames={{
          selected: "bg-red-500 text-white",
        }}
      />
      <button
        onClick={handleSaveBlockedDates}
        className="mt-4 px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
      >
        {t("calendar.save_button")}
      </button>
      <p className="text-sm mt-2 text-gray-600">
        🔴 {t("calendar.manual_blocked")} | 🔵 {t("calendar.booked")}
      </p>
    </div>
  );
};

export default ProviderCalendar;
