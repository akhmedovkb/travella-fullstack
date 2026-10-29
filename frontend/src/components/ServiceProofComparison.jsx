import { useEffect, useState } from "react";

const first = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") ?? "—";

export default function ServiceProofComparison({ serviceId, images, form, details, onOpenImage, onManageProof, onClose }) {
  const [selected, setSelected] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setSelected(0); setCollapsed(false); }, [serviceId]);
  const index = Math.min(selected, Math.max(0, images.length - 1));
  const image = images[index];
  const fields = [
    ["Начало", first(details.startDate, details.departureDate, details.departureFlightDate, details.checkInDate, details.eventDate)],
    ["Окончание", first(details.endDate, details.returnFlightDate, details.returnDate, details.checkOutDate)],
    ["Отель / объект", first(details.hotel, details.hotelName, details.eventName)],
    ["Netto", first(details.netPrice, details.net_price, form.net_price)],
    ["Gross", first(details.grossPrice, details.gross_price, details.price, form.gross_price, form.price)],
  ];
  return (
    <section aria-label="Сверка proof" className="min-w-0 overflow-hidden rounded-2xl border border-violet-200 bg-violet-50 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900">Сверка proof</h2>
        <span className="whitespace-nowrap text-xs font-semibold text-violet-800" aria-live="polite">{images.length ? `${index + 1} из ${images.length}` : "Нет файлов"}</span>
        <button type="button" onClick={onClose} aria-label="Вернуться к предпросмотру карточки" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-lg text-slate-600">×</button>
      </div>
      <p className="mt-1 hidden text-xs text-slate-600 lg:block">Сверяйте документ с полями слева. Эти изображения не показываются клиентам.</p>
      {!collapsed && (image ? (
        <button type="button" onClick={() => onOpenImage(image)} aria-label={`Открыть подтверждение ${index + 1} крупно`} className="mt-2 block h-28 w-full cursor-zoom-in overflow-hidden rounded-xl border border-violet-100 bg-white lg:h-[min(42vh,420px)]">
          <img src={image} alt={`Подтверждение ${index + 1}`} className="h-full w-full object-contain" />
        </button>
      ) : (
        <div className="mt-2 rounded-xl border border-dashed border-violet-200 bg-white p-3 text-sm text-slate-600"><p>Изображения proof ещё не добавлены.</p><button type="button" onClick={onManageProof} className="mt-2 font-semibold text-violet-800 underline">Перейти к подтверждениям</button></div>
      ))}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={images.length < 2} onClick={() => setSelected((index - 1 + images.length) % images.length)} aria-label="Предыдущее подтверждение" className="h-8 w-8 rounded-lg border border-violet-200 bg-white disabled:opacity-40">←</button>
        <button type="button" disabled={images.length < 2} onClick={() => setSelected((index + 1) % images.length)} aria-label="Следующее подтверждение" className="h-8 w-8 rounded-lg border border-violet-200 bg-white disabled:opacity-40">→</button>
        <button type="button" disabled={!image} onClick={() => onOpenImage(image)} className="rounded-lg border border-violet-200 bg-white px-2 py-2 text-xs font-semibold disabled:opacity-40">Крупно</button>
        <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)} className="rounded-lg px-2 py-2 text-xs font-semibold text-violet-800">{collapsed ? "Показать" : "Свернуть"}</button>
      </div>
      {!collapsed && <dl className="mt-3 hidden grid-cols-2 gap-2 border-t border-violet-200 pt-3 lg:grid">{fields.map(([label, value]) => <div key={label} className={`min-w-0 ${label === "Отель / объект" ? "col-span-2" : ""}`}><dt className="text-[11px] font-semibold text-slate-500">{label}</dt><dd className="break-words text-xs font-semibold text-slate-900">{String(value)}{["Netto", "Gross"].includes(label) && value !== "—" ? ` ${form.currency || "USD"}` : ""}</dd></div>)}</dl>}
    </section>
  );
}
