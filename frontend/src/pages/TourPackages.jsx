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
const pipelineStatuses = new Set(["draft", "request_sent", "partially_confirmed", "confirmed", "proposed", "accepted"]);
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
const actualMarginRate = (item) => {
  const gross = Number(item.gross_total || 0);
  return gross > 0 ? actualMargin(item) / gross : Number.NEGATIVE_INFINITY;
};
const isAwaitingProposal = (item) => item.status === "proposed" && !item.proposal_response;
const isRefundPending = (item) => item.status === "cancelled" && ["pending", "partial"].includes(String(item.refund_status || ""));
const isProposalExpired = (item) => isAwaitingProposal(item) && item.quote_valid_until && new Date(item.quote_valid_until).getTime() < Date.now();
const isProposalFollowupDue = (item) => {
  const lastContact = item.last_client_followup_at || item.shared_at;
  return isAwaitingProposal(item) && !isProposalExpired(item) && lastContact && new Date(lastContact).getTime() < Date.now() - 48 * 60 * 60 * 1000;
};
const hasOperationalRisk = (item) => item.status !== "lost" && (isRefundPending(item) || (item.status !== "cancelled" && (isProposalExpired(item) || isProposalFollowupDue(item) || Number(item.open_incident_count || 0) > 0 || Number(item.missing_confirmation_count || 0) > 0 || Number(item.missing_supplier_document_count || 0) > 0 || Number(item.supplier_document_review_count || 0) > 0 || Number(item.supplier_overdue_count || 0) > 0 || Number(item.overdue_task_count || 0) > 0 || Number(item.supplier_order_attention_count || 0) > 0 || Number(item.supplier_reply_pending_count || 0) > 0)));
const operationalPriority = (item) => (
  (isProposalExpired(item) ? 90 : 0)
  + (isRefundPending(item) ? 70 : 0)
  + (isProposalFollowupDue(item) ? 25 : 0)
  + Number(item.open_incident_count || 0) * 100
  + Number(item.supplier_order_declined_count || 0) * 80
  + Number(item.supplier_overdue_count || 0) * 60
  + Number(item.overdue_task_count || 0) * 50
  + Number(item.supplier_order_attention_count || 0) * 40
  + Number(item.missing_confirmation_count || 0) * 30
  + Number(item.missing_supplier_document_count || 0) * 20
  + Number(item.supplier_document_review_count || 0) * 15
  + Number(item.unread_supplier_reply_count || 0) * 10
  + Number(item.supplier_reply_pending_count || 0) * 5
);
const timeValue = (value, fallback) => {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default function TourPackages() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [payment, setPayment] = useState("all");
  const [manager, setManager] = useState("all");
  const [operations, setOperations] = useState("all");
  const [sortBy, setSortBy] = useState("attention");
  const [financeFrom, setFinanceFrom] = useState("");
  const [financeTo, setFinanceTo] = useState("");

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
    refundPending: items.filter(isRefundPending).length,
    proposalExpired: items.filter(isProposalExpired).length,
    proposalFollowup: items.filter(isProposalFollowupDue).length,
    proposalAccepted: items.filter((item) => item.proposal_response === "accepted").length,
    proposalChanges: items.filter((item) => item.proposal_response === "changes_requested").length,
    proposalDeclined: items.filter((item) => item.proposal_response === "declined").length,
    attention: items.filter(hasOperationalRisk).length,
  }), [items]);
  const proposalResponses = stats.proposalAccepted + stats.proposalChanges + stats.proposalDeclined;
  const respondedTours = items.filter((item) => Number(item.proposal_response_count || 0) > 0);
  const wonTours = respondedTours.filter((item) => Number(item.accepted_revision || 0) > 0);
  const proposalConversion = respondedTours.length > 0 ? Math.round(wonTours.length / respondedTours.length * 100) : 0;
  const totalProposalResponses = respondedTours.reduce((total, item) => total + Number(item.proposal_response_count || 0), 0);
  const averageResponseHours = totalProposalResponses > 0
    ? respondedTours.reduce((total, item) => total + Number(item.proposal_avg_response_seconds || 0) * Number(item.proposal_response_count || 0), 0) / totalProposalResponses / 3600
    : 0;
  const averageAcceptedRevisions = wonTours.length > 0
    ? wonTours.reduce((total, item) => total + Number(item.accepted_revision || 0), 0) / wonTours.length
    : 0;
  const declineReasons = useMemo(() => {
    const totals = new Map();
    items.forEach((item) => Object.entries(item.proposal_decline_reasons || {}).forEach(([reason, count]) => {
      totals.set(reason, (totals.get(reason) || 0) + Number(count || 0));
    }));
    return [...totals.entries()].sort((left, right) => right[1] - left[1]);
  }, [items]);

  const financialItems = useMemo(() => items.filter((item) => {
    if (!["booked", "paid"].includes(String(item.status))) return false;
    const start = String(item.start_date || "").slice(0, 10);
    if (financeFrom && (!start || start < financeFrom)) return false;
    if (financeTo && (!start || start > financeTo)) return false;
    return true;
  }), [financeFrom, financeTo, items]);
  const hasFinancialTours = items.some((item) => ["booked", "paid"].includes(String(item.status)));

  const finances = useMemo(() => {
    const groups = new Map();
    financialItems.forEach((item) => {
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
  }, [financialItems]);
  const managers = useMemo(() => [...new Set(items.map((item) => String(item.manager_name || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
  const managerFinances = useMemo(() => {
    const groups = new Map();
    financialItems.forEach((item) => {
      const name = String(item.manager_name || "").trim();
      const currency = item.currency || "UZS";
      const key = `${name || "unassigned"}:${currency}`;
      const group = groups.get(key) || { key, name, currency, tours: 0, sales: 0, receivables: 0, margin: 0 };
      const gross = Number(item.gross_total || 0);
      const paid = Math.min(gross, Number(item.paid_amount || 0));
      group.tours += 1;
      group.sales += gross;
      group.receivables += Math.max(0, gross - paid);
      group.margin += actualMargin(item);
      groups.set(key, group);
    });
    return [...groups.values()].sort((left, right) => left.currency.localeCompare(right.currency) || right.sales - left.sales || left.name.localeCompare(right.name));
  }, [financialItems]);
  const managerWorkload = useMemo(() => {
    const today = localDateKey();
    const horizon = localDateKey(new Date(Date.now() + 7 * 86400000));
    const groups = new Map();
    items.filter((item) => !["cancelled", "lost"].includes(item.status)).forEach((item) => {
      const name = String(item.manager_name || "").trim();
      const key = name || "unassigned";
      const group = groups.get(key) || { key, name, active: 0, upcoming: 0, inTrip: 0, attention: 0 };
      if (tripStage(item, today) !== "completed") group.active += 1;
      const start = String(item.start_date || "").slice(0, 10);
      if (start >= today && start <= horizon) group.upcoming += 1;
      if (tripStage(item, today) === "in_trip") group.inTrip += 1;
      if (hasOperationalRisk(item)) group.attention += 1;
      groups.set(key, group);
    });
    return [...groups.values()].sort((a, b) => b.attention - a.attention || b.active - a.active || a.name.localeCompare(b.name));
  }, [items]);
  const managerSales = useMemo(() => {
    const groups = new Map();
    items.filter((item) => Number(item.current_revision || 0) > 0).forEach((item) => {
      const name = String(item.manager_name || "").trim();
      const key = name || "unassigned";
      const group = groups.get(key) || { key, name, proposals: 0, responded: 0, won: 0, responses: 0, responseSeconds: 0, acceptedRevisions: 0 };
      const responseCount = Number(item.proposal_response_count || 0);
      group.proposals += 1;
      if (responseCount > 0) group.responded += 1;
      if (Number(item.accepted_revision || 0) > 0) {
        group.won += 1;
        group.acceptedRevisions += Number(item.accepted_revision || 0);
      }
      group.responses += responseCount;
      group.responseSeconds += Number(item.proposal_avg_response_seconds || 0) * responseCount;
      groups.set(key, group);
    });
    return [...groups.values()].sort((left, right) => {
      const leftConversion = left.responded ? left.won / left.responded : 0;
      const rightConversion = right.responded ? right.won / right.responded : 0;
      return rightConversion - leftConversion || right.won - left.won || right.proposals - left.proposals || left.name.localeCompare(right.name);
    });
  }, [items]);

  const exportFinances = () => {
    const columns = ["reference", "tour", "manager", "client", "start", "end", "currency", "sale", "received", "receivable", "planned_cost", "actual_cost", "actual_margin", "supplier_payable", "client_due", "supplier_due", "payment_status"];
    const rows = financialItems.map((item) => {
      const gross = Number(item.gross_total || 0);
      const paid = Math.min(gross, Number(item.paid_amount || 0));
      const actualCost = Number(item.actual_cost_total ?? item.net_total ?? 0);
      return [item.booking_reference, item.title, item.manager_name, item.client_company || item.client_name, String(item.start_date || "").slice(0, 10), String(item.end_date || "").slice(0, 10), item.currency || "UZS", gross, paid, Math.max(0, gross - paid), Number(item.net_total || 0), actualCost, gross - actualCost, Number(item.supplier_payable_total || 0), String(item.payment_due_at || "").slice(0, 10), String(item.next_supplier_due_at || "").slice(0, 10), item.payment_status || "unpaid"];
    });
    const content = `\uFEFF${[columns.map((key) => t(`tb.portfolio.export_${key}`)), ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `travella-tour-finance-${financeFrom || "all"}-${financeTo || localDateKey()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const setFinancePeriod = (period) => {
    const now = new Date();
    if (period === "month") {
      setFinanceFrom(localDateKey(new Date(now.getFullYear(), now.getMonth(), 1)));
      setFinanceTo(localDateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
      return;
    }
    if (period === "next30") {
      setFinanceFrom(localDateKey(now));
      setFinanceTo(localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30)));
      return;
    }
    setFinanceFrom("");
    setFinanceTo("");
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status !== "all" && (status === "pipeline" ? !pipelineStatuses.has(String(item.status)) : item.status !== status)) return false;
      if (payment !== "all" && (item.payment_status || "unpaid") !== payment) return false;
      if (manager !== "all" && (manager === "unassigned" ? Boolean(item.manager_name) : item.manager_name !== manager)) return false;
      if (operations === "attention" && !hasOperationalRisk(item)) return false;
      if (operations === "incidents" && Number(item.open_incident_count || 0) <= 0) return false;
      if (operations === "departing_today" && tripStage(item) !== "departing_today") return false;
      if (operations === "in_trip" && tripStage(item) !== "in_trip") return false;
      if (operations === "post_tour" && !(tripStage(item) === "completed" && Number(item.supplier_reviewed_count || 0) < Number(item.component_count || 0))) return false;
      if (operations === "unreconciled" && !(["booked", "paid"].includes(String(item.status)) && Number(item.component_count || 0) > Number(item.actual_cost_count || 0))) return false;
      if (operations === "finance_dates_missing" && !(["booked", "paid"].includes(String(item.status)) && ((item.payment_status !== "paid" && !item.payment_due_at) || Number(item.supplier_missing_due_count || 0) > 0))) return false;
      if (operations === "loss_making" && !(["booked", "paid"].includes(String(item.status)) && actualMargin(item) < 0)) return false;
      if (operations === "refund_pending" && !isRefundPending(item)) return false;
      if (operations === "proposal_expired" && !isProposalExpired(item)) return false;
      if (operations === "proposal_followup" && !isProposalFollowupDue(item)) return false;
      if (operations === "proposal_waiting" && !isAwaitingProposal(item)) return false;
      if (operations === "proposal_accepted" && item.proposal_response !== "accepted") return false;
      if (operations === "proposal_changes" && item.proposal_response !== "changes_requested") return false;
      if (operations === "proposal_declined" && item.proposal_response !== "declined") return false;
      if (operations === "supplier_replies" && Number(item.supplier_reply_pending_count || 0) <= 0) return false;
      if (operations === "unread_replies" && Number(item.unread_supplier_reply_count || 0) <= 0) return false;
      if (operations === "overdue" && Number(item.supplier_overdue_count || 0) <= 0) return false;
      if (operations === "missing" && Number(item.missing_confirmation_count || 0) <= 0) return false;
      if (operations === "documents" && Number(item.missing_supplier_document_count || 0) <= 0) return false;
      if (operations === "document_review" && Number(item.supplier_document_review_count || 0) <= 0) return false;
      if (operations === "supplier_orders" && Number(item.supplier_order_pending_count || 0) <= 0 && Number(item.supplier_order_declined_count || 0) <= 0 && Number(item.supplier_order_attention_count || 0) <= 0) return false;
      if (operations === "supplier_declined" && Number(item.supplier_order_declined_count || 0) <= 0) return false;
      if (needle && ![item.title, item.manager_name, item.client_name, item.client_company, item.booking_reference].some((value) => String(value || "").toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [items, manager, operations, payment, query, status]);

  const sortedItems = useMemo(() => [...filtered].sort((left, right) => {
    if (sortBy === "departure") return timeValue(left.start_date, Number.MAX_SAFE_INTEGER) - timeValue(right.start_date, Number.MAX_SAFE_INTEGER);
    if (sortBy === "margin") return actualMarginRate(left) - actualMarginRate(right);
    if (sortBy === "recent") return timeValue(right.updated_at, 0) - timeValue(left.updated_at, 0);
    const priorityDifference = operationalPriority(right) - operationalPriority(left);
    if (priorityDifference) return priorityDifference;
    return timeValue(left.start_date, Number.MAX_SAFE_INTEGER) - timeValue(right.start_date, Number.MAX_SAFE_INTEGER);
  }), [filtered, sortBy]);

  if (loading) return <main className="mx-auto max-w-7xl p-6 text-gray-500">{t("common.loading")}</main>;
  return <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-gray-200 pb-6"><div><div className="text-xs font-bold uppercase text-orange-600">Tour Builder</div><h1 className="mt-1 text-3xl font-bold">{t("tb.portfolio.title")}</h1><p className="mt-2 text-gray-600">{t("tb.portfolio.subtitle")}</p></div><Link to="/tour-builder" className="inline-flex h-11 items-center gap-2 bg-orange-600 px-5 font-bold text-white hover:bg-orange-700"><Plus size={18} />{t("tb.portfolio.create")}</Link></header>
    {error && <div className="mt-5 border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>}
    {stats.review > 0 && <button type="button" onClick={() => setOperations("document_review")} className="mt-5 inline-flex items-center gap-2 border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800"><AlertTriangle size={16} />{t("tb.portfolio.documents_to_review", { count: stats.review })}</button>}
    {stats.missingFinanceDates > 0 && <button type="button" onClick={() => setOperations("finance_dates_missing")} className="mt-5 ml-2 inline-flex items-center gap-2 border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-800"><CalendarDays size={16} />{t("tb.portfolio.finance_dates_missing_count", { count: stats.missingFinanceDates })}</button>}
    {stats.lossMaking > 0 && <button type="button" onClick={() => setOperations("loss_making")} className="mt-5 ml-2 inline-flex items-center gap-2 bg-red-700 px-4 py-2 text-sm font-bold text-white"><AlertTriangle size={16} />{t("tb.portfolio.loss_making_count", { count: stats.lossMaking })}</button>}
    {stats.proposalExpired > 0 && <button type="button" onClick={() => setOperations("proposal_expired")} className="mt-5 ml-2 inline-flex items-center gap-2 border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-800"><Clock3 size={16} />{t("tb.portfolio.proposal_expired_count", { count: stats.proposalExpired })}</button>}
    {stats.proposalFollowup > 0 && <button type="button" onClick={() => setOperations("proposal_followup")} className="mt-5 ml-2 inline-flex items-center gap-2 border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800"><MessageCircle size={16} />{t("tb.portfolio.proposal_followup_count", { count: stats.proposalFollowup })}</button>}
    {hasFinancialTours && <section className="mt-5 border border-gray-200 bg-gray-50 p-4"><div className="flex flex-wrap items-end justify-between gap-4"><div><div className="text-xs font-semibold uppercase text-gray-400">{t("tb.portfolio.finance_period")}</div><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => setFinancePeriod("month")} className="h-9 border border-gray-300 bg-white px-3 text-sm font-semibold hover:border-orange-500">{t("tb.portfolio.period_current_month")}</button><button type="button" onClick={() => setFinancePeriod("next30")} className="h-9 border border-gray-300 bg-white px-3 text-sm font-semibold hover:border-orange-500">{t("tb.portfolio.period_next_30")}</button><button type="button" onClick={() => setFinancePeriod("all")} className={`h-9 border px-3 text-sm font-semibold ${!financeFrom && !financeTo ? "border-gray-950 bg-gray-950 text-white" : "border-gray-300 bg-white hover:border-orange-500"}`}>{t("tb.portfolio.period_all")}</button></div></div><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold uppercase text-gray-500"><span className="mb-1 block">{t("tb.portfolio.finance_from")}</span><input type="date" value={financeFrom} max={financeTo || undefined} onChange={(event) => setFinanceFrom(event.target.value)} className="h-10 border border-gray-300 bg-white px-3 text-sm font-normal text-gray-950 outline-none focus:border-orange-500" /></label><label className="text-xs font-semibold uppercase text-gray-500"><span className="mb-1 block">{t("tb.portfolio.finance_to")}</span><input type="date" value={financeTo} min={financeFrom || undefined} onChange={(event) => setFinanceTo(event.target.value)} className="h-10 border border-gray-300 bg-white px-3 text-sm font-normal text-gray-950 outline-none focus:border-orange-500" /></label><div className="pb-2 text-sm font-semibold text-gray-600">{t("tb.portfolio.period_tours", { count: financialItems.length })}</div></div></div>{financialItems.length === 0 && <div className="mt-4 border-t border-gray-200 pt-4 text-sm text-gray-500">{t("tb.portfolio.no_finance_in_period")}</div>}</section>}
    {finances.length > 0 && <section className="mt-5 border-y border-gray-200"><div className="flex flex-wrap items-center justify-between gap-4 py-4"><div><h2 className="text-lg font-bold">{t("tb.portfolio.finance_title")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.portfolio.finance_hint")}</p></div><div className="flex items-center gap-4">{stats.unreconciled > 0 && <button type="button" onClick={() => setOperations("unreconciled")} className="text-sm font-bold text-orange-700 hover:underline">{t("tb.portfolio.unreconciled_count", { count: stats.unreconciled })}</button>}<button type="button" onClick={exportFinances} className="inline-flex h-10 items-center gap-2 border border-gray-300 bg-white px-3 text-sm font-bold hover:bg-gray-50"><Download size={16} />{t("tb.portfolio.export_finance")}</button></div></div>{finances.map((group) => <div key={group.currency} className="border-t border-gray-200"><div className="grid gap-px bg-gray-200 sm:grid-cols-2 lg:grid-cols-6"><div className="bg-gray-950 px-4 py-4 text-white"><div className="text-xs font-semibold uppercase text-gray-400">{t("tb.portfolio.booked_sales")}</div><div className="mt-1 text-xl font-bold">{money(group.sales, group.currency)}</div><div className="mt-1 text-xs text-gray-400">{t("tb.portfolio.tours_count", { count: group.total })}</div></div>{[["received_total", group.received, "text-emerald-700"], ["receivables_total", group.receivables, group.receivables > 0 ? "text-red-700" : "text-emerald-700"], ["payables_total", group.payables, group.payables > group.receivables ? "text-red-700" : "text-gray-950"], ["planned_margin", group.plannedMargin, "text-gray-950"], ["actual_margin", group.actualMargin, group.actualMargin < 0 ? "text-red-700" : "text-emerald-700"]].map(([key, value, tone]) => <div key={key} className="bg-white px-4 py-4"><div className="text-xs font-semibold uppercase text-gray-400">{t(`tb.portfolio.${key}`)}</div><div className={`mt-1 text-xl font-bold ${tone}`}>{money(value, group.currency)}</div>{key === "receivables_total" && group.overdueReceivables > 0 && <div className="mt-1 text-xs font-semibold text-red-600">{t("tb.portfolio.overdue_amount", { amount: money(group.overdueReceivables, group.currency) })}</div>}{key === "payables_total" && group.overduePayables > 0 && <div className="mt-1 text-xs font-semibold text-red-600">{t("tb.portfolio.overdue_amount", { amount: money(group.overduePayables, group.currency) })}</div>}{key === "actual_margin" && <div className="mt-1 text-xs text-gray-400">{t("tb.portfolio.reconciled_count", { count: group.reconciled, total: group.total })}</div>}</div>)}</div><div className="grid border-t border-gray-200 bg-white md:grid-cols-2">{[[7, group.clientDue7, group.supplierDue7], [30, group.clientDue30, group.supplierDue30]].map(([days, incoming, outgoing]) => <div key={days} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:border-r md:last:border-r-0"><div className="text-sm font-bold">{t("tb.portfolio.cash_forecast", { days })}</div><div className="flex flex-wrap gap-x-5 gap-y-1 text-sm"><span className="text-emerald-700">{t("tb.portfolio.cash_in")}: <strong>{money(incoming, group.currency)}</strong></span><span className="text-red-700">{t("tb.portfolio.cash_out")}: <strong>{money(outgoing, group.currency)}</strong></span><span className={incoming - outgoing < 0 ? "font-bold text-red-700" : "font-bold text-gray-950"}>{t("tb.portfolio.cash_net")}: {money(incoming - outgoing, group.currency)}</span></div></div>)}</div>{(group.undatedClient > 0 || group.undatedSupplier > 0) && <button type="button" onClick={() => setOperations("finance_dates_missing")} className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 border-t border-red-200 bg-red-50 px-4 py-3 text-left text-sm text-red-800"><AlertTriangle size={16} /><strong>{t("tb.portfolio.without_due_date")}</strong>{group.undatedClient > 0 && <span>{t("tb.portfolio.cash_in")}: {money(group.undatedClient, group.currency)}</span>}{group.undatedSupplier > 0 && <span>{t("tb.portfolio.cash_out")}: {money(group.undatedSupplier, group.currency)}</span>}</button>}</div>)}</section>}
    {managerFinances.length > 0 && <section className="mt-5 border-y border-gray-200"><div className="py-4"><h2 className="text-lg font-bold">{t("tb.portfolio.team_finances")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.portfolio.team_finances_hint")}</p></div><div className="overflow-x-auto"><div className="min-w-[760px]"><div className="grid grid-cols-[minmax(190px,1fr)_80px_150px_150px_150px_110px] border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase text-gray-400"><span>{t("tb.portfolio.manager")}</span><span>{t("tb.portfolio.tours")}</span><span>{t("tb.portfolio.booked_sales")}</span><span>{t("tb.portfolio.receivables_total")}</span><span>{t("tb.portfolio.actual_margin")}</span><span>{t("tb.portfolio.margin_rate")}</span></div>{managerFinances.map((row) => { const rate = row.sales > 0 ? row.margin / row.sales * 100 : 0; return <button key={row.key} type="button" onClick={() => setManager(row.name || "unassigned")} className={`grid w-full grid-cols-[minmax(190px,1fr)_80px_150px_150px_150px_110px] items-center border-t border-gray-200 px-4 py-3 text-left text-sm hover:bg-gray-50 ${manager === (row.name || "unassigned") ? "bg-orange-50" : "bg-white"}`}><span><strong>{row.name || t("tb.portfolio.manager_unassigned")}</strong><span className="ml-2 text-xs text-gray-400">{row.currency}</span></span><span>{row.tours}</span><span className="font-semibold">{money(row.sales, row.currency)}</span><span className={row.receivables > 0 ? "font-semibold text-red-700" : "text-gray-500"}>{money(row.receivables, row.currency)}</span><span className={row.margin < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>{money(row.margin, row.currency)}</span><span className={rate < 0 ? "font-bold text-red-700" : "font-bold text-gray-950"}>{rate.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span></button>; })}</div></div></section>}
    <section className="mt-5 grid gap-px bg-gray-200 border border-gray-200 sm:grid-cols-4">{[["departing_today", stats.departingToday, CalendarDays], ["in_trip", stats.inTrip, Users], ["post_tour", stats.postTour, Clock3], ["unreconciled", stats.unreconciled, CircleDollarSign]].map(([key, count, Icon]) => <button key={key} type="button" onClick={() => setOperations(key)} className={`flex items-center justify-between bg-white px-4 py-4 text-left hover:bg-gray-50 ${operations === key ? "ring-2 ring-inset ring-orange-500" : ""}`}><div><div className="text-xs font-semibold uppercase text-gray-400">{t(`tb.portfolio.${key}`)}</div><div className={`mt-1 text-2xl font-bold ${count ? "text-gray-950" : "text-gray-400"}`}>{count}</div></div><Icon size={20} className={count ? "text-orange-600" : "text-gray-300"} /></button>)}</section>
    {managerWorkload.length > 0 && <section className="mt-5 border-y border-gray-200"><div className="py-4"><h2 className="text-lg font-bold">{t("tb.portfolio.team_workload")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.portfolio.team_workload_hint")}</p></div><div className="overflow-x-auto"><div className="min-w-[620px]"><div className="grid grid-cols-[minmax(220px,1fr)_100px_130px_100px_120px] border-t border-gray-200 bg-gray-50 px-4 py-2 text-xs font-semibold uppercase text-gray-400"><span>{t("tb.portfolio.manager")}</span><span>{t("tb.portfolio.active_tours")}</span><span>{t("tb.portfolio.departures_7d")}</span><span>{t("tb.portfolio.in_trip")}</span><span>{t("tb.portfolio.attention")}</span></div>{managerWorkload.map((row) => <button key={row.key} type="button" onClick={() => setManager(row.key)} className={`grid w-full grid-cols-[minmax(220px,1fr)_100px_130px_100px_120px] items-center border-t border-gray-200 px-4 py-3 text-left text-sm hover:bg-gray-50 ${manager === row.key ? "bg-orange-50" : "bg-white"}`}><strong>{row.name || t("tb.portfolio.manager_unassigned")}</strong><span>{row.active}</span><span>{row.upcoming}</span><span>{row.inTrip}</span><span className={row.attention ? "font-bold text-red-700" : "text-gray-500"}>{row.attention}</span></button>)}</div></div></section>}
    <section className="grid border-b border-gray-200 sm:grid-cols-2 lg:grid-cols-7">
      {[[t("tb.portfolio.all"), stats.total, Users], [t("tb.portfolio.in_progress"), stats.pipeline, Clock3], [t("tb.portfolio.awaiting_client"), stats.awaiting, CalendarDays], [t("tb.portfolio.booked"), stats.booked, CalendarDays], [t("tb.portfolio.receivables"), stats.outstanding, CircleDollarSign], [t("tb.portfolio.new_supplier_replies"), stats.replies, MessageCircle], [t("tb.portfolio.attention"), stats.attention, AlertTriangle]].map(([label, value, Icon]) => <div key={label} className="border-b border-gray-200 py-5 sm:px-4 lg:border-b-0 lg:border-r first:pl-0 last:border-r-0"><Icon size={20} className={(label === t("tb.portfolio.attention") || label === t("tb.portfolio.new_supplier_replies")) && value ? "text-red-600" : "text-gray-400"} /><div className={`mt-3 text-2xl font-bold ${(label === t("tb.portfolio.attention") || label === t("tb.portfolio.new_supplier_replies")) && value ? "text-red-700" : ""}`}>{value}</div><div className="mt-1 text-xs font-semibold uppercase text-gray-400">{label}</div></div>)}
    </section>
    <section className="mt-6 flex flex-col gap-3 border-b border-gray-200 pb-5 lg:flex-row"><label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-3 text-gray-400" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("tb.portfolio.search")} className="h-11 w-full border border-gray-300 bg-white pl-10 pr-3 outline-none focus:border-orange-500" /></label><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 border border-gray-300 bg-white px-3"><option value="all">{t("tb.portfolio.all_statuses")}</option><option value="pipeline">{t("tb.portfolio.in_progress")}</option><option value="proposed">{t("tb.package_status.proposed")}</option><option value="accepted">{t("tb.package_status.accepted")}</option><option value="lost">{t("tb.package_status.lost")}</option><option value="booked">{t("tb.package_status.booked")}</option><option value="paid">{t("tb.package_status.paid")}</option><option value="cancelled">{t("tb.package_status.cancelled")}</option></select><select value={payment} onChange={(event) => setPayment(event.target.value)} className="h-11 border border-gray-300 bg-white px-3"><option value="all">{t("tb.portfolio.all_payments")}</option><option value="unpaid">{t("tb.workspace.payment_unpaid")}</option><option value="partial">{t("tb.workspace.payment_partial")}</option><option value="paid">{t("tb.workspace.payment_paid")}</option></select><select value={operations} onChange={(event) => setOperations(event.target.value)} className="h-11 border border-gray-300 bg-white px-3"><option value="all">{t("tb.portfolio.all_operations")}</option><option value="proposal_waiting">{t("tb.portfolio.proposal_waiting")}</option><option value="proposal_accepted">{t("tb.portfolio.proposal_accepted")}</option><option value="proposal_changes">{t("tb.portfolio.proposal_changes")}</option><option value="proposal_declined">{t("tb.portfolio.proposal_declined")}</option><option value="departing_today">{t("tb.portfolio.departing_today")}</option><option value="in_trip">{t("tb.portfolio.in_trip")}</option><option value="post_tour">{t("tb.portfolio.post_tour")}</option><option value="unreconciled">{t("tb.portfolio.unreconciled")}</option><option value="finance_dates_missing">{t("tb.portfolio.finance_dates_missing")}</option><option value="loss_making">{t("tb.portfolio.loss_making")}</option><option value="refund_pending">{t("tb.portfolio.refund_pending")}</option><option value="attention">{t("tb.portfolio.attention")}</option><option value="incidents">{t("tb.portfolio.open_incidents")}</option><option value="unread_replies">{t("tb.portfolio.new_supplier_replies")}</option><option value="supplier_replies">{t("tb.portfolio.requires_reply")}</option><option value="documents">{t("tb.portfolio.missing_supplier_documents")}</option><option value="supplier_orders">{t("tb.portfolio.supplier_orders")}</option><option value="supplier_declined">{t("tb.portfolio.supplier_declined")}</option><option value="overdue">{t("tb.portfolio.supplier_overdue")}</option><option value="missing">{t("tb.portfolio.missing_confirmation")}</option></select></section>
    {(stats.awaiting > 0 || proposalResponses > 0 || respondedTours.length > 0 || ["proposal_expired", "proposal_followup", "proposal_waiting", "proposal_accepted", "proposal_changes", "proposal_declined"].includes(operations)) && <section className="border-b border-gray-200 py-3"><div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-xs font-semibold uppercase text-gray-400">{t("tb.portfolio.sales_followup")}</span>{[["proposal_waiting", stats.awaiting], ["proposal_accepted", stats.proposalAccepted], ["proposal_changes", stats.proposalChanges], ["proposal_declined", stats.proposalDeclined], ["proposal_followup", stats.proposalFollowup], ["proposal_expired", stats.proposalExpired]].map(([key, count]) => <button key={key} type="button" onClick={() => setOperations(operations === key ? "all" : key)} className={`h-9 border px-3 text-sm font-semibold ${operations === key ? "border-gray-950 bg-gray-950 text-white" : "border-gray-300 bg-white hover:border-orange-500"}`}>{t(`tb.portfolio.${key}`)} · {count}</button>)}</div>{respondedTours.length > 0 && <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-gray-100 pt-3 text-sm"><span><span className="text-gray-500">{t("tb.portfolio.proposal_conversion_label")}</span> <strong>{proposalConversion}%</strong></span><span><span className="text-gray-500">{t("tb.portfolio.proposal_avg_response")}</span> <strong>{averageResponseHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} {t("tb.portfolio.hours_short")}</strong></span>{wonTours.length > 0 && <span><span className="text-gray-500">{t("tb.portfolio.proposal_avg_revisions")}</span> <strong>{averageAcceptedRevisions.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></span>}<span className="text-gray-400">{t("tb.portfolio.proposal_sample", { count: respondedTours.length })}</span></div>}{declineReasons.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-sm"><span className="mr-1 font-semibold text-gray-500">{t("tb.portfolio.decline_reasons")}</span>{declineReasons.map(([reason, count]) => <span key={reason} className="border border-red-200 bg-red-50 px-2 py-1 text-red-800">{t(`tb.proposal.decline_reason_${reason}`)} · <strong>{count}</strong></span>)}</div>}</section>}
    {managerSales.length > 0 && <section className="border-b border-gray-200 py-5"><div><h2 className="text-lg font-bold">{t("tb.portfolio.team_sales")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.portfolio.team_sales_hint")}</p></div><div className="mt-4 overflow-x-auto"><div className="min-w-[850px]"><div className="grid grid-cols-[minmax(190px,1fr)_100px_100px_90px_110px_130px_130px] bg-gray-50 px-4 py-2 text-xs font-semibold uppercase text-gray-400"><span>{t("tb.portfolio.manager")}</span><span>{t("tb.portfolio.proposals_sent")}</span><span>{t("tb.portfolio.proposals_answered")}</span><span>{t("tb.portfolio.proposals_won")}</span><span>{t("tb.portfolio.conversion")}</span><span>{t("tb.portfolio.proposal_avg_response")}</span><span>{t("tb.portfolio.proposal_avg_revisions")}</span></div>{managerSales.map((row) => { const conversion = row.responded ? row.won / row.responded * 100 : 0; const responseHours = row.responses ? row.responseSeconds / row.responses / 3600 : 0; const revisionsToWin = row.won ? row.acceptedRevisions / row.won : 0; return <button key={row.key} type="button" onClick={() => setManager(row.key)} className={`grid w-full grid-cols-[minmax(190px,1fr)_100px_100px_90px_110px_130px_130px] items-center border-t border-gray-200 px-4 py-3 text-left text-sm hover:bg-gray-50 ${manager === row.key ? "bg-orange-50" : "bg-white"}`}><strong>{row.name || t("tb.portfolio.manager_unassigned")}</strong><span>{row.proposals}</span><span>{row.responded}</span><span className={row.won ? "font-bold text-emerald-700" : "text-gray-500"}>{row.won}</span><span className="font-bold">{conversion.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span><span>{responseHours ? `${responseHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${t("tb.portfolio.hours_short")}` : "—"}</span><span>{revisionsToWin ? revisionsToWin.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}</span></button>; })}</div></div></section>}
    <section className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 py-3"><div className="flex flex-wrap items-center gap-3"><span className="text-xs font-semibold uppercase text-gray-400">{t("tb.portfolio.manager")}</span><select value={manager} onChange={(event) => setManager(event.target.value)} className="h-10 border border-gray-300 bg-white px-3 text-sm"><option value="all">{t("tb.portfolio.all_managers")}</option><option value="unassigned">{t("tb.portfolio.manager_unassigned")}</option>{managers.map((name) => <option key={name} value={name}>{name}</option>)}</select></div><label className="flex items-center gap-3"><span className="text-xs font-semibold uppercase text-gray-400">{t("tb.portfolio.sort_by")}</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="h-10 border border-gray-300 bg-white px-3 text-sm"><option value="attention">{t("tb.portfolio.sort_attention")}</option><option value="departure">{t("tb.portfolio.sort_departure")}</option><option value="recent">{t("tb.portfolio.sort_recent")}</option><option value="margin">{t("tb.portfolio.sort_margin")}</option></select></label></section>
    <section className="mt-2 divide-y border-b border-gray-200">
      {sortedItems.map((item) => {
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
        return <Link key={item.id} to={`/dashboard/tour-packages/${item.id}${replyBookingId ? `?component=${replyBookingId}` : ""}`} className="grid gap-4 py-5 hover:bg-gray-50 sm:px-3 lg:grid-cols-[minmax(260px,1fr)_170px_150px_180px_28px] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-gray-950">{item.title}</h2><span className={`px-2 py-0.5 text-xs font-semibold ${item.status === "lost" ? "bg-red-50 text-red-700" : item.status === "accepted" ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>{t(`tb.package_status.${item.status}`, { defaultValue: item.status })}</span>{["departing_today", "in_trip", "completed"].includes(stage) && <span className={`px-2 py-0.5 text-xs font-bold ${stage === "in_trip" ? "bg-emerald-50 text-emerald-700" : stage === "departing_today" ? "bg-orange-50 text-orange-700" : "bg-gray-100 text-gray-600"}`}>{t(`tb.portfolio.stage_${stage}`)}</span>}{unreadReplies > 0 && <span className="inline-flex items-center gap-1 bg-sky-50 px-2 py-0.5 text-xs font-bold text-sky-700"><MessageCircle size={13} />{t("tb.portfolio.unread_replies", { count: unreadReplies })}</span>}{pendingReplies > 0 && <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold ${Number(item.supplier_reply_overdue_count || 0) > 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{t("tb.portfolio.requires_reply_count", { count: pendingReplies })}</span>}{supplierAlerts > 0 && <span className="inline-flex items-center gap-1 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"><AlertTriangle size={13} />{t("tb.portfolio.issues", { count: supplierAlerts })}</span>}</div><div className="mt-1 text-sm text-gray-500">{item.client_name || t("tb.workspace.client_missing")} · {dateText(item.start_date)} — {dateText(item.end_date)}</div>{Number(item.supplier_order_declined_count || 0) > 0 && <div className="mt-2 text-xs font-bold text-red-700">{t("tb.portfolio.supplier_declined_count", { count: item.supplier_order_declined_count })}</div>}{Number(item.supplier_order_pending_count || 0) > 0 && <div className="mt-1 text-xs font-semibold text-amber-700">{t("tb.portfolio.supplier_pending_count", { count: item.supplier_order_pending_count })}</div>}{nextAction && <div className={`mt-2 flex items-center gap-1.5 text-xs font-semibold ${nextAction.urgency === "overdue" ? "text-red-700" : nextAction.urgency === "today" ? "text-orange-700" : "text-gray-500"}`}><Clock3 size={13} />{t(`tb.action_timeline.${nextAction.type}`)} · {dateText(nextAction.due_at)}</div>}</div><div><div className="flex items-center justify-between gap-2 text-xs uppercase text-gray-400"><span>{t("tb.portfolio.readiness")}</span><strong className={readiness.percent === 100 ? "text-emerald-700" : "text-gray-700"}>{readiness.percent}%</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200"><div className={readiness.percent === 100 ? "h-full bg-emerald-500" : "h-full bg-orange-500"} style={{ width: `${readiness.percent}%` }} /></div>{Number(item.supplier_unpaid_count || 0) > 0 && <div className="mt-1 text-xs text-amber-700">{t("tb.portfolio.supplier_unpaid", { count: item.supplier_unpaid_count })}</div>}</div><div><div className="text-xs uppercase text-gray-400">{t("tb.portfolio.sale")}</div><div className="mt-1 font-bold">{money(item.gross_total, item.currency)}</div>{["booked", "paid"].includes(String(item.status)) && <div className={`mt-1 text-xs font-semibold ${margin < 0 ? "text-red-700" : "text-emerald-700"}`}>{t("tb.portfolio.margin_short")}: {money(margin, item.currency)}</div>}</div><div><div className="text-xs uppercase text-gray-400">{t("tb.portfolio.payment")}</div><div className={`mt-1 font-semibold ${overdue ? "text-red-700" : item.payment_status === "paid" ? "text-emerald-700" : "text-gray-700"}`}>{overdue ? t("tb.portfolio.overdue") : t(`tb.workspace.payment_${item.payment_status || "unpaid"}`)}</div>{item.booking_reference && <div className="mt-1 font-mono text-xs text-gray-500">{item.booking_reference}</div>}</div><ChevronRight size={20} className="text-gray-400" /></Link>;
      })}
      {!filtered.length && <div className="py-16 text-center text-gray-500">{t("tb.portfolio.empty")}</div>}
    </section>
  </main>;
}
