import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

const isoDates = (start, end, hotel, multiDay) => {
  if (!start) return [];
  if ((!hotel && !multiDay) || !end) return [start];
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || (hotel ? to <= from : to < from)) return [];
  const dates = [];
  for (const day = new Date(from); hotel ? day < to : day <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
};

export default function MarketplaceBookingModal({ open, service, busy, onClose, onSubmit }) {
  const { t, i18n } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [dateMode, setDateMode] = useState("single");
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [message, setMessage] = useState("");
  const isHotel = String(service?.providerType || service?.category || "").toLowerCase().includes("hotel");
  const isMultiDay = isHotel || dateMode === "range";
  const dates = useMemo(() => isoDates(start, end, isHotel, isMultiDay), [start, end, isHotel, isMultiDay]);
  const maxGuests = Number(service?.maxGuests || 0);
  const guestCount = Number(adults || 0) + Number(children || 0);
  const unitPrice = Number(service?.price || 0);
  const billableDays = dates.length;
  const totalPrice = unitPrice > 0 ? unitPrice * (isHotel ? 1 : billableDays) : 0;
  const formatMoney = (value) => new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language || "ru", { maximumFractionDigits: 2 }).format(Number(value) || 0);
  const valid = dates.length > 0 && Number(adults) > 0 && (!maxGuests || guestCount <= maxGuests);

  useEffect(() => {
    if (!open) return;
    setStart("");
    setEnd("");
    setDateMode("single");
    setAdults(1);
    setChildren(0);
    setMessage("");
  }, [open, service?.serviceId]);

  if (!open) return null;
  const label = (key, fallback) => t(key, { defaultValue: fallback });

  return createPortal(
    <div className="fixed inset-0 z-[4100] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <button className="absolute inset-0 cursor-default" aria-label={label("actions.close", "Закрыть")} onClick={() => !busy && onClose()} />
      <div className="relative w-full max-w-lg rounded-t-xl bg-white p-5 shadow-2xl sm:rounded-xl sm:p-6">
        <div className="pr-10">
          <div className="text-xs font-bold uppercase text-orange-600">{label("marketplace.booking.eyebrow", "Бронирование услуги")}</div>
          <h2 className="mt-1 text-xl font-black text-slate-950">{service?.title || label("actions.book", "Забронировать")}</h2>
          <p className="mt-1 text-sm text-slate-500">{label("marketplace.booking.hint", "Поставщик подтвердит доступность. После этого у вас будет 30 минут на оплату.")}</p>
        </div>
        <button type="button" className="absolute right-4 top-4 h-9 w-9 rounded-lg border text-xl text-slate-500" onClick={onClose} disabled={busy} aria-label={label("actions.close", "Закрыть")}>×</button>

        {!isHotel && <div className="mt-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1" role="group" aria-label={label("marketplace.booking.date_mode", "Период услуги")}>
          <button type="button" onClick={() => { setDateMode("single"); setEnd(""); }} className={`rounded-md px-3 py-2 text-sm font-bold transition ${dateMode === "single" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>
            {label("marketplace.booking.one_day", "Один день")}
          </button>
          <button type="button" onClick={() => setDateMode("range")} className={`rounded-md px-3 py-2 text-sm font-bold transition ${dateMode === "range" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>
            {label("marketplace.booking.several_days", "Несколько дней")}
          </button>
        </div>}

        <div className={`${isHotel ? "mt-5" : "mt-4"} grid grid-cols-1 gap-4 sm:grid-cols-2`}>
          <label className="text-sm font-bold text-slate-700">
            {isHotel ? label("marketplace.booking.check_in", "Заезд") : isMultiDay ? label("marketplace.booking.start_date", "Дата начала") : label("marketplace.booking.service_date", "Дата услуги")}
            <input type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          {isMultiDay ? <label className="text-sm font-bold text-slate-700">
            {isHotel ? label("marketplace.booking.check_out", "Выезд") : label("marketplace.booking.end_date", "Дата окончания")}
            <input type="date" min={start || today} value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label> : null}
          <label className="text-sm font-bold text-slate-700">
            {label("marketplace.booking.adults", "Взрослые")}
            <input type="number" min="1" max="99" value={adults} onChange={(e) => setAdults(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          <label className="text-sm font-bold text-slate-700">
            {label("marketplace.booking.children", "Дети")}
            <input type="number" min="0" max="99" value={children} onChange={(e) => setChildren(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
        </div>
        {maxGuests > 0 && guestCount > maxGuests && <p className="mt-2 text-sm font-semibold text-red-600">
          {label("marketplace.booking.max_guests_error", "Максимум гостей: {{count}}").replace("{{count}}", maxGuests)}
        </p>}
        {dates.length > 0 && <div className="mt-4 flex items-end justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div>
            <div className="text-xs font-bold uppercase text-slate-500">{isHotel ? label("marketplace.booking.nights", "Ночей") : label("marketplace.booking.days", "Дней")}</div>
            <div className="mt-0.5 text-lg font-black text-slate-950">{billableDays}</div>
          </div>
          {totalPrice > 0 && <div className="text-right">
            <div className="text-xs font-bold text-slate-500">{isHotel ? label("marketplace.booking.total_price", "Итоговая цена") : `${formatMoney(unitPrice)} ${service?.currency || "UZS"} × ${billableDays}`}</div>
            <div className="mt-0.5 text-lg font-black text-slate-950">{formatMoney(totalPrice)} {service?.currency || "UZS"}</div>
          </div>}
        </div>}
        <label className="mt-4 block text-sm font-bold text-slate-700">
          {label("marketplace.booking.comment", "Комментарий поставщику")}
          <textarea rows="3" value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1.5 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5" placeholder={label("marketplace.booking.comment_placeholder", "Время, маршрут или особые пожелания")} />
        </label>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="rounded-lg border px-4 py-2.5 font-bold text-slate-700" onClick={onClose} disabled={busy}>{label("actions.cancel", "Отмена")}</button>
          <button type="button" className="rounded-lg bg-orange-600 px-5 py-2.5 font-black text-white disabled:opacity-50" disabled={!valid || busy} onClick={() => onSubmit({ dates, start, end: isMultiDay ? end : null, adults: Number(adults), children: Number(children), message: message.trim(), isHotel })}>
            {busy ? label("common.sending", "Отправка...") : label("marketplace.booking.send", "Запросить бронирование")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
