import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarDays, ChevronRight, CircleDollarSign, Clock3, MessageCircle, Plus, Search, Users } from "lucide-react";
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
    attention: items.filter((item) => item.status !== "cancelled" && (Number(item.open_incident_count || 0) > 0 || Number(item.missing_confirmation_count || 0) > 0 || Number(item.missing_supplier_document_count || 0) > 0 || Number(item.supplier_document_review_count || 0) > 0 || Number(item.supplier_overdue_count || 0) > 0 || Number(item.overdue_task_count || 0) > 0 || Number(item.supplier_order_attention_count || 0) > 0 || Number(item.supplier_reply_pending_count || 0) > 0)).length,
  }), [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status !== "all" && (status === "pipeline" ? !pipelineStatuses.has(String(item.status)) : item.status !== status)) return false;
      if (payment !== "all" && (item.payment_status || "unpaid") !== payment) return false;
      if (operations === "attention" && Number(item.open_incident_count || 0) <= 0 && Number(item.missing_confirmation_count || 0) <= 0 && Number(item.missing_supplier_document_count || 0) <= 0 && Number(item.supplier_overdue_count || 0) <= 0 && Number(item.overdue_task_count || 0) <= 0 && Number(item.supplier_order_attention_count || 0) <= 0 && Number(item.supplier_reply_pending_count || 0) <= 0) return false;
      if (operations === "incidents" && Number(item.open_incident_count || 0) <= 0) return false;
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
    <section className="grid border-b border-gray-200 sm:grid-cols-2 lg:grid-cols-7">
      {[[t("tb.portfolio.all"), stats.total, Users], [t("tb.portfolio.in_progress"), stats.pipeline, Clock3], [t("tb.portfolio.awaiting_client"), stats.awaiting, CalendarDays], [t("tb.portfolio.booked"), stats.booked, CalendarDays], [t("tb.portfolio.receivables"), stats.outstanding, CircleDollarSign], [t("tb.portfolio.new_supplier_replies"), stats.replies, MessageCircle], [t("tb.portfolio.attention"), stats.attention, AlertTriangle]].map(([label, value, Icon]) => <div key={label} className="border-b border-gray-200 py-5 sm:px-4 lg:border-b-0 lg:border-r first:pl-0 last:border-r-0"><Icon size={20} className={(label === t("tb.portfolio.attention") || label === t("tb.portfolio.new_supplier_replies")) && value ? "text-red-600" : "text-gray-400"} /><div className={`mt-3 text-2xl font-bold ${(label === t("tb.portfolio.attention") || label === t("tb.portfolio.new_supplier_replies")) && value ? "text-red-700" : ""}`}>{value}</div><div className="mt-1 text-xs font-semibold uppercase text-gray-400">{label}</div></div>)}
    </section>
    <section className="mt-6 flex flex-col gap-3 border-b border-gray-200 pb-5 lg:flex-row"><label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 text-gray-400" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("tb.portfolio.search")} className="h-11 w-full border border-gray-300 bg-white pl-10 pr-3 outline-none focus:border-orange-500" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 border border-gray-300 bg-white px-3"><option value="all">{t("tb.portfolio.all_statuses")}</option><option value="pipeline">{t("tb.portfolio.in_progress")}</option><option value="proposed">{t("tb.package_status.proposed")}</option><option value="booked">{t("tb.package_status.booked")}</option><option value="paid">{t("tb.package_status.paid")}</option><option value="cancelled">{t("tb.package_status.cancelled")}</option></select><select value={payment} onChange={(event) => setPayment(event.target.value)} className="h-11 border border-gray-300 bg-white px-3"><option value="all">{t("tb.portfolio.all_payments")}</option><option value="unpaid">{t("tb.workspace.payment_unpaid")}</option><option value="partial">{t("tb.workspace.payment_partial")}</option><option value="paid">{t("tb.workspace.payment_paid")}</option></select><select value={operations} onChange={(event) => setOperations(event.target.value)} className="h-11 border border-gray-300 bg-white px-3"><option value="all">{t("tb.portfolio.all_operations")}</option><option value="attention">{t("tb.portfolio.attention")}</option><option value="incidents">{t("tb.portfolio.open_incidents")}</option><option value="unread_replies">{t("tb.portfolio.new_supplier_replies")}</option><option value="supplier_replies">{t("tb.portfolio.requires_reply")}</option><option value="documents">{t("tb.portfolio.missing_supplier_documents")}</option><option value="supplier_orders">{t("tb.portfolio.supplier_orders")}</option><option value="supplier_declined">{t("tb.portfolio.supplier_declined")}</option><option value="overdue">{t("tb.portfolio.supplier_overdue")}</option><option value="missing">{t("tb.portfolio.missing_confirmation")}</option></select></section>
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
        return <Link key={item.id} to={`/dashboard/tour-packages/${item.id}${replyBookingId ? `?component=${replyBookingId}` : ""}`} className="grid gap-4 py-5 hover:bg-gray-50 sm:px-3 lg:grid-cols-[minmax(260px,1fr)_170px_150px_180px_28px] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-gray-950">{item.title}</h2><span className="bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">{t(`tb.package_status.${item.status}`, { defaultValue: item.status })}</span>{unreadReplies > 0 && <span className="inline-flex items-center gap-1 bg-sky-50 px-2 py-0.5 text-xs font-bold text-sky-700"><MessageCircle size={13} />{t("tb.portfolio.unread_replies", { count: unreadReplies })}</span>}{pendingReplies > 0 && <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold ${Number(item.supplier_reply_overdue_count || 0) > 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{t("tb.portfolio.requires_reply_count", { count: pendingReplies })}</span>}{supplierAlerts > 0 && <span className="inline-flex items-center gap-1 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"><AlertTriangle size={13} />{t("tb.portfolio.issues", { count: supplierAlerts })}</span>}</div><div className="mt-1 text-sm text-gray-500">{item.client_name || t("tb.workspace.client_missing")} · {dateText(item.start_date)} — {dateText(item.end_date)}</div>{Number(item.supplier_order_declined_count || 0) > 0 && <div className="mt-2 text-xs font-bold text-red-700">{t("tb.portfolio.supplier_declined_count", { count: item.supplier_order_declined_count })}</div>}{Number(item.supplier_order_pending_count || 0) > 0 && <div className="mt-1 text-xs font-semibold text-amber-700">{t("tb.portfolio.supplier_pending_count", { count: item.supplier_order_pending_count })}</div>}{nextAction && <div className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${nextAction.urgency === "overdue" ? "text-red-700" : nextAction.urgency === "today" ? "text-orange-700" : "text-gray-500"}`}><Clock3 size={13} />{t(`tb.action_timeline.${nextAction.type}`)} · {dateText(nextAction.due_at)}</div>}</div><div><div className="flex items-center justify-between gap-2 text-xs uppercase text-gray-400"><span>{t("tb.portfolio.readiness")}</span><strong className={readiness.percent === 100 ? "text-emerald-700" : "text-gray-700"}>{readiness.percent}%</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200"><div className={readiness.percent === 100 ? "h-full bg-emerald-500" : "h-full bg-orange-500"} style={{ width: `${readiness.percent}%` }} /></div>{Number(item.supplier_unpaid_count || 0) > 0 && <div className="mt-1 text-xs text-amber-700">{t("tb.portfolio.supplier_unpaid", { count: item.supplier_unpaid_count })}</div>}</div><div><div className="text-xs uppercase text-gray-400">{t("tb.portfolio.sale")}</div><div className="mt-1 font-bold">{money(item.gross_total, item.currency)}</div></div><div><div className="text-xs uppercase text-gray-400">{t("tb.portfolio.payment")}</div><div className={`mt-1 font-semibold ${overdue ? "text-red-700" : item.payment_status === "paid" ? "text-emerald-700" : "text-gray-700"}`}>{overdue ? t("tb.portfolio.overdue") : t(`tb.workspace.payment_${item.payment_status || "unpaid"}`)}</div>{item.booking_reference && <div className="mt-1 font-mono text-xs text-gray-500">{item.booking_reference}</div>}</div><ChevronRight size={20} className="text-gray-400" /></Link>;
      })}
      {!filtered.length && <div className="py-16 text-center text-gray-500">{t("tb.portfolio.empty")}</div>}
    </section>
  </main>;
}
