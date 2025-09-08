import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { startOfToday } from "date-fns";
import { ru, uz, enUS } from "date-fns/locale";
import BookingModal from "./BookingModal";

const toDate = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

const pickLocale = (lang) => {
  switch ((lang || "ru").toLowerCase()) {
    case "uz":
    case "uzb":
      return uz;
    case "en":
    case "en-us":
      return enUS;
    default:
      return ru;
  }
};

export default function ProviderPublicCalendar({
  providerId,
  serviceId,
  token,
  lang = "ru",
}) {
  const [blocked, setBlocked] = useState([]); // ["YYYY-MM-DD"]
  const [booked, setBooked] = useState([]); // ["YYYY-MM-DD"]
  const [selected, setSelected] = useState([]); // ["YYYY-MM-DD"]
  const [openModal, setOpenModal] = useState(false);

  // загрузка занятых/заблокированных дат
  useEffect(() => {
    if (!providerId) return;

    axios
      .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/${providerId}/calendar`)
      .then(({ data }) => {
        setBlocked((data?.blocked || []).map((x) => String(x).slice(0, 10)));
        setBooked((data?.booked || []).map((x) => String(x).slice(0, 10)));
      })
      .catch(() => {
        // fallback на приватный эндпоинт (если есть токен)
        if (!token) return;
        axios
          .get(`${import.meta.env.VITE_API_BASE_URL}/api/providers/blocked-dates`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          .then(({ data }) =>
            setBlocked((data || []).map((x) => String(x).slice(0, 10)))
          )
          .catch(() => {});
      });
  }, [providerId, token]);

  const today = startOfToday();

  const disabledMatchers = useMemo(() => {
    const merged = [...new Set([...blocked, ...booked])].map(toDate);
    // прошлое + занятые/заблокированные
    return [{ before: today }, ...merged];
  }, [blocked, booked, today]);

  const selectedAsDates = useMemo(() => selected.map(toDate), [selected]);

  const toggle = (day) => {
    // блокируем прошлое и занятые
    if (day < today) return;
    const key = ymd(day);
    if (blocked.includes(key) || booked.includes(key)) return;

    setSelected((prev) =>
      prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]
    );
  };

  const openBooking = () => {
    if (!selected.length) return;
    setOpenModal(true);
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-semibold">Календарь занятости</h3>
        <div className="text-sm text-gray-500 space-x-4">
          <span>
            <span className="inline-block w-3 h-3 align-middle rounded-sm bg-gray-300 mr-1" />
            занято
          </span>
          <span>
            <span className="inline-block w-3 h-3 align-middle rounded-sm bg-orange-400 mr-1" />
            выбрано
          </span>
        </div>
      </div>

      <DayPicker
        mode="multiple"
        locale={pickLocale(lang)}
        selected={selectedAsDates}
        onDayClick={toggle}
        disabled={disabledMatchers}
        fromDate={today} // не позволяем листать в прошлые месяцы
        modifiersClassNames={{
          selected: "bg-orange-500 text-white rounded-full",
        }}
      />

      <div className="flex justify-between items-center mt-2 text-sm text-gray-600">
        <div>Выбрано дат: {selected.length || 0}</div>
        <button
          onClick={openBooking}
          disabled={!selected.length}
          className="px-4 py-2 rounded bg-orange-500 disabled:bg-orange-300 text-white"
        >
          Бронировать
        </button>
      </div>

      <BookingModal
        open={openModal}
        onClose={(ok) => {
          setOpenModal(false);
          if (ok) setSelected([]); // очистим после успешной отправки
        }}
        token={token}
        providerId={providerId}
        serviceId={serviceId}
        // передаём даты как Date[], но модалка сама преобразует в YYYY-MM-DD
        dates={selectedAsDates}
      />

      <p className="text-sm mt-3 text-gray-600">
        Серые даты — занято или прошло. Выберите доступные даты и оформите бронь.
      </p>
    </div>
  );
}
