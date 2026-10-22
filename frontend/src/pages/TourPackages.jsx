import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronRight, CircleDollarSign, Clock3, Plus, Search, Users } from "lucide-react";
import { Link } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const cfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("token") || localStorage.getItem("providerToken")}` } });
const money = (value, currency) => `${Number(value || 0).toLocaleString(currency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} ${currency || "UZS"}`;
const dateText = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";
const pipelineStatuses = new Set(["draft", "request_sent", "partially_confirmed", "confirmed", "proposed"]);

export default function TourPackages() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [payment, setPayment] = useState("all");

  useEffect(() => {
    axios.get(`${API_BASE}/api/tour-packages`, cfg())
      .then(({ data }) => setItems(Array.isArray(data) ? data : []))
      .catch((requestError) => setError(requestError?.response?.data?.message || t("tb.portfolio.load_error")))
      .finally(() => setLoading(false));
  }, [t]);

  const stats = useMemo(() => ({
    total: items.length,
    pipeline: items.filter((item) => pipelineStatuses.has(String(item.status))).length,
    awaiting: items.filter((item) => item.status === "proposed" && !item.proposal_response).length,
    booked: items.filter((item) => ["booked", "paid"].includes(String(item.status))).length,
    outstanding: items.filter((item) => item.status === "booked" && item.payment_status !== "paid").length,
  }), [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status !== "all" && (status === "pipeline" ? !pipelineStatuses.has(String(item.status)) : item.status !== status)) return false;
      if (payment !== "all" && (item.payment_status || "unpaid") !== payment) return false;
      if (needle && ![item.title, item.client_name, item.client_company, item.booking_reference].some((value) => String(value || "").toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [items, payment, query, status]);

  if (loading) return <main className="mx-auto max-w-7xl p-6 text-gray-500">{t("common.loading")}</main>;
  return <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-gray-200 pb-6"><div><div className="text-xs font-bold uppercase text-orange-600">Tour Builder</div><h1 className="mt-1 text-3xl font-bold">{t("tb.portfolio.title")}</h1><p className="mt-2 text-gray-600">{t("tb.portfolio.subtitle")}</p></div><Link to="/tour-builder" className="inline-flex h-11 items-center gap-2 bg-orange-600 px-5 font-bold text-white hover:bg-orange-700"><Plus size={18} />{t("tb.portfolio.create")}</Link></header>
    {error && <div className="mt-5 border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
    <section className="grid border-b border-gray-200 sm:grid-cols-2 lg:grid-cols-5">
      {[[t("tb.portfolio.all"), stats.total, Users], [t("tb.portfolio.in_progress"), stats.pipeline, Clock3], [t("tb.portfolio.awaiting_client"), stats.awaiting, CalendarDays], [t("tb.portfolio.booked"), stats.booked, CalendarDays], [t("tb.portfolio.receivables"), stats.outstanding, CircleDollarSign]].map(([label, value, Icon]) => <div key={label} className="border-b border-gray-200 py-5 sm:px-4 lg:border-b-0 lg:border-r first:pl-0 last:border-r-0"><Icon size={20} className="text-gray-400" /><div className="mt-3 text-2xl font-bold">{value}</div><div className="mt-1 text-xs font-semibold uppercase text-gray-400">{label}</div></div>)}
    </section>
    <section className="mt-6 flex flex-col gap-3 border-b border-gray-200 pb-5 lg:flex-row"><label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 text-gray-400" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("tb.portfolio.search")} className="h-11 w-full border border-gray-300 bg-white pl-10 pr-3 outline-none focus:border-orange-500" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 border border-gray-300 bg-white px-3"><option value="all">{t("tb.portfolio.all_statuses")}</option><option value="pipeline">{t("tb.portfolio.in_progress")}</option><option value="proposed">{t("tb.package_status.proposed")}</option><option value="booked">{t("tb.package_status.booked")}</option><option value="paid">{t("tb.package_status.paid")}</option><option value="cancelled">{t("tb.package_status.cancelled")}</option></select><select value={payment} onChange={(event) => setPayment(event.target.value)} className="h-11 border border-gray-300 bg-white px-3"><option value="all">{t("tb.portfolio.all_payments")}</option><option value="unpaid">{t("tb.workspace.payment_unpaid")}</option><option value="partial">{t("tb.workspace.payment_partial")}</option><option value="paid">{t("tb.workspace.payment_paid")}</option></select></section>
    <section className="mt-2 divide-y border-b border-gray-200">
      {filtered.map((item) => {
        const due = item.payment_due_at ? new Date(item.payment_due_at) : null;
        const overdue = item.status === "booked" && item.payment_status !== "paid" && due && due < new Date();
        return <Link key={item.id} to={`/dashboard/tour-packages/${item.id}`} className="grid gap-4 py-5 hover:bg-gray-50 sm:px-3 lg:grid-cols-[minmax(260px,1fr)_170px_150px_180px_28px] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-gray-950">{item.title}</h2><span className="bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">{t(`tb.package_status.${item.status}`, { defaultValue: item.status })}</span></div><div className="mt-1 text-sm text-gray-500">{item.client_name || t("tb.workspace.client_missing")} · {dateText(item.start_date)} — {dateText(item.end_date)}</div></div><div><div className="text-xs uppercase text-gray-400">{t("tb.portfolio.suppliers")}</div><div className="mt-1 font-semibold">{item.confirmed_count || 0}/{item.component_count || 0}</div></div><div><div className="text-xs uppercase text-gray-400">{t("tb.portfolio.sale")}</div><div className="mt-1 font-bold">{money(item.gross_total, item.currency)}</div></div><div><div className="text-xs uppercase text-gray-400">{t("tb.portfolio.payment")}</div><div className={`mt-1 font-semibold ${overdue ? "text-red-700" : item.payment_status === "paid" ? "text-emerald-700" : "text-gray-700"}`}>{overdue ? t("tb.portfolio.overdue") : t(`tb.workspace.payment_${item.payment_status || "unpaid"}`)}</div>{item.booking_reference && <div className="mt-1 font-mono text-xs text-gray-500">{item.booking_reference}</div>}</div><ChevronRight size={20} className="text-gray-400" /></Link>;
      })}
      {!filtered.length && <div className="py-16 text-center text-gray-500">{t("tb.portfolio.empty")}</div>}
    </section>
  </main>;
}
