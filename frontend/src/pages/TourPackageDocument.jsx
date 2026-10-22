import React, { useEffect, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Printer } from "lucide-react";
import { Link, useParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const cfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("token") || localStorage.getItem("providerToken")}` } });
const amount = (value, currency) => `${Number(value || 0).toLocaleString(currency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} ${currency || "UZS"}`;
const dateText = (value, language) => value ? new Date(value).toLocaleDateString(language, { day: "2-digit", month: "long", year: "numeric" }) : "—";

export default function TourPackageDocument() {
  const { id, kind } = useParams();
  const { t, i18n } = useTranslation();
  const [item, setItem] = useState(null);
  const [error, setError] = useState("");
  const language = i18n.resolvedLanguage || i18n.language || "ru";
  const isVoucher = kind === "voucher";

  useEffect(() => {
    axios.get(`${API_BASE}/api/tour-packages/${id}`, cfg()).then(({ data }) => setItem(data)).catch((requestError) => setError(requestError?.response?.data?.message || t("tb.documents.load_error")));
  }, [id, t]);

  if (error) return <main className="mx-auto max-w-3xl p-8"><div className="border border-red-200 bg-red-50 p-5 text-red-800">{error}</div></main>;
  if (!item) return <main className="p-8 text-center text-gray-500">{t("common.loading")}</main>;
  const allowed = isVoucher ? item.payment_status === "paid" : ["booked", "paid"].includes(String(item.status));
  if (!allowed) return <main className="mx-auto max-w-3xl p-8"><div className="border border-amber-200 bg-amber-50 p-5 text-amber-900">{t(isVoucher ? "tb.documents.voucher_locked" : "tb.documents.invoice_locked")}</div></main>;
  const currency = item.currency || "UZS";
  const remaining = Math.max(0, Number(item.gross_total || 0) - Number(item.paid_amount || 0));
  const itinerary = Array.isArray(item.itinerary) ? item.itinerary : [];

  return <main className="document-page min-h-screen bg-gray-100 px-4 py-8">
    <style>{`@media print { .min-h-screen > header, .document-actions { display:none!important } .min-h-screen > main, .document-page { padding:0!important;background:white!important } .document-sheet { border:0!important;box-shadow:none!important;max-width:none!important } @page { size:A4; margin:14mm } }`}</style>
    <div className="document-actions mx-auto mb-4 flex max-w-4xl justify-between gap-3"><Link to={`/dashboard/tour-packages/${id}`} className="inline-flex h-10 items-center gap-2 px-3 font-semibold text-gray-700"><ArrowLeft size={17} />{t("tb.documents.back")}</Link><button type="button" onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 bg-gray-950 px-4 font-semibold text-white"><Printer size={17} />{t("tb.documents.print_pdf")}</button></div>
    <article className="document-sheet mx-auto max-w-4xl border border-gray-200 bg-white p-8 shadow-sm sm:p-12">
      <header className="flex flex-wrap justify-between gap-8 border-b-2 border-gray-950 pb-7"><div><div className="text-3xl font-bold tracking-normal">travella</div><div className="mt-2 text-sm text-gray-500">{item.agency_name || "Travella partner"}</div></div><div className="text-right"><div className="text-xs font-bold uppercase text-orange-600">{isVoucher ? t("tb.documents.voucher") : t("tb.documents.invoice")}</div><div className="mt-2 font-mono text-xl font-bold">{item.booking_reference || `#${String(item.id).slice(0, 8)}`}</div><div className="mt-1 text-sm text-gray-500">{dateText(item.booked_at || item.updated_at, language)}</div></div></header>
      <section className="grid gap-8 border-b border-gray-200 py-7 sm:grid-cols-2"><div><div className="text-xs font-bold uppercase text-gray-400">{t("tb.documents.client")}</div><div className="mt-2 text-lg font-bold">{item.client_name || "—"}</div>{item.client_company && <div className="text-sm text-gray-600">{item.client_company}</div>}{item.client_phone && <div className="mt-2 text-sm">{item.client_phone}</div>}{item.client_email && <div className="text-sm">{item.client_email}</div>}</div><div><div className="text-xs font-bold uppercase text-gray-400">{t("tb.documents.agency")}</div><div className="mt-2 text-lg font-bold">{item.agency_name || "Travella partner"}</div>{item.agency_phone && <div className="mt-2 text-sm">{item.agency_phone}</div>}{item.agency_email && <div className="text-sm">{item.agency_email}</div>}</div></section>
      <section className="py-7"><h1 className="text-2xl font-bold">{item.title}</h1><div className="mt-4 grid gap-4 text-sm sm:grid-cols-3"><div><span className="block text-xs uppercase text-gray-400">{t("tb.documents.dates")}</span><strong>{dateText(item.start_date, language)} — {dateText(item.end_date, language)}</strong></div><div><span className="block text-xs uppercase text-gray-400">PAX</span><strong>{Number(item.pax_adult || 0) + Number(item.pax_child || 0)}</strong></div><div><span className="block text-xs uppercase text-gray-400">{t("tb.documents.status")}</span><strong>{t(`tb.package_status.${item.status}`, { defaultValue: item.status })}</strong></div></div></section>
      {!isVoucher && <section className="border-y border-gray-200 py-6"><div className="ml-auto max-w-sm space-y-3"><div className="flex justify-between"><span>{t("tb.documents.total")}</span><strong>{amount(item.gross_total, currency)}</strong></div><div className="flex justify-between text-emerald-700"><span>{t("tb.documents.received")}</span><strong>{amount(item.paid_amount, currency)}</strong></div><div className="flex justify-between border-t border-gray-950 pt-3 text-lg"><span>{t("tb.documents.balance")}</span><strong>{amount(remaining, currency)}</strong></div>{item.payment_due_at && remaining > 0 ? <div className="text-right text-sm text-gray-500">{t("tb.documents.due")}: {dateText(item.payment_due_at, language)}</div> : null}</div></section>}
      {isVoucher && <section className="border-y border-gray-200 py-6"><div className="inline-flex bg-emerald-50 px-4 py-2 font-bold text-emerald-800">{t("tb.documents.payment_confirmed")} · {amount(item.paid_amount, currency)}</div><h2 className="mt-7 text-xl font-bold">{t("tb.documents.itinerary")}</h2><div className="mt-3 divide-y border-y border-gray-200">{itinerary.map((day, index) => <div key={`${day.date}-${index}`} className="grid gap-3 py-4 sm:grid-cols-[110px_1fr]"><div className="font-bold text-orange-600">{t("tb.documents.day", { day: day.day || index + 1 })}<div className="mt-1 text-xs font-normal text-gray-500">{dateText(day.date, language)}</div></div><div><div className="font-bold">{day.city || "—"}</div><div className="mt-1 whitespace-pre-line text-sm leading-6 text-gray-700">{day.program_i18n?.[String(language).slice(0, 2)] || day.program_text || "—"}</div></div></div>)}</div></section>}
      <footer className="mt-8 flex flex-wrap justify-between gap-4 text-xs text-gray-500"><span>{t("tb.documents.generated")}</span><span>travella.uz</span></footer>
    </article>
  </main>;
}
