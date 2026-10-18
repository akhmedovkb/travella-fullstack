import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

const isoDates = (start, end, hotel) => {
  if (!start) return [];
  if (!hotel || !end) return [start];
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return [];
  const dates = [];
  for (const day = new Date(from); day < to; day.setDate(day.getDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
};

export default function MarketplaceBookingModal({ open, service, busy, onClose, onSubmit }) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [message, setMessage] = useState("");
  const isHotel = String(service?.providerType || service?.category || "").toLowerCase().includes("hotel");
  const dates = useMemo(() => isoDates(start, end, isHotel), [start, end, isHotel]);
  const valid = dates.length > 0 && Number(adults) > 0;

  useEffect(() => {
    if (!open) return;
    setStart("");
    setEnd("");
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

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold text-slate-700">
            {isHotel ? label("marketplace.booking.check_in", "Заезд") : label("marketplace.booking.service_date", "Дата услуги")}
            <input type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          {isHotel ? <label className="text-sm font-bold text-slate-700">
            {label("marketplace.booking.check_out", "Выезд")}
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
        <label className="mt-4 block text-sm font-bold text-slate-700">
          {label("marketplace.booking.comment", "Комментарий поставщику")}
          <textarea rows="3" value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1.5 w-full resize-none rounded-lg border border-slate-300 px-3 py-2.5" placeholder={label("marketplace.booking.comment_placeholder", "Время, маршрут или особые пожелания")} />
        </label>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="rounded-lg border px-4 py-2.5 font-bold text-slate-700" onClick={onClose} disabled={busy}>{label("actions.cancel", "Отмена")}</button>
          <button type="button" className="rounded-lg bg-orange-600 px-5 py-2.5 font-black text-white disabled:opacity-50" disabled={!valid || busy} onClick={() => onSubmit({ dates, start, end: isHotel ? end : null, adults: Number(adults), children: Number(children), message: message.trim(), isHotel })}>
            {busy ? label("common.sending", "Отправка...") : label("marketplace.booking.send", "Запросить бронирование")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
