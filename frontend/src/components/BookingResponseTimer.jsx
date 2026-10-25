import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function elapsedMs(value) {
  const started = Date.parse(value || "");
  return Number.isFinite(started) ? Math.max(0, Date.now() - started) : null;
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function BookingResponseTimer({ startedAt, waitingFor = "provider" }) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(() => elapsedMs(startedAt));

  useEffect(() => {
    const tick = () => setElapsed(elapsedMs(startedAt));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  if (elapsed === null) return null;

  return (
    <span
      className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200"
      title={t("bookings.response_timer_no_limit", { defaultValue: "Автоматического срока ответа нет" })}
    >
      {t(
        waitingFor === "you"
          ? "bookings.waiting_your_response_elapsed"
          : waitingFor === "requester"
            ? "bookings.waiting_requester_elapsed"
            : "bookings.waiting_provider_elapsed",
        {
          defaultValue: waitingFor === "you"
            ? "Ожидаем ваш ответ: {{time}}"
            : waitingFor === "requester"
              ? "Ожидаем заказчика: {{time}}"
              : "Ожидаем поставщика: {{time}}",
          time: formatElapsed(elapsed),
        }
      )}
    </span>
  );
}
