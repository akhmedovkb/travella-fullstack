import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

function remainingMs(value) {
  const target = Date.parse(value || "");
  return Number.isFinite(target) ? Math.max(0, target - Date.now()) : null;
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function BookingHoldCountdown({ holdUntil, onExpired }) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(() => remainingMs(holdUntil));
  const expiredNotified = useRef(false);
  const onExpiredRef = useRef(onExpired);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    expiredNotified.current = false;
    const tick = () => {
      const next = remainingMs(holdUntil);
      setLeft(next);
      if (next === 0 && !expiredNotified.current) {
        expiredNotified.current = true;
        onExpiredRef.current?.();
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [holdUntil]);

  if (left === null) return null;

  return (
    <span
      className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-200"
      title={t("bookings.payment_hold_hint", {
        defaultValue: "Номер удерживается до завершения оплаты",
      })}
    >
      {left > 0
        ? t("bookings.payment_hold_left", {
            defaultValue: "На оплату: {{time}}",
            time: formatRemaining(left),
          })
        : t("bookings.payment_hold_expired", { defaultValue: "Время оплаты истекло" })}
    </span>
  );
}
