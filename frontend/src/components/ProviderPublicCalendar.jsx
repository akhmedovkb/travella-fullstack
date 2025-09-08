// src/components/ProviderPublicCalendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import BookingModal from "./BookingModal";

const toDate = (s) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

const startOfLocalToday = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()); // 00:00 локального дня
};

const fmtYMD = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

export default function ProviderPublicCalendar({ providerId, serviceId, token }) {
  const [blocked, setBlocked] = useState([]); // массив 'YYYY-MM-DD'
  const [booked, setBooked] = useState([]);   // массив 'YYYY-MM-DD'
  const [selected, setSelected] = useState([]); // массив 'YYYY-MM-DD'
  const [openModal, setOpenModal] = useState(false);

  const today = useMemo(() => startOfLocalToday(), []);

  // грузим занятые/заблокированные
  useEffect(() => {
    if (!providerId) return;
    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/${providerId}/calendar`)
      .then(({ data }) => {
        setBlocked((data?.blocked || []).map((x) => String(x).slice(0, 10)));
        setBooked((data?.booked || []).map((x) => String(x).slice(0, 10)));
      })
      .catch(() => {
        // fallback на приватный эндпоинт
        axios
          .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          .then(({ data }) => setBlocked((data || []).map((x) => String(x).slice(0, 10))))
          .catch(() => {});
      });
  }, [providerId, token]);

  const disabledDates = useMemo(() => {
    const all = [...new Set([...blocked, ...booked])];
    return all.map(toDate); // массив Date для DayPicker
  }, [blocked, booked]);

  const selectedAsDates = useMemo(() => selected.map(toDate), [selected]);

  const isPast = (day) => {
    // сравнение только по дате (без времени)
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    return d < today;
  };

  const toggle = (day) => {
    // защита от прошедших и занятых дат
    if (isPast(day)) return;
    const ymd = fmtYMD(day);
    if (blocked.includes(ymd) || booked.includes(ymd)) return;

    setSelected((prev) =>
      prev.includes(ymd) ? prev.filter((d) => d !== ymd) : [...prev, ymd]
    );
  };

  const openBooking = () => {
    if (!selected.length) return;
    setOpenModal(true);
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <DayPicker
        mode="multiple"
        selected={selectedAsDates}
        onDayClick={toggle}
        // ВАЖНО: сначала отключаем ВСЁ до сегодняшнего дня, затем - занятые/забронированные
        disabled={[{ before: today }, ...disabledDates]}
        modifiersClassNames={{
          selected: "bg-blue-600 text-white rounded-full"
        }}
      />

      <div className="flex justify-end">
        <button
          onClick={openBooking}
          disabled={!selected.length}
          className="px-4 py-2 rounded bg-orange-500 disabled:bg-orange-300 text-white"
        >
          Забронировать выбранные даты
        </button>
      </div>

      <BookingModal
        open={openModal}
        onClose={() => {
          setOpenModal(false);
          setSelected([]);
        }}
        token={token}
        providerId={providerId}
        serviceId={serviceId}
        dates={selectedAsDates}
      />

      <p className="text-sm mt-3 text-gray-600">
        Серые даты — недоступны (прошедшие, вручную заблокированные или уже забронированы).
      </p>

      {/* немного стилизации отключённых дат */}
      <style>{`
        .rdp-day_disabled {
          opacity: 0.4;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}
