import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TourBuilderModal } from "./TourBuilderModal";

export default function HotelQuoteConfirmModal({ open, quotes = [], requestCount = 0, tourEndDate = "", sending = false, onClose, onConfirm }) {
  const { t, i18n } = useTranslation();
  const [extendedStayConfirmed, setExtendedStayConfirmed] = useState(false);
  const extendedQuotes = useMemo(
    () => quotes.filter((quote) => tourEndDate && String(quote.date || "") >= String(tourEndDate)),
    [quotes, tourEndDate]
  );

  useEffect(() => {
    if (open) setExtendedStayConfirmed(false);
  }, [open]);

  if (!open) return null;

  const locale = i18n.language === "uz" ? "uz-UZ" : i18n.language === "en" ? "en-GB" : "ru-RU";

  return (
    <TourBuilderModal open title={t("tb.hotel_confirm.title")} eyebrow={t("tb.hotel_confirm.eyebrow")} description={t("tb.hotel_confirm.subtitle", { count: requestCount })} onClose={sending ? undefined : onClose} maxWidth="max-w-3xl" footer={<><button type="button" disabled={sending} onClick={onClose} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t("tb.hotel_confirm.back")}</button><button type="button" disabled={sending || (extendedQuotes.length > 0 && !extendedStayConfirmed)} onClick={onConfirm} className="rounded-md bg-[#FF5722] px-5 py-2 text-sm font-bold text-white hover:bg-[#e84d1d] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500">{sending ? t("tb.hotel_confirm.sending") : t("tb.hotel_confirm.confirm")}</button></>}>
        <div className="divide-y divide-slate-100">
          {quotes.length ? quotes.map((quote) => (
            <div key={`${quote.date}-${quote.quote_version}`} className="grid gap-3 px-5 py-4 md:grid-cols-[120px_1fr_auto] md:items-center">
              <div><div className="text-xs font-bold text-slate-400">{t("tb.hotel_confirm.night")}</div><div className="font-bold text-slate-900">{quote.date}</div></div>
              <div>
                <div className="font-bold text-slate-950">{quote.hotel?.name || t("tb.hotel_confirm.hotel_number", { id: quote.hotel?.id || "" })}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-700">{quote.offer?.provider_name || t("tb.hotel_confirm.legacy_rate")}</span>
                  {quote.offer?.is_direct ? <span className="rounded-full bg-sky-50 px-2 py-1 font-bold text-sky-700 ring-1 ring-sky-200">{t("tb.ui.direct_hotel")}</span> : null}
                  <span className="rounded-full bg-slate-50 px-2 py-1 font-mono text-slate-500">v {quote.quote_version}</span>
                </div>
              </div>
              <div className="text-left md:text-right"><div className="text-xs font-bold text-slate-400">{t("tb.ui.total")}</div><div className="text-lg font-bold text-emerald-700">{Number(quote.totals?.total || 0).toLocaleString(locale)} {quote.currency || "UZS"}</div></div>
            </div>
          )) : <div className="px-5 py-6 text-sm font-semibold text-slate-500">{t("tb.hotel_confirm.no_quotes")}</div>}
        </div>

        {extendedQuotes.length > 0 ? (
          <label className="mx-5 mb-4 flex cursor-pointer gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <input type="checkbox" checked={extendedStayConfirmed} onChange={(event) => setExtendedStayConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-orange-600" />
            <span><strong className="block">{t("tb.hotel_confirm.extended_title")}</strong><span className="mt-1 block text-amber-800">{t("tb.hotel_confirm.extended_hint", { count: extendedQuotes.length, date: tourEndDate })}</span></span>
          </label>
        ) : null}

    </TourBuilderModal>
  );
}
