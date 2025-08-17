import React, { useState } from "react";
import BookServiceModal from "./BookServiceModal";

/**
 * Универсальная кнопка «Забронировать».
 * Используем в карточках marketplace и избранного.
 *
 * props:
 *  - service: объект услуги
 *  - className?: string
 *  - children?: кастомный текст (по умолчанию "Забронировать")
 */
export default function BookingButton({ service, className = "", children }) {
  const [open, setOpen] = useState(false);
  const isBookable = (() => {
    const c = (service?.category || "").toLowerCase();
    return (
      c.includes("guide") ||
      c.includes("transport") ||
      c.includes("transfer")
    );
  })();

  if (!isBookable) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ||
          "mt-2 w-full bg-orange-500 text-white py-2 rounded font-semibold hover:opacity-90"
        }
      >
        {children || "Забронировать"}
      </button>

      <BookServiceModal
        open={open}
        onClose={() => setOpen(false)}
        service={service}
      />
    </>
  );
}
