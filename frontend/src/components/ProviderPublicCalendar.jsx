import React, { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import axios from "axios";
import BookingModal from "./BookingModal";

const toDate = (s) => {
  const [y,m,d] = s.slice(0,10).split("-").map(Number);
  return new Date(y, m-1, d);
};

export default function ProviderPublicCalendar({ providerId, serviceId, token }) {
  const [blocked, setBlocked] = useState([]); // ["YYYY-MM-DD"]
  const [booked, setBooked]   = useState([]); // ["YYYY-MM-DD"]
  const [selected, setSelected] = useState([]);
  const [openModal, setOpenModal] = useState(false);

  // грузим занятые/заблокированные (публичный эндпоинт уже есть)
  useEffect(() => {
    if (!providerId) return;
    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/${providerId}/calendar`)
      .then(({ data }) => {
        setBlocked((data?.blocked || []).map((x) => String(x).slice(0,10)));
        setBooked((data?.booked  || []).map((x) => String(x).slice(0,10)));
      })
      .catch(() => {
        // резервный вариант: используя приватный /blocked-dates
        axios
          .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          .then(({ data }) => setBlocked((data || []).map((x) => String(x).slice(0,10))))
          .catch(() => {});
      });
  }, [providerId, token]);

  const disabledDates = useMemo(() => {
    const all = [...new Set([...blocked, ...booked])];
    return all.map(toDate);
  }, [blocked, booked]);

  const selectedAsDates = useMemo(() => selected.map(toDate), [selected]);

  const toggle = (day) => {
    const ymd = day.toISOString().slice(0,10);
    const disabled = blocked.includes(ymd) || booked.includes(ymd);
    if (disabled) return; // недоступно
    setSelected((prev) => (prev.includes(ymd) ? prev.filter((d) => d !== ymd) : [...prev, ymd]));
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
        disabled={disabledDates}
        modifiersClassNames={{ selected: "bg-blue-600 text-white rounded-full" }}
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
        onClose={() => { setOpenModal(false); setSelected([]); }}
        token={token}
        providerId={providerId}
        serviceId={serviceId}
        dates={selectedAsDates}
      />

      <p className="text-sm mt-3 text-gray-600">
        Серые даты — недоступны (ручные блокировки или уже забронированы).
      </p>
    </div>
  );
}
