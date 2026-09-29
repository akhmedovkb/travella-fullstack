import React from "react";

export default function HotelQuoteConfirmModal({ open, quotes = [], requestCount = 0, sending = false, onClose, onConfirm }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="hotel-quote-confirm-title">
      <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-xs font-black uppercase text-orange-600">Проверка перед отправкой</div>
          <h2 id="hotel-quote-confirm-title" className="mt-1 text-xl font-black text-slate-950">Подтвердите поставщиков и цены</h2>
          <p className="mt-1 text-sm text-slate-500">В заявки попадут зафиксированные версии котировок. Всего заявок поставщикам: {requestCount}.</p>
        </div>

        <div className="divide-y divide-slate-100">
          {quotes.length ? quotes.map((quote) => (
            <div key={`${quote.date}-${quote.quote_version}`} className="grid gap-3 px-5 py-4 md:grid-cols-[120px_1fr_auto] md:items-center">
              <div><div className="text-xs font-bold text-slate-400">Ночь</div><div className="font-black text-slate-900">{quote.date}</div></div>
              <div>
                <div className="font-black text-slate-950">{quote.hotel?.name || `Отель #${quote.hotel?.id || ""}`}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-700">{quote.offer?.provider_name || "Старый тариф отеля"}</span>
                  {quote.offer?.is_direct ? <span className="rounded-full bg-sky-50 px-2 py-1 font-bold text-sky-700 ring-1 ring-sky-200">Прямой тариф</span> : null}
                  <span className="rounded-full bg-slate-50 px-2 py-1 font-mono text-slate-500">v {quote.quote_version}</span>
                </div>
              </div>
              <div className="text-left md:text-right"><div className="text-xs font-bold text-slate-400">Итого</div><div className="text-lg font-black text-emerald-700">{Number(quote.totals?.total || 0).toLocaleString("ru-RU")} {quote.currency || "UZS"}</div></div>
            </div>
          )) : <div className="px-5 py-6 text-sm font-semibold text-slate-500">В маршруте нет рассчитанных отелей. Будут отправлены остальные выбранные услуги.</div>}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
          <button type="button" disabled={sending} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-50">Вернуться</button>
          <button type="button" disabled={sending} onClick={onConfirm} className="rounded-lg bg-orange-600 px-5 py-2 text-sm font-black text-white disabled:opacity-50">{sending ? "Отправляем…" : "Подтвердить и отправить"}</button>
        </div>
      </div>
    </div>
  );
}
