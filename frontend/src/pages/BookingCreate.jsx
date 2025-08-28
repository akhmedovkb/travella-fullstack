//frontend/src/pages/BookingCreate.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { useParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/**
 * Страница создания брони для провайдера (гид/транспорт).
 * Точечное изменение: тянем публичный календарь провайдера и
 * дизейблим и booked, и blocked дни в DayPicker.
 */
export default function BookingCreate({ providerId: providerIdProp }) {
  // берём из пропса, а если нет — из маршрута /providers/:providerId/book
  const { providerId: providerIdFromRoute } = useParams();
  const providerId = Number(providerIdProp ?? providerIdFromRoute) || null;

  // выбранный пользователем диапазон
  const [range, setRange] = useState({ from: undefined, to: undefined });

  // дни, которые нельзя выбрать (booked + blocked)
  const [disabledDates, setDisabledDates] = useState([]); // Array<Date>
  const [loadingCal, setLoadingCal] = useState(false);
  const [errorCal, setErrorCal] = useState("");

  useEffect(() => {
    if (!providerId) return;
    setLoadingCal(true);
    setErrorCal("");

    axios
      .get(`${API_BASE}/api/providers/${providerId}/calendar`)
      .then(({ data }) => {
        const blocked = Array.isArray(data?.blocked) ? data.blocked : [];
        const booked = Array.isArray(data?.booked) ? data.booked : [];
        const all = [...blocked, ...booked]
          .map((d) => (typeof d === "string" ? d.split("T")[0] : d))
          .filter(Boolean)
          .map((d) => new Date(d));
        setDisabledDates(all);
      })
      .catch((e) => {
        console.error("Calendar load error", e);
        setErrorCal("Не удалось загрузить календарь провайдера");
      })
      .finally(() => setLoadingCal(false));
  }, [providerId]);

  // Массив матчеров DayPicker: запрещаем прошлое + все занятые даты
  const disabledMatcher = useMemo(() => {
    return [{ before: new Date() }, ...disabledDates];
  }, [disabledDates]);

  const canSubmit = range?.from && range?.to;

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (!canSubmit || !providerId) return;
    try {
      // здесь ничего не менял — просто пример отправки.
      // твоя текущая логика создания брони может отличаться —
      // оставь свой эндпоинт/формат тела.
      await axios.post(`${API_BASE}/api/bookings`, {
        provider_id: providerId,
        from: range.from.toISOString().slice(0, 10),
        to: range.to.toISOString().slice(0, 10),
      });
      alert("Заявка на бронь отправлена");
      setRange({ from: undefined, to: undefined });
    } catch (err) {
      console.error("Booking create error", err);
      alert(err?.response?.data?.message || "Ошибка создания брони");
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-semibold mb-4">Бронирование</h1>

      {loadingCal && (
        <div className="mb-2 text-sm text-gray-600">Загружаем календарь…</div>
      )}
      {errorCal && (
        <div className="mb-3 text-sm text-red-600">{errorCal}</div>
      )}

      <DayPicker
        mode="range"
        selected={range}
        onSelect={setRange}
        // ключевая правка: дизейблим прошлые даты + booked + blocked с бэка
        disabled={disabledMatcher}
        // чуть приятнее UX
        numberOfMonths={2}
        pagedNavigation
        min={1}
      />

      <div className="mt-4 flex items-center gap-3">
        <button
          className="bg-orange-500 text-white px-4 py-2 rounded disabled:opacity-60"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          Забронировать
        </button>
        {range?.from && range?.to ? (
          <div className="text-sm text-gray-700">
            Выбрано: {range.from.toLocaleDateString()} —{" "}
            {range.to.toLocaleDateString()}
          </div>
        ) : (
          <div className="text-sm text-gray-500">Выберите диапазон дат</div>
        )}
      </div>

      {/* Легенда */}
      <div className="mt-6 text-sm text-gray-600">
        <div>• Серым — прошедшие даты (недоступны)</div>
        <div>• Недоступные дни — заняты бронированиями или заблокированы провайдером</div>
      </div>
    </div>
  );
}
