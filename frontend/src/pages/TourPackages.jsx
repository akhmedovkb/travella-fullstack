import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarDays, ChevronRight, CircleDollarSign, Clock3, Download, MessageCircle, Plus, Search, Users } from "lucide-react";
import { Link } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const cfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("token") || localStorage.getItem("providerToken")}` } });
const money = (value, currency) => `${Number(value || 0).toLocaleString(currency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} ${currency || "UZS"}`;
const dateText = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";
const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const pipelineStatuses = new Set(["draft", "request_sent", "partially_confirmed", "confirmed", "proposed"]);
const localDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const tripStage = (item, today = localDateKey()) => {
  if (!["booked", "paid"].includes(String(item.status))) return "preparation";
  const start = String(item.start_date || "").slice(0, 10);
  const end = String(item.end_date || item.start_date || "").slice(0, 10);
  if (start === today) return "departing_today";
  if (start && end && start < today && end >= today) return "in_trip";
  if (end && end < today) return "completed";
  return "upcoming";
};
const actualMargin = (item) => Number(item.gross_total || 0) - Number(item.actual_cost_total ?? item.net_total ?? 0);

export default function TourPackages() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [payment, setPayment] = useState("all");
  const [operations, setOperations] = useState("all");

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
    replies: items.reduce((total, item) => total + Number(item.unread_supplier_reply_count || 0), 0),
    review: items.reduce((total, item) => total + Number(item.supplier_document_review_count || 0), 0),
    departingToday: items.filter((item) => tripStage(item) === "departing_today").length,
    inTrip: items.filter((item) => tripStage(item) === "in_trip").length,
    postTour: items.filter((item) => tripStage(item) === "completed" && Number(item.supplier_reviewed_count || 0) < Number(item.component_count || 0)).length,
    unreconciled: items.filter((item) => ["booked", "paid"].includes(String(item.status)) && Number(item.component_count || 0) > Number(item.actual_cost_count || 0)).length,
    missingFinanceDates: items.filter((item) => ["booked", "paid"].includes(String(item.status)) && ((item.payment_status !== "paid" && !item.payment_due_at) || Number(item.supplier_missing_due_count || 0) > 0)).length,
    lossMaking: items.filter((item) => ["booked", "paid"].includes(String(item.status)) && actualMargin(item) < 0).length,
    attention: items.filter((item) => item.status !== "cancelled" && (Number(item.open_incident_count || 0) > 0 || Number(item.missing_confirmation_count || 0) > 0 || Number(item.missing_supplier_document_count || 0) > 0 || Number(item.supplier_document_review_count || 0) > 0 || Number(item.supplier_overdue_count || 0) > 0 || Number(item.overdue_task_count || 0) > 0 || Number(item.supplier_order_attention_count || 0) > 0 || Number(item.supplier_reply_pending_count || 0) > 0)).length,
  }), [items]);

  const finances = useMemo(() => {
    const groups = new Map();
    items.filter((item) => ["booked", "paid"].includes(String(item.status))).forEach((item) => {
      const currency = item.currency || "UZS";
      const group = groups.get(currency) || { currency, sales: 0, received: 0, receivables: 0, overdueReceivables: 0, payables: 0, overduePayables: 0, undatedClient: 0, undatedSupplier: 0, clientDue7: 0, clientDue30: 0, supplierDue7: 0, supplierDue30: 0, plannedMargin: 0, actualMargin: 0, reconciled: 0, total: 0 };
      const gross = Number(item.gross_total || 0);
      const paid = Math.min(gross, Number(item.paid_amount || 0));
      const actualCost = Number(item.actual_cost_total ?? item.net_total ?? 0);
      group.sales += gross;
      group.received += paid;
      group.receivables += Math.max(0, gross - paid);
      if (item.payment_status !== "paid" && item.payment_due_at && new Date(item.payment_due_at) < new Date()) group.overdueReceivables += Math.max(0, gross - paid);
      if (item.payment_status !== "paid" && item.payment_due_at) {
        const days = Math.ceil((new Date(item.payment_due_at).getTime() - Date.now()) / 86400000);
        if (days >= 0 && days <= 7) group.clientDue7 += Math.max(0, gross - paid);
        if (days >= 0 && days <= 30) group.clientDue30 += Math.max(0, gross - paid);
      }
      if (item.payment_status !== "paid" && !item.payment_due_at) group.undatedClient += Math.max(0, gross - paid);
      group.payables += Number(item.supplier_payable_total || 0);
      group.overduePayables += Number(item.supplier_overdue_total || 0);
      group.supplierDue7 += Number(item.supplier_due_7d_total || 0);
      group.supplierDue30 += Number(item.supplier_due_30d_total || 0);
      group.undatedSupplier += Number(item.supplier_missing_due_total || 0);
      group.plannedMargin += gross - Number(item.net_total || 0);
      group.actualMargin += gross - actualCost;
      group.total += 1;
      if (Number(item.component_count || 0) > 0 && Number(item.actual_cost_count || 0) >= Number(item.component_count || 0)) group.reconciled += 1;
      groups.set(currency, group);
    });
    return [...groups.values()];
  }, [items]);

  const exportFinances = () => {
    const columns = ["reference", "tour", "client", "start", "end", "currency", "sale", "received", "receivable", "planned_cost", "actual_cost", "actual_margin", "supplier_payable", "client_due", "supplier_due", "payment_status"];
    const rows = items.filter((item) => ["booked", "paid"].includes(String(item.status))).map((item) => {
      const gross = Number(item.gross_total || 0);
      const paid = Math.min(gross, Number(item.paid_amount || 0));
      const actualCost = Number(item.actual_cost_total ?? item.net_total ?? 0);
      return [item.booking_reference, item.title, item.client_company || item.client_name, String(item.start_date || "").slice(0, 10), String(item.end_date || "").slice(0, 10), item.currency || "UZS", gross, paid, Math.max(0, gross - paid), Number(item.net_total || 0), actualCost, gross - actualCost, Number(item.supplier_payable_total || 0), String(item.payment_due_at || "").slice(0, 10), String(item.next_supplier_due_at || "").slice(0, 10), item.payment_status || "unpaid"];
    });
    const content = `\uFEFF${[columns.map((key) => t(`tb.portfolio.export_${key}`)), ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `travella-tour-finance-${localDateKey()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status !== "all" && (status === "pipeline" ? !pipelineStatuses.has(String(item.status)) : item.status !== status)) return false;
      if (payment !== "all" && (item.payment_status || "unpaid") !== payment) return false;
      if (operations === "attention" && Number(item.open_incident_count || 0) <= 0 && Number(item.missing_confirmation_count || 0) <= 0 && Number(item.missing_supplier_document_count || 0) <= 0 && Number(item.supplier_overdue_count || 0) <= 0 && Number(item.overdue_task_count || 0) <= 0 && Number(item.supplier_order_attention_count || 0) <= 0 && Number(item.supplier_reply_pending_count || 0) <= 0) return false;
      if (operations === "incidents" && Number(item.open_incident_count || 0) <= 0) return false;
      if (operations === "departing_today" && tripStage(item) !== "departing_today") return false;
      if (operations === "in_trip" && tripStage(item) !== "in_trip") return false;
      if (operations === "post_tour" && !(tripStage(item) === "completed" && Number(item.supplier_reviewed_count || 0) < Number(item.component_count || 0))) return false;
      if (operations === "unreconciled" && !(["booked", "paid"].includes(String(item.status)) && Number(item.component_count || 0) > Number(item.actual_cost_count || 0))) return false;
      if (operations === "finance_dates_missing" && !(["booked", "paid"].includes(String(item.status)) && ((item.payment_status !== "paid" && !item.payment_due_at) || Number(item.supplier_missing_due_count || 0) > 0))) return false;
      if (operations === "loss_making" && !(["booked", "paid"].includes(String(item.status)) && actualMargin(item) < 0)) return false;
      if (operations === "supplier_replies" && Number(item.supplier_reply_pending_count || 0) <= 0) return false;
      if (operations === "unread_replies" && Number(item.unread_supplier_reply_count || 0) <= 0) return false;
      if (operations === "overdue" && Number(item.supplier_overdue_count || 0) <= 0) return false;
      if (operations === "missing" && Number(item.missing_confirmation_count || 0) <= 0) return false;
      if (operations === "documents" && Number(item.missing_supplier_document_count || 0) <= 0) return false;
      if (operations === "document_review" && Number(item.supplier_document_review_count || 0) <= 0) return false;
      if (operations === "supplier_orders" && Number(item.supplier_order_pending_count || 0) <= 0 && Number(item.supplier_order_declined_count || 0) <= 0 && Number(item.supplier_order_attention_count || 0) <= 0) return false;
      if (operations === "supplier_declined" && Number(item.supplier_order_declined_count || 0) <= 0) return false;
      if (needle && ![item.title, item.client_name, item.client_company, item.booking_reference].some((value) => String(value || "").toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [items, operations, payment, query, status]);

  if (loading) return <main className="mx-auto max-w-7xl p-6 text-gray-500">{t("common.loading")}</main>;
  return <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-gray-200 pb-6"><div><div className="text-xs font-bold uppercase text-orange-600">Tour Builder</div><h1 className="mt-1 text-3xl font-bold">{t("tb.portfolio.title")}</h1><p className="mt-2 text-gray-600">{t("tb.portfolio.subtitle")}</p></div><Link to="/tour-builder" className="inline-flex h-11 items-center gap-2 bg-orange-600 px-5 font-bold text-white hover:bg-orange-700"><Plus size={18} />{t("tb.portfolio.create")}</Link></header>
    {error && <div className="mt-5 border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
    {stats.review > 0 && <button type="button" onClick={() => setOperations("document_review")} className="mt-5 inline-flex items-center gap-2 border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800"><AlertTriangle size={16} />{t("tb.portfolio.documents_to_review", { count: stats.review })}</button>}
    {stats.missingFinanceDates > 0 && <button type="button" onClick={() => setOperations("finance_dates_missing")} className="mt-5 ml-2 inline-flex items-center gap-2 border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-800"><CalendarDays size={16} />{t("tb.portfolio.finance_dates_missing_count", { count: stats.missingFinanceDates })}</button>}
    {stats.lossMaking > 0 && <button type="button" onClick={() => setOperations("loss_making")} className="mt-5 ml-2 inline-flex items-center gap-2 bg-red-700 px-4 py-2 text-sm font-bold text-white"><AlertTriangle size={16} />{t("tb.portfolio.loss_making_count", { count: stats.lossMaking })}</button>}
    {finances.length > 0 && <section className="mt-5 border-y border-gray-200"><div className="flex flex-wrap items-center justify-between gap-4 py-4"><div><h2 className="text-lg font-bold">{t("tb.portfolio.finance_title")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.portfolio.finance_hint")}</p></div><div className="flex items-center gap-4">{stats.unreconciled > 0 && <button type="button" onClick={() => setOperations("unreconciled")} className="text-sm font-bold text-orange-700 hover:underline">{t("tb.portfolio.unreconciled_count", { count: stats.unreconciled })}</button>}<button type="button" onClick={exportFinances} className="inline-flex h-10 items-center gap-2 border border-gray-300 bg-white px-3 text-sm font-bold hover:bg-gray-50"><Download size={16} />{t("tb.portfolio.export_finance")}</button></div></div>{finances.map((group) => <div key={group.currency} className="border-t border-gray-200"><div className="grid gap-px bg-gray-200 sm:grid-cols-2 lg:grid-cols-6"><div className="bg-gray-950 px-4 py-4 text-white"><div className="text-xs font-semibold uppercase text-gray-400">{t("tb.portfolio.booked_sales")}</div><div className="mt-1 text-xl font-bold">{money(group.sales, group.currency)}</div><div className="mt-1 text-xs text-gray-400">{t("tb.portfolio.tours_count", { count: group.total })}</div></div>{[["received_total", group.received, "text-emerald-700"], ["receivables_total", group.receivables, group.receivables > 0 ? "text-red-700" : "text-emerald-700"], ["payables_total", group.payables, group.payables > group.receivables ? "text-red-700" : "text-gray-950"], ["planned_margin", group.plannedMargin, "text-gray-950"], ["actual_margin", group.actualMargin, group.actualMargin < 0 ? "text-red-700" : "text-emerald-700"]].map(([key, value, tone]) => <div key={key} className="bg-white px-4 py-4"><div className="text-xs font-semibold uppercase text-gray-400">{t(`tb.portfolio.${key}`)}</div><div className={`mt-1 text-xl font-bold ${tone}`}>{money(value, group.currency)}</div>{key === "receivables_total" && group.overdueReceivables > 0 && <div className="mt-1 text-xs font-semibold text-red-600">{t("tb.portfolio.overdue_amount", { amount: money(group.overdueReceivables, group.currency) })}</div>}{key === "payables_total" && group.overduePayables > 0 && <div className="mt-1 text-xs font-semibold text-red-600">{t("tb.portfolio.overdue_amount", { amount: money(group.overduePayables, group.currency) })}</div>}{key === "actual_margin" && <div className="mt-1 text-xs text-gray-400">{t("tb.portfolio.reconciled_count", { count: group.reconciled, total: group.total })}</div>}</div>)}</div><div className="grid border-t border-gray-200 bg-white md:grid-cols-2">{[[7, group.clientDue7, group.supplierDue7], [30, group.clientDue30, group.supplierDue30]].map(([days, incoming, outgoing]) => <div key={days} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:border-r md:last:border-r-0"><div className="text-sm font-bold">{t("tb.portfolio.cash_forecast", { days })}</div><div className="flex flex-wrap gap-x-5 gap-y-1 text-sm"><span className="text-emerald-700">{t("tb.portfolio.cash_in")}: <strong>{money(incoming, group.currency)}</strong></span><span className="text-red-700">{t("tb.portfolio.cash_out")}: <strong>{money(outgoing, group.currency)}</strong></span><span className={incoming - outgoing < 0 ? "font-bold text-red-700" : "font-bold text-gray-950"}>{t("tb.portfolio.cash_net")}: {money(incoming - outgoing, group.currency)}</span></div></div>)}</div>{(group.undatedClient > 0 || group.undatedSupplier > 0) && <button type="button" onClick={() => setOperations("finance_dates_missing")} className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 border-t border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-800"><AlertTriangle size={16} /><strong>{t("tb.portfolio.without_due_date")}</strong>{group.undatedClient > 0 && <span>{t("tb.portfolio.cash_in")}: {money(group.undatedClient, group.currency)}</span>}{group.undatedSupplier > 0 && <span>{t("tb.portfolio.cash_out")}: {money(group.undatedSupplier, group.currency)}</span>}</button>}</div>)}</section>}
    <section className="mt-5 grid gap-px bg-gray-200 border border-gray-200 sm:grid-cols-4">{[["departing_today", stats.departingToday, CalendarDays], ["in_trip", stats.inTrip, Users], ["post_tour", stats.postTour, Clock3], ["unreconciled", stats.unreconciled, CircleDollarSign]].map(([key, count, Icon]) => <button key={key} type="button" onClick={() => setOperations(key)} className={`flex items-center justify-between bg-white px-4 py-4 text-left hover:bg-gray-50 ${operations === key ? "ring-2 ring-inset ring-orange-500" : ""}`}><div><div className="text-xs font-semibold uppercase text-gray-400">{t(`tb.portfolio.${key}`)}</div><div className={`mt-1 text-2xl font-bold ${count ? "text-gray-950" : "text-gray-400"}`}>{count}</div></div><Icon size={20} className={count ? "text-orange-600" : "text-gray-300"} /></button>)}</section>
    <section className="grid border-b border-gray-200 sm:grid-cols-2 lg:grid-cols-7">
      {[[t("tb.portfolio.all"), stats.total, Users], [t("tb.portfolio.in_progress"), stats.pipeline, Clock3], [t("tb.portfolio.awaiting_client"), stats.awaiting, CalendarDays], [t("tb.portfolio.booked"), stats.booked, CalendarDays], [t("tb.portfolio.receivables"), stats.outstanding, CircleDollarSign], [t("tb.portfolio.new_supplier_replies"), stats.replies, MessageCircle], [t("tb.portfolio.attention"), stats.attention, AlertTriangle]].map(([label, value, Icon]) => <div key={label} className="border-b border-gray-200 py-5 sm:px-4 lg:border-b-0 lg:border-r first:pl-0 last:border-r-0"><Icon size={20} className={(label === t("tb.portfolio.attention") || label === t("tb.portfolio.new_supplier_replies")) && value ? "text-red-600" : "text-gray-400"} /><div className={`mt-3 text-2xl font-bold ${(label === t("tb.portfolio.attention") || label === t("tb.portfolio.new_supplier_replies")) && value ? "text-red-700" : ""}`}>{value}</div><div className="mt-1 text-xs font-semibold uppercase text-gray-400">{label}</div></div>)}
    </section>
    <section className="mt-6 flex flex-col gap-3 border-b border-gray-200 pb-5 lg:flex-row"><label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 text-gray-400" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("tb.portfolio.search")} className="h-11 w-full border border-gray-300 bg-white pl-10 pr-3 outline-none focus:border-orange-500" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 border border-gray-300 bg-white px-3"><option value="all">{t("tb.portfolio.all_statuses")}</option><option value="pipeline">{t("tb.portfolio.in_progress")}</option><option value="proposed">{t("tb.package_status.proposed")}</option><option value="booked">{t("tb.package_status.booked")}</option><option value="paid">{t("tb.package_status.paid")}</option><option value="cancelled">{t("tb.package_status.cancelled")}</option></select><select value={payment} onChange={(event) => setPayment(event.target.value)} className="h-11 border border-gray-300 bg-white px-3"><option value="all">{t("tb.portfolio.all_payments")}</option><option value="unpaid">{t("tb.workspace.payment_unpaid")}</option><option value="partial">{t("tb.workspace.payment_partial")}</option><option value="paid">{t("tb.workspace.payment_paid")}</option></select><select value={operations} onChange={(event) => setOperations(event.target.value)} className="h-11 border border-gray-300 bg-white px-3"><option value="all">{t("tb.portfolio.all_operations")}</option><option value="departing_today">{t("tb.portfolio.departing_today")}</option><option value="in_trip">{t("tb.portfolio.in_trip")}</option><option value="post_tour">{t("tb.portfolio.post_tour")}</option><option value="unreconciled">{t("tb.portfolio.unreconciled")}</option><option value="finance_dates_missing">{t("tb.portfolio.finance_dates_missing")}</option><option value="loss_making">{t("tb.portfolio.loss_making")}</option><option value="attention">{t("tb.portfolio.attention")}</option><option value="incidents">{t("tb.portfolio.open_incidents")}</option><option value="unread_replies">{t("tb.portfolio.new_supplier_replies")}</option><option value="supplier_replies">{t("tb.portfolio.requires_reply")}</option><option value="documents">{t("tb.portfolio.missing_supplier_documents")}</option><option value="supplier_orders">{t("tb.portfolio.supplier_orders")}</option><option value="supplier_declined">{t("tb.portfolio.supplier_declined")}</option><option value="overdue">{t("tb.portfolio.supplier_overdue")}</option><option value="missing">{t("tb.portfolio.missing_confirmation")}</option></select></section>
    <section className="mt-2 divide-y border-b border-gray-200">
      {filtered.map((item) => {
        const due = item.payment_due_at ? new Date(item.payment_due_at) : null;
        const overdue = item.status === "booked" && item.payment_status !== "paid" && due && due < new Date();
        const supplierAlerts = Number(item.open_incident_count || 0) + Number(item.missing_confirmation_count || 0) + Number(item.missing_supplier_document_count || 0) + Number(item.supplier_document_review_count || 0) + Number(item.supplier_overdue_count || 0) + Number(item.overdue_task_count || 0) + Number(item.supplier_order_attention_count || 0) + Number(item.supplier_reply_overdue_count || 0);
        const unreadReplies = Number(item.unread_supplier_reply_count || 0);
        const pendingReplies = Number(item.supplier_reply_pending_count || 0);
        const replyBookingId = item.latest_supplier_reply_booking_id || item.latest_supplier_reply_pending_booking_id;
        const readiness = item.operations_readiness || { percent: 0 };
        const nextAction = item.next_action;
        const stage = tripStage(item);
        const margin = actualMargin(item);
        return <Link key={item.id} to={`/dashboard/tour-packages/${item.id}${replyBookingId ? `?component=${replyBookingId}` : ""}`} className="grid gap-4 py-5 hover:bg-gray-50 sm:px-3 lg:grid-cols-[minmax(260px,1fr)_170px_150px_180px_28px] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-gray-950">{item.title}</h2><span className="bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">{t(`tb.package_status.${item.status}`, { defaultValue: item.status })}</span>{["departing_today", "in_trip", "completed"].includes(stage) && <span className={`px-2 py-0.5 text-xs font-bold ${stage === "in_trip" ? "bg-emerald-50 text-emerald-700" : stage === "departing_today" ? "bg-orange-50 text-orange-700" : "bg-gray-100 text-gray-600"}`}>{t(`tb.portfolio.stage_${stage}`)}</span>}{unreadReplies > 0 && <span className="inline-flex items-center gap-1 bg-sky-50 px-2 py-0.5 text-xs font-bold text-sky-700"><MessageCircle size={13} />{t("tb.portfolio.unread_replies", { count: unreadReplies })}</span>}{pendingReplies > 0 && <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold ${Number(item.supplier_reply_overdue_count || 0) > 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{t("tb.portfolio.requires_reply_count", { count: pendingReplies })}</span>}{supplierAlerts > 0 && <span className="inline-flex items-center gap-1 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"><AlertTriangle size={13} />{t("tb.portfolio.issues", { count: supplierAlerts })}</span>}</div><div className="mt-1 text-sm text-gray-500">{item.client_name || t("tb.workspace.client_missing")} · {dateText(item.start_date)} — {dateText(item.end_date)}</div>{Number(item.supplier_order_declined_count || 0) > 0 && <div className="mt-2 text-xs font-bold text-red-700">{t("tb.portfolio.supplier_declined_count", { count: item.supplier_order_declined_count })}</div>}{Number(item.supplier_order_pending_count || 0) > 0 && <div className="mt-1 text-xs font-semibold text-amber-700">{t("tb.portfolio.supplier_pending_count", { count: item.supplier_order_pending_count })}</div>}{nextAction && <div className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${nextAction.urgency === "overdue" ? "text-red-700" : nextAction.urgency === "today" ? "text-orange-700" : "text-gray-500"}`}><Clock3 size={13} />{t(`tb.action_timeline.${nextAction.type}`)} · {dateText(nextAction.due_at)}</div>}</div><div><div className="flex items-center justify-between gap-2 text-xs uppercase text-gray-400"><span>{t("tb.portfolio.readiness")}</span><strong className={readiness.percent === 100 ? "text-emerald-700" : "text-gray-700"}>{readiness.percent}%</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200"><div className={readiness.percent === 100 ? "h-full bg-emerald-500" : "h-full bg-orange-500"} style={{ width: `${readiness.percent}%` }} /></div>{Number(item.supplier_unpaid_count || 0) > 0 && <div className="mt-1 text-xs text-amber-700">{t("tb.portfolio.supplier_unpaid", { count: item.supplier_unpaid_count })}</div>}</div><div><div className="text-xs uppercase text-gray-400">{t("tb.portfolio.sale")}</div><div className="mt-1 font-bold">{money(item.gross_total, item.currency)}</div>{["booked", "paid"].includes(String(item.status)) && <div className={`mt-1 text-xs font-semibold ${margin < 0 ? "text-red-700" : "text-emerald-700"}`}>{t("tb.portfolio.margin_short")}: {money(margin, item.currency)}</div>}</div><div><div className="text-xs uppercase text-gray-400">{t("tb.portfolio.payment")}</div><div className={`mt-1 font-semibold ${overdue ? "text-red-700" : item.payment_status === "paid" ? "text-emerald-700" : "text-gray-700"}`}>{overdue ? t("tb.portfolio.overdue") : t(`tb.workspace.payment_${item.payment_status || "unpaid"}`)}</div>{item.booking_reference && <div className="mt-1 font-mono text-xs text-gray-500">{item.booking_reference}</div>}</div><ChevronRight size={20} className="text-gray-400" /></Link>;
      })}
      {!filtered.length && <div className="py-16 text-center text-gray-500">{t("tb.portfolio.empty")}</div>}
    </section>
  </main>;
}
