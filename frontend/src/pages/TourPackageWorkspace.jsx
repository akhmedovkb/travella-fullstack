import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, Bell, BriefcaseBusiness, CalendarDays, CheckCircle2, CircleDashed, CircleDollarSign, Clock3, Copy, CreditCard, ExternalLink, FileText, ListTodo, Paperclip, Pencil, Plus, Save, Send, Trash2, UserRound, Users, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const cfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("token") || localStorage.getItem("providerToken")}` } });
const money = (value, currency) => `${Number(value || 0).toLocaleString(currency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} ${currency || "UZS"}`;
const dateText = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";
const dateTimeText = (value) => value ? new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const dateValue = (value) => value ? String(value).slice(0, 10) : "";
const confirmedStatuses = new Set(["confirmed", "paid", "completed"]);
const lockedStatuses = new Set(["booked", "paid", "cancelled"]);
const fieldClass = "h-11 w-full border border-gray-300 bg-white px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100";

async function openAttachment(packageId, bookingId, eventId) {
  const target = window.open("about:blank", "_blank");
  if (target) target.opener = null;
  try {
    const response = await axios.get(`${API_BASE}/api/tour-packages/${packageId}/components/${bookingId}/events/${eventId}/attachment`, { ...cfg(), responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    if (target) target.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    if (target) target.close();
    throw error;
  }
}

function currentOperationsTimeline(tourPackage, components) {
  if (["cancelled", "lost"].includes(String(tourPackage.status || "").toLowerCase())) return [];
  const today = new Date().toISOString().slice(0, 10);
  const events = [];
  const add = (type, value, extra = {}) => {
    const dueAt = dateValue(value);
    if (!dueAt) return;
    const days = Math.round((Date.parse(`${dueAt}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    events.push({ type, due_at: dueAt, days, urgency: days < 0 ? "overdue" : days === 0 ? "today" : days <= 7 ? "soon" : "upcoming", ...extra });
  };
  if (tourPackage.payment_status !== "paid") add("client_payment", tourPackage.payment_due_at);
  components.filter((item) => item.supplier_paid !== true).forEach((item) => add("supplier_payment", item.supplier_payment_due_at, { booking_id: item.id, label: item.service_title || item.provider_name }));
  if (tourPackage.status === "proposed" && !tourPackage.proposal_response) {
    const followupBase = tourPackage.last_client_followup_at || tourPackage.shared_at;
    if (followupBase) add("client_follow_up", new Date(new Date(followupBase).getTime() + 48 * 60 * 60 * 1000).toISOString());
    add("proposal_expiry", tourPackage.quote_valid_until);
  }
  if (dateValue(tourPackage.start_date) >= today) add("departure", tourPackage.start_date);
  const priority = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
  return events.sort((a, b) => priority[a.urgency] - priority[b.urgency] || a.due_at.localeCompare(b.due_at));
}

function createForm(item) {
  return {
    title: item.title || "", client_name: item.client_name || "", client_company: item.client_company || "",
    client_phone: item.client_phone || "", client_email: item.client_email || "",
    start_date: dateValue(item.start_date), end_date: dateValue(item.end_date), quote_valid_until: dateValue(item.quote_valid_until),
    pax_adult: Number(item.pax_adult || 0), pax_child: Number(item.pax_child || 0),
    markup_type: item.markup_type === "fixed" ? "fixed" : "percent", markup_value: Number(item.markup_value || 0),
    itinerary: (Array.isArray(item.itinerary) ? item.itinerary : []).map((day, index) => ({
      ...day, day: day.day || index + 1, date: dateValue(day.date), city: day.city || "", program_text: day.program_text || "",
    })),
  };
}

function LabeledField({ label, children, wide = false }) {
  return <label className={wide ? "md:col-span-2" : ""}><span className="mb-1.5 block text-sm font-semibold">{label}</span>{children}</label>;
}

function SaleConversionPanel({ confirmed, total, saving, onConfirm, t }) {
  const suppliersReady = total > 0 && confirmed === total;
  return <section className={`mt-5 border p-5 ${suppliersReady ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
    <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex items-center gap-2"><CheckCircle2 size={20} className="text-emerald-700" /><h2 className="text-lg font-bold">{t("tb.proposal.booking_action_title")}</h2></div>
        <p className="mt-1 text-sm text-gray-600">{t("tb.proposal.booking_action_hint")}</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
          <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 size={16} />{t("tb.proposal.response_accepted")}</span>
          <span className={`inline-flex items-center gap-1.5 ${suppliersReady ? "text-emerald-700" : "text-amber-700"}`}>{suppliersReady ? <CheckCircle2 size={16} /> : <CircleDashed size={16} />}{total ? t("tb.proposal.components_pending", { confirmed, total }) : t("tb.proposal.components_required")}</span>
        </div>
      </div>
      <div className="shrink-0 md:text-right">
        <div className={`mb-2 text-xs font-bold uppercase ${suppliersReady ? "text-emerald-700" : "text-amber-700"}`}>{t(suppliersReady ? "tb.proposal.booking_ready" : "tb.proposal.booking_blocked")}</div>
        <button type="button" disabled={saving || !suppliersReady} onClick={onConfirm} className="inline-flex h-11 w-full items-center justify-center gap-2 bg-gray-950 px-5 font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-35 md:w-auto"><BriefcaseBusiness size={18} />{t("tb.proposal.confirm_sale")}</button>
      </div>
    </div>
  </section>;
}

function TravelerSection({ travelers, setTravelers, capacity, onSave, saving, t }) {
  const addTraveler = () => {
    if (travelers.length >= capacity) return;
    setTravelers([...travelers, { full_name: "", traveler_type: "adult", birth_date: "", citizenship: "", passport_number: "", passport_expiry: "", room_type: "", notes: "" }]);
  };
  const update = (index, name, value) => setTravelers(travelers.map((traveler, i) => i === index ? { ...traveler, [name]: value } : traveler));
  return <section>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold"><Users size={20} />{t("tb.travelers.title")}</h2>
        <p className="mt-1 text-sm text-gray-500">{t("tb.travelers.count", { current: travelers.length, total: capacity })}</p>
        <p className="mt-1 text-xs text-gray-400">{t("tb.travelers.privacy_hint")}</p>
      </div>
      <button type="button" disabled={travelers.length >= capacity} onClick={addTraveler} className="inline-flex h-10 items-center gap-2 border border-gray-300 bg-white px-4 text-sm font-semibold disabled:opacity-40"><Plus size={16} />{t("tb.travelers.add")}</button>
    </div>
    <div className="mt-4 space-y-3">
      {travelers.map((traveler, index) => <div key={traveler.id || index} className="border border-gray-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <LabeledField label={t("tb.travelers.full_name")}><input value={traveler.full_name || ""} onChange={(e) => update(index, "full_name", e.target.value)} className={fieldClass} /></LabeledField>
          <LabeledField label={t("tb.travelers.type")}><select value={traveler.traveler_type || "adult"} onChange={(e) => update(index, "traveler_type", e.target.value)} className={fieldClass}><option value="adult">{t("tb.travelers.adult")}</option><option value="child">{t("tb.travelers.child")}</option></select></LabeledField>
          <LabeledField label={t("tb.travelers.birth_date")}><input type="date" value={dateValue(traveler.birth_date)} onChange={(e) => update(index, "birth_date", e.target.value)} className={fieldClass} /></LabeledField>
          <LabeledField label={t("tb.travelers.citizenship")}><input value={traveler.citizenship || ""} onChange={(e) => update(index, "citizenship", e.target.value)} className={fieldClass} /></LabeledField>
          <LabeledField label={t("tb.travelers.passport")}><input value={traveler.passport_number || ""} onChange={(e) => update(index, "passport_number", e.target.value)} className={fieldClass} /></LabeledField>
          <LabeledField label={t("tb.travelers.passport_expiry")}><input type="date" value={dateValue(traveler.passport_expiry)} onChange={(e) => update(index, "passport_expiry", e.target.value)} className={fieldClass} /></LabeledField>
          <LabeledField label={t("tb.travelers.room")}><input value={traveler.room_type || ""} onChange={(e) => update(index, "room_type", e.target.value)} placeholder={t("tb.travelers.room_ph")} className={fieldClass} /></LabeledField>
          <div className="flex min-w-0 items-end gap-2"><div className="min-w-0 flex-1"><LabeledField label={t("tb.travelers.notes")}><input value={traveler.notes || ""} onChange={(e) => update(index, "notes", e.target.value)} className={fieldClass} /></LabeledField></div><button type="button" onClick={() => setTravelers(travelers.filter((_, i) => i !== index))} title={t("common.delete")} className="mb-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center text-red-600 hover:bg-red-50"><Trash2 size={17} /></button></div>
        </div>
      </div>)}
      {!travelers.length && <div className="border-y border-gray-200 py-8 text-center text-gray-500">{t("tb.travelers.empty")}</div>}
    </div>
    <div className="mt-4 flex justify-end"><button type="button" disabled={saving || travelers.some((item) => !String(item.full_name || "").trim())} onClick={onSave} className="inline-flex h-10 items-center gap-2 bg-gray-950 px-5 text-sm font-semibold text-white disabled:opacity-40"><Save size={16} />{t("tb.travelers.save")}</button></div>
  </section>;
}

function ComponentOperationsCard({ item, currency, saving, onSave, onSaveSupplierRefund, onSendOrder, onRemindOrder, onCancelOrder, onMessageOrder, onMarkRead, onClassifyAttachment, onReviewAttachment, onRequestDocuments, packageId, packageStatus, canIssueOrder, t }) {
  const cardRef = useRef(null);
  onReviewAttachment ||= async (bookingId, eventId, reviewStatus) => {
    await axios.post(`${API_BASE}/api/tour-packages/${packageId}/components/${bookingId}/events/${eventId}/review`, { review_status: reviewStatus }, cfg());
    window.location.reload();
  };
  const [form, setForm] = useState({
    confirmation_reference: item.confirmation_reference || "",
    supplier_payment_due_at: dateValue(item.supplier_payment_due_at),
    supplier_paid: Boolean(item.supplier_paid),
    operational_note: item.operational_note || "",
    quality_rating: item.quality_rating || "",
    reliability_rating: item.reliability_rating || "",
    performance_note: item.performance_note || "",
    actual_supplier_cost: item.actual_supplier_cost ?? "",
    cost_variance_note: item.cost_variance_note || "",
    supplier_refund_due_amount: Number(item.supplier_refund_due_amount || 0),
    supplier_refunded_amount: Number(item.supplier_refunded_amount || 0),
    supplier_refund_due_at: dateValue(item.supplier_refund_due_at),
    supplier_refund_note: item.supplier_refund_note || "",
  });
  const [supplierMessage, setSupplierMessage] = useState("");
  const ready = confirmedStatuses.has(String(item.status || "").toLowerCase());
  const orderStatus = String(item.service_order_status || "").toLowerCase();
  const unreadReplyCount = (item.service_order_events || []).filter((event) => ["message_received", "attachment_received"].includes(event.event_type) && !event.read_at).length;
  const supplierAttachments = (item.service_order_events || []).filter((event) => event.event_type === "attachment_received");
  const hasSupplierDocument = supplierAttachments.some((event) => event.metadata?.review_status === "approved");
  const lastDocumentRequest = (item.service_order_events || []).find((event) => event.event_type === "document_request_sent");
  const documentRequestCoolingDown = lastDocumentRequest && Date.now() - new Date(lastDocumentRequest.created_at).getTime() < 60 * 60 * 1000;
  const reminderCoolingDown = item.service_order_last_reminded_at && Date.now() - new Date(item.service_order_last_reminded_at).getTime() < 60 * 60 * 1000;
  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  useEffect(() => {
    if (!unreadReplyCount || !cardRef.current) return undefined;
    let timer = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) return;
      timer = window.setTimeout(() => onMarkRead(item.id), 700);
      observer.disconnect();
    }, { threshold: [0.5] });
    observer.observe(cardRef.current);
    return () => { observer.disconnect(); if (timer) window.clearTimeout(timer); };
  }, [item.id, onMarkRead, unreadReplyCount]);
  return <article ref={cardRef} id={`component-${item.id}`} className={`border bg-white p-4 ${unreadReplyCount ? "border-sky-400 ring-2 ring-sky-100" : "border-gray-200"}`}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><div className="font-bold">{item.service_title || item.provider_name || t("tb.workspace.supplier")}</div>{unreadReplyCount > 0 && <span className="bg-sky-50 px-2 py-0.5 text-xs font-bold text-sky-700">{t("tb.documents.new_supplier_reply", { count: unreadReplyCount })}</span>}</div>
        <div className="mt-1 text-sm text-gray-500">{item.provider_name || t("tb.workspace.supplier")} · #{item.id}{item.date ? ` · ${dateText(item.date)}` : ""}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {item.provider_phone && <a href={`tel:${item.provider_phone}`} className="font-semibold text-sky-700 hover:underline">{item.provider_phone}</a>}
          {item.provider_telegram && <span className="text-gray-600">{item.provider_telegram}</span>}
        </div>
      </div>
      <div className="text-right"><div className="font-bold">{money(item.provider_price, item.currency || currency)}</div><span className={`mt-1 inline-flex items-center gap-1.5 text-sm font-semibold ${ready ? "text-emerald-700" : "text-amber-700"}`}>{ready ? <CheckCircle2 size={17} /> : <CircleDashed size={17} />}{item.status}</span>{canIssueOrder && <div className="mt-2 flex flex-wrap justify-end gap-3"><Link to={`/dashboard/tour-packages/${packageId}/document/service-order?booking=${item.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline"><FileText size={14} />{t("tb.documents.open_service_order")}</Link>{orderStatus === "sent" && <button type="button" disabled={saving || reminderCoolingDown} onClick={() => onRemindOrder(item.id)} title={reminderCoolingDown ? t("tb.documents.reminder_cooldown") : t("tb.documents.remind_service_order")} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40"><Bell size={14} />{t("tb.documents.remind_service_order")}</button>}{["sent", "accepted"].includes(orderStatus) && <button type="button" disabled={saving} onClick={() => onCancelOrder(item.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline disabled:opacity-40"><X size={14} />{t("tb.documents.cancel_service_order")}</button>}<button type="button" disabled={saving} onClick={() => onSendOrder(item.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:underline disabled:opacity-40"><Send size={14} />{t(item.service_order_sent_at ? "tb.documents.resend_service_order" : "tb.documents.send_service_order")}</button></div>}{item.service_order_sent_at && <div className={`mt-1 text-xs font-semibold ${orderStatus === "accepted" ? "text-emerald-700" : ["declined", "cancelled"].includes(orderStatus) ? "text-red-700" : "text-amber-700"}`}>{t(`tb.documents.service_order_${orderStatus || "sent"}`, { date: dateText(item.service_order_responded_at || item.service_order_sent_at) })}</div>}</div>
    </div>
    {item.provider_note && <div className="mt-3 border-l-2 border-sky-300 bg-sky-50 px-3 py-2 text-sm text-gray-700"><span className="font-semibold">{t("tb.workspace.supplier_note")}:</span> {item.provider_note}</div>}
    {orderStatus === "accepted" && <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 border px-3 py-2 text-sm ${hasSupplierDocument ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><span className="inline-flex items-center gap-2 font-semibold"><Paperclip size={16} />{hasSupplierDocument ? t("tb.documents.supplier_documents_received") : t("tb.documents.supplier_documents_missing")}</span>{!hasSupplierDocument && <button type="button" disabled={saving || documentRequestCoolingDown} onClick={() => onRequestDocuments(item.id)} className="font-bold text-orange-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40">{documentRequestCoolingDown ? t("tb.documents.document_request_cooldown") : t("tb.documents.request_documents")}</button>}</div>}
    {supplierAttachments.some((event) => !event.metadata?.review_status || event.metadata.review_status === "pending") && <div className="mt-3 border border-amber-200 bg-amber-50 p-3"><div className="text-xs font-bold uppercase text-amber-800">{t("tb.documents.review_attachments")}</div><div className="mt-2 space-y-2">{supplierAttachments.filter((event) => !event.metadata?.review_status || event.metadata.review_status === "pending").map((event) => <div key={`review-${event.id}`} className="flex flex-wrap items-center gap-3 text-xs"><button type="button" onClick={() => openAttachment(packageId, item.id, event.id).catch(() => window.alert(t("tb.documents.attachment_error")))} className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline"><Paperclip size={13} />{event.metadata?.file_name || t("tb.documents.open_attachment")}</button><button type="button" disabled={saving} onClick={() => onReviewAttachment(item.id, event.id, "approved")} className="font-bold text-emerald-700 hover:underline">{t("tb.documents.approve_attachment")}</button><button type="button" disabled={saving} onClick={() => onReviewAttachment(item.id, event.id, "rejected")} className="font-bold text-red-700 hover:underline">{t("tb.documents.reject_attachment")}</button></div>)}</div></div>}
    <div className="mt-4 grid gap-3 border-t border-gray-200 pt-4 md:grid-cols-[1fr_180px_1.5fr_auto] md:items-end">
      <LabeledField label={t("tb.workspace.confirmation_reference")}><input value={form.confirmation_reference} onChange={(e) => setField("confirmation_reference", e.target.value)} placeholder={t("tb.workspace.confirmation_reference_ph")} className={fieldClass} /></LabeledField>
      <LabeledField label={t("tb.workspace.supplier_payment_due")}><input type="date" value={form.supplier_payment_due_at} onChange={(e) => setField("supplier_payment_due_at", e.target.value)} className={fieldClass} /></LabeledField>
      <LabeledField label={t("tb.workspace.operational_note")}><input value={form.operational_note} onChange={(e) => setField("operational_note", e.target.value)} placeholder={t("tb.workspace.operational_note_ph")} className={fieldClass} /></LabeledField>
      <button type="button" disabled={saving} onClick={() => onSave(item.id, form)} className="inline-flex h-11 items-center justify-center gap-2 bg-gray-950 px-4 text-sm font-semibold text-white disabled:opacity-40"><Save size={16} />{t("common.save")}</button>
    </div>
    <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.supplier_paid} onChange={(e) => setField("supplier_paid", e.target.checked)} className="h-4 w-4 accent-emerald-600" />{t("tb.workspace.supplier_paid")}</label>
    {packageStatus === "cancelled" && item.supplier_paid && <div className="mt-4 border border-red-200 bg-red-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-bold text-red-900">{t("tb.workspace.supplier_refund")}</div><div className="mt-1 text-xs text-red-700">{t(`tb.workspace.refund_${item.supplier_refund_status || "not_required"}`)}</div></div><div className="text-right"><div className="text-xs text-red-700">{t("tb.workspace.refund_remaining")}</div><div className="font-bold text-red-900">{money(Math.max(0, Number(item.supplier_refund_due_amount || 0) - Number(item.supplier_refunded_amount || 0)), item.currency || currency)}</div></div></div><div className="mt-4 grid gap-3 md:grid-cols-2"><LabeledField label={t("tb.workspace.refund_due_amount")}><input type="number" min="0" max={item.actual_supplier_cost ?? item.provider_price} step="0.01" value={form.supplier_refund_due_amount} onChange={(event) => setField("supplier_refund_due_amount", Math.max(0, Number(event.target.value)))} className={fieldClass} /></LabeledField><LabeledField label={t("tb.workspace.supplier_refunded_amount")}><input type="number" min="0" max={form.supplier_refund_due_amount} step="0.01" value={form.supplier_refunded_amount} onChange={(event) => setField("supplier_refunded_amount", Math.max(0, Number(event.target.value)))} className={fieldClass} /></LabeledField><LabeledField label={t("tb.workspace.refund_due")}><input type="date" value={form.supplier_refund_due_at} onChange={(event) => setField("supplier_refund_due_at", event.target.value)} className={fieldClass} /></LabeledField><LabeledField label={t("tb.workspace.refund_note")}><input maxLength={1000} value={form.supplier_refund_note} onChange={(event) => setField("supplier_refund_note", event.target.value)} className={fieldClass} /></LabeledField></div><div className="mt-3 flex justify-end"><button type="button" disabled={saving} onClick={() => onSaveSupplierRefund(item.id, form)} className="inline-flex h-10 items-center gap-2 bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-40"><Save size={16} />{t("tb.workspace.save_supplier_refund")}</button></div></div>}
    <details className="mt-4 border-t border-gray-200 pt-3"><summary className="cursor-pointer text-sm font-semibold text-gray-700">{t("tb.performance.review_supplier")}{item.quality_rating && item.reliability_rating ? ` · ${((Number(item.quality_rating) + Number(item.reliability_rating)) / 2).toFixed(1)}/5` : ""}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[150px_150px_180px_1fr]"><LabeledField label={t("tb.performance.quality")}><select value={form.quality_rating} onChange={(e) => setField("quality_rating", e.target.value)} className={fieldClass}><option value="">—</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></LabeledField><LabeledField label={t("tb.performance.reliability")}><select value={form.reliability_rating} onChange={(e) => setField("reliability_rating", e.target.value)} className={fieldClass}><option value="">—</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></LabeledField><LabeledField label={t("tb.reconciliation.actual_cost")}><input type="number" min="0" step="0.01" value={form.actual_supplier_cost} onChange={(e) => setField("actual_supplier_cost", e.target.value)} placeholder={String(item.provider_price || 0)} className={fieldClass} /></LabeledField><LabeledField label={t("tb.reconciliation.variance_note")}><input value={form.cost_variance_note} onChange={(e) => setField("cost_variance_note", e.target.value)} placeholder={t("tb.reconciliation.variance_note_ph")} className={fieldClass} /></LabeledField><div className="sm:col-span-2 lg:col-span-4"><LabeledField label={t("tb.performance.note")}><input value={form.performance_note} onChange={(e) => setField("performance_note", e.target.value)} placeholder={t("tb.performance.note_ph")} className={fieldClass} /></LabeledField></div></div></details>
    {["sent", "accepted"].includes(orderStatus) && <div className="mt-4 flex items-end gap-2 border-t border-gray-200 pt-4"><LabeledField label={t("tb.documents.supplier_message")} wide><textarea rows={2} maxLength={1000} value={supplierMessage} onChange={(e) => setSupplierMessage(e.target.value)} placeholder={t("tb.documents.supplier_message_ph")} className="min-h-20 w-full resize-y border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100" /></LabeledField><button type="button" disabled={saving || !supplierMessage.trim()} onClick={async () => { if (await onMessageOrder(item.id, supplierMessage)) setSupplierMessage(""); }} title={t("tb.documents.send_supplier_message")} className="inline-flex h-11 w-11 shrink-0 items-center justify-center bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-40"><Send size={17} /></button></div>}
    {item.service_order_events?.length > 0 && <details className="mt-4 border-t border-gray-200 pt-3"><summary className="cursor-pointer text-sm font-semibold text-gray-600">{t("tb.documents.service_order_history")} · {item.service_order_events.length}</summary><div className="mt-3 space-y-2">{item.service_order_events.map((event) => <div key={event.id} className="flex items-start justify-between gap-4 text-xs"><div><span className={`font-semibold ${["accepted", "message_received", "attachment_received"].includes(event.event_type) ? "text-emerald-700" : ["declined", "cancelled", "delivery_failed"].includes(event.event_type) ? "text-red-700" : "text-gray-700"}`}>{t(`tb.documents.service_order_event_${event.event_type}`)}</span>{["message_sent", "message_received"].includes(event.event_type) && event.metadata?.message && <div className="mt-1 whitespace-pre-wrap text-gray-600">{event.metadata.message}</div>}{event.event_type === "attachment_received" && <div className="mt-1 flex flex-wrap items-center gap-2"><button type="button" onClick={() => openAttachment(packageId, item.id, event.id).catch(() => window.alert(t("tb.documents.attachment_error")))} className="inline-flex items-center gap-1.5 font-semibold text-sky-700 hover:underline"><Paperclip size={14} />{event.metadata?.file_name || t("tb.documents.open_attachment")}<ExternalLink size={12} /></button><select value={event.metadata?.document_type || "other"} onChange={(e) => onClassifyAttachment(item.id, event.id, e.target.value)} className="h-7 border border-gray-300 bg-white px-2 text-xs"><option value="confirmation">{t("tb.documents.attachment_confirmation")}</option><option value="invoice">{t("tb.documents.attachment_invoice")}</option><option value="voucher">{t("tb.documents.attachment_voucher")}</option><option value="other">{t("tb.documents.attachment_other")}</option></select>{event.metadata?.caption && <div className="w-full whitespace-pre-wrap text-gray-600">{event.metadata.caption}</div>}</div>}</div><span className="shrink-0 text-gray-400">{dateTimeText(event.created_at)}</span></div>)}</div></details>}
  </article>;
}

function DepartureReadiness({ checks, percent, t }) {
  const items = ["sale_confirmed", "suppliers_confirmed", "supplier_orders_accepted", "references_complete", "documents_approved", "suppliers_paid", "travelers_complete", "client_paid"];
  return <section className="border-y border-gray-200 py-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-xs font-bold uppercase text-orange-600">{t("tb.operations.eyebrow")}</div><h2 className="mt-1 text-xl font-bold">{t("tb.operations.title")}</h2></div><div className={`text-3xl font-bold ${percent === 100 ? "text-emerald-700" : "text-gray-950"}`}>{percent}%</div></div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200"><div className={`h-full ${percent === 100 ? "bg-emerald-500" : "bg-orange-500"}`} style={{ width: `${percent}%` }} /></div>
    <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">{items.map((key) => <div key={key} className={`flex items-center gap-2 text-sm font-semibold ${checks[key] ? "text-emerald-700" : "text-gray-500"}`}>{checks[key] ? <CheckCircle2 size={17} /> : <CircleDashed size={17} />}<span>{t(`tb.operations.${key}`)}</span></div>)}</div>
  </section>;
}

function OperationsTimeline({ items = [], saving, onClientFollowup, t }) {
  const [followupOpen, setFollowupOpen] = useState(false);
  const [followup, setFollowup] = useState({ channel: "phone", note: "" });
  const tone = { overdue: "border-red-200 bg-red-50 text-red-800", today: "border-orange-200 bg-orange-50 text-orange-800", soon: "border-amber-200 bg-amber-50 text-amber-800", upcoming: "border-gray-200 bg-white text-gray-700" };
  const submitFollowup = async () => {
    if (await onClientFollowup(followup)) {
      setFollowup({ channel: "phone", note: "" });
      setFollowupOpen(false);
    }
  };
  return <section className="border-b border-gray-200 pb-5">
    <div className="flex items-center gap-2"><Clock3 size={20} /><h2 className="text-xl font-bold">{t("tb.action_timeline.title")}</h2></div>
    <p className="mt-1 text-sm text-gray-500">{t("tb.action_timeline.subtitle")}</p>
    <div className="mt-4 space-y-2">{items.map((item, index) => <div key={`${item.type}-${item.booking_id || index}`} className={`flex flex-wrap items-center justify-between gap-3 border px-4 py-3 ${tone[item.urgency] || tone.upcoming}`}><div><div className="font-semibold">{t(`tb.action_timeline.${item.type}`)}{item.label ? ` · ${item.label}` : ""}</div><div className="mt-0.5 text-xs opacity-75">{dateText(item.due_at)}</div></div><div className="flex items-center gap-3"><span className="text-xs font-bold uppercase">{item.urgency === "overdue" ? t("tb.action_timeline.overdue_days", { count: Math.abs(item.days) }) : item.urgency === "today" ? t("tb.action_timeline.today") : t("tb.action_timeline.days_left", { count: item.days })}</span>{item.type === "client_follow_up" && <button type="button" disabled={saving} onClick={() => setFollowupOpen((value) => !value)} className="inline-flex h-8 items-center gap-1.5 bg-white px-3 text-xs font-bold text-gray-950 shadow-sm disabled:opacity-40"><CheckCircle2 size={14} />{t("tb.action_timeline.mark_contacted")}</button>}</div></div>)}
      {!items.length && <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{t("tb.action_timeline.empty")}</div>}
    </div>
    {followupOpen && <div className="mt-3 grid gap-2 border border-sky-200 bg-sky-50 p-3 sm:grid-cols-[150px_1fr_auto]"><select value={followup.channel} onChange={(event) => setFollowup((value) => ({ ...value, channel: event.target.value }))} className={fieldClass}>{["phone", "telegram", "whatsapp", "email", "other"].map((channel) => <option key={channel} value={channel}>{t(`tb.action_timeline.channel_${channel}`)}</option>)}</select><input value={followup.note} maxLength={1000} onChange={(event) => setFollowup((value) => ({ ...value, note: event.target.value }))} placeholder={t("tb.action_timeline.contact_note_ph")} className={fieldClass} /><button type="button" disabled={saving} onClick={submitFollowup} className="h-11 bg-gray-950 px-4 text-sm font-bold text-white disabled:opacity-40">{t("common.save")}</button></div>}
  </section>;
}

function ClientContactHistory({ items = [], t }) {
  if (!items.length) return null;
  return <section className="border-b border-gray-200 pb-5"><h2 className="text-xl font-bold">{t("tb.action_timeline.contact_history")}</h2><div className="mt-3 divide-y border-y border-gray-200">{items.map((item) => <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm"><div><div className="font-semibold">{t(`tb.action_timeline.channel_${item.channel}`)}</div>{item.note && <div className="mt-1 text-gray-600">{item.note}</div>}</div><span className="text-xs text-gray-500">{dateTimeText(item.contacted_at)}</span></div>)}</div></section>;
}

function OperationsTasks({ items = [], saving, onCreate, onToggle, onDelete, t }) {
  const [form, setForm] = useState({ title: "", assigned_to: "", due_at: "", priority: "normal" });
  const submit = async () => {
    if (!form.title.trim()) return;
    if (await onCreate(form)) setForm({ title: "", assigned_to: "", due_at: "", priority: "normal" });
  };
  const priorityTone = { high: "bg-red-50 text-red-700", normal: "bg-sky-50 text-sky-700", low: "bg-gray-100 text-gray-600" };
  return <section className="border-b border-gray-200 pb-5">
    <div className="flex items-center gap-2"><ListTodo size={20} /><h2 className="text-xl font-bold">{t("tb.tasks.title")}</h2></div>
    <p className="mt-1 text-sm text-gray-500">{t("tb.tasks.subtitle")}</p>
    <div className="mt-4 grid gap-2 border border-gray-200 bg-gray-50 p-3 md:grid-cols-[minmax(220px,1fr)_160px_150px_130px_auto]">
      <input value={form.title} onChange={(e) => setForm((value) => ({ ...value, title: e.target.value }))} placeholder={t("tb.tasks.task_ph")} className={fieldClass} />
      <input value={form.assigned_to} onChange={(e) => setForm((value) => ({ ...value, assigned_to: e.target.value }))} placeholder={t("tb.tasks.assignee_ph")} className={fieldClass} />
      <input type="date" value={form.due_at} onChange={(e) => setForm((value) => ({ ...value, due_at: e.target.value }))} className={fieldClass} />
      <select value={form.priority} onChange={(e) => setForm((value) => ({ ...value, priority: e.target.value }))} className={fieldClass}><option value="low">{t("tb.tasks.priority_low")}</option><option value="normal">{t("tb.tasks.priority_normal")}</option><option value="high">{t("tb.tasks.priority_high")}</option></select>
      <button type="button" disabled={saving || !form.title.trim()} onClick={submit} title={t("tb.tasks.add")} className="inline-flex h-11 w-11 items-center justify-center bg-gray-950 text-white disabled:opacity-40"><Plus size={18} /></button>
    </div>
    <div className="mt-3 divide-y border-y border-gray-200">{items.map((item) => {
      const overdue = !item.completed && item.due_at && dateValue(item.due_at) < new Date().toISOString().slice(0, 10);
      const title = item.task_type === "replace_declined_supplier"
        ? t("tb.tasks.replace_declined_supplier", { service: item.service_title || `#${item.booking_id}` })
        : item.task_type === "follow_up_supplier_order"
          ? t("tb.tasks.follow_up_supplier_order", { service: item.service_title || `#${item.booking_id}` })
          : item.task_type === "follow_up_supplier_documents"
            ? t("tb.tasks.follow_up_supplier_documents", { service: item.service_title || `#${item.booking_id}` })
          : item.title;
      return <div key={item.id} className={`flex flex-wrap items-center gap-3 px-2 py-3 ${item.completed ? "opacity-55" : ""}`}><button type="button" onClick={() => onToggle(item)} title={item.completed ? t("tb.tasks.reopen") : t("tb.tasks.complete")} className={item.completed ? "text-emerald-600" : "text-gray-400 hover:text-emerald-600"}>{item.completed ? <CheckCircle2 size={21} /> : <CircleDashed size={21} />}</button><div className="min-w-[220px] flex-1"><div className={`font-semibold ${item.completed ? "line-through" : ""}`}>{title}{item.task_type && <span className="ml-2 bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-700">{t("tb.tasks.automatic")}</span>}</div><div className="mt-0.5 text-xs text-gray-500">{item.assigned_to || t("tb.tasks.unassigned")}{item.due_at ? ` · ${dateText(item.due_at)}` : ""}</div></div><span className={`px-2 py-1 text-xs font-bold ${priorityTone[item.priority] || priorityTone.normal}`}>{t(`tb.tasks.priority_${item.priority || "normal"}`)}</span>{overdue && <span className="text-xs font-bold text-red-700">{t("tb.tasks.overdue")}</span>}<button type="button" onClick={() => onDelete(item.id)} title={t("common.delete")} className="inline-flex h-9 w-9 items-center justify-center text-red-600 hover:bg-red-50"><Trash2 size={16} /></button></div>;
    })}{!items.length && <div className="py-6 text-center text-sm text-gray-500">{t("tb.tasks.empty")}</div>}</div>
  </section>;
}

function SupplierDocumentCenter({ components, packageId, saving, onClassify, onReview, t }) {
  const [filter, setFilter] = useState("all");
  const documents = useMemo(() => components.flatMap((component) => (component.service_order_events || [])
    .filter((event) => event.event_type === "attachment_received")
    .map((event) => ({
      ...event,
      bookingId: component.id,
      serviceTitle: component.service_title,
      providerName: component.provider_name,
    })))
    .sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0)), [components]);
  const counts = useMemo(() => documents.reduce((result, document) => {
    const status = document.metadata?.review_status || "pending";
    result[status] = (result[status] || 0) + 1;
    return result;
  }, { pending: 0, approved: 0, rejected: 0 }), [documents]);
  const visibleDocuments = filter === "all" ? documents : documents.filter((document) => (document.metadata?.review_status || "pending") === filter);
  const statusClass = { pending: "bg-amber-50 text-amber-800", approved: "bg-emerald-50 text-emerald-700", rejected: "bg-red-50 text-red-700" };

  return <section>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h2 className="flex items-center gap-2 text-xl font-bold"><FileText size={20} />{t("tb.documents.center_title")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.documents.center_hint")}</p></div>
      <div className="flex flex-wrap border border-gray-200 bg-gray-50 p-1">
        {["all", "pending", "approved", "rejected"].map((status) => <button key={status} type="button" onClick={() => setFilter(status)} className={`h-9 px-3 text-sm font-semibold ${filter === status ? "bg-gray-950 text-white" : "text-gray-600 hover:bg-white"}`}>{t(`tb.documents.filter_${status}`)} <span className="ml-1 opacity-70">{status === "all" ? documents.length : counts[status]}</span></button>)}
      </div>
    </div>
    <div className="mt-4 divide-y border-y border-gray-200">
      {visibleDocuments.map((document) => {
        const status = document.metadata?.review_status || "pending";
        return <div key={`${document.bookingId}-${document.id}`} className="grid gap-3 py-4 lg:grid-cols-[minmax(220px,1fr)_minmax(180px,0.8fr)_170px_auto] lg:items-center">
          <div className="min-w-0"><button type="button" onClick={() => openAttachment(packageId, document.bookingId, document.id).catch(() => window.alert(t("tb.documents.attachment_error")))} className="inline-flex max-w-full items-center gap-2 font-semibold text-sky-700 hover:underline"><Paperclip size={16} className="shrink-0" /><span className="truncate">{document.metadata?.file_name || t("tb.documents.open_attachment")}</span><ExternalLink size={13} className="shrink-0" /></button><div className="mt-1 text-xs text-gray-500">{dateTimeText(document.created_at)}</div></div>
          <div className="min-w-0"><div className="truncate text-sm font-semibold">{document.providerName || t("tb.documents.provider_missing")}</div><div className="truncate text-xs text-gray-500">{document.serviceTitle || `#${document.bookingId}`}</div></div>
          <select value={document.metadata?.document_type || "other"} onChange={(event) => onClassify(document.bookingId, document.id, event.target.value)} disabled={saving} className="h-10 border border-gray-300 bg-white px-3 text-sm disabled:opacity-50"><option value="confirmation">{t("tb.documents.attachment_confirmation")}</option><option value="invoice">{t("tb.documents.attachment_invoice")}</option><option value="voucher">{t("tb.documents.attachment_voucher")}</option><option value="other">{t("tb.documents.attachment_other")}</option></select>
          <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end"><span className={`px-2 py-1 text-xs font-bold ${statusClass[status]}`}>{t(`tb.documents.attachment_${status}`)}</span>{status === "pending" && <><button type="button" disabled={saving} onClick={() => onReview(document.bookingId, document.id, "approved")} className="inline-flex h-9 items-center gap-1.5 bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={15} />{t("tb.documents.approve_attachment")}</button><button type="button" disabled={saving} onClick={() => onReview(document.bookingId, document.id, "rejected")} className="inline-flex h-9 items-center gap-1.5 border border-red-300 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><X size={15} />{t("tb.documents.reject_attachment")}</button></>}</div>
        </div>;
      })}
      {!visibleDocuments.length && <div className="py-8 text-center text-sm text-gray-500">{documents.length ? t("tb.documents.no_documents_for_filter") : t("tb.documents.no_supplier_documents")}</div>}
    </div>
  </section>;
}

function OperationsIssueCenter({ components, t }) {
  const [filter, setFilter] = useState("all");
  const issues = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const priority = { critical: 0, warning: 1, info: 2 };
    return components.flatMap((component) => {
      const result = [];
      const orderStatus = String(component.service_order_status || "").toLowerCase();
      const attachments = (component.service_order_events || []).filter((event) => event.event_type === "attachment_received");
      const pendingDocuments = attachments.filter((event) => !event.metadata?.review_status || event.metadata.review_status === "pending").length;
      const rejectedDocuments = attachments.filter((event) => event.metadata?.review_status === "rejected").length;
      const approvedDocuments = attachments.filter((event) => event.metadata?.review_status === "approved").length;
      const unreadReplies = (component.service_order_events || []).filter((event) => ["message_received", "attachment_received"].includes(event.event_type) && !event.read_at).length;
      const add = (type, severity, detail = {}) => result.push({ type, severity, component, ...detail });
      if (["declined", "delivery_failed"].includes(orderStatus)) add("supplier_declined", "critical");
      else if (orderStatus === "sent") add("supplier_response", "warning");
      if (confirmedStatuses.has(String(component.status || "").toLowerCase()) && !String(component.confirmation_reference || "").trim()) add("confirmation", "warning");
      if (orderStatus === "accepted" && !approvedDocuments) add("documents_missing", rejectedDocuments ? "critical" : "warning");
      if (pendingDocuments) add("documents_review", "warning", { count: pendingDocuments });
      if (component.supplier_payment_due_at && component.supplier_paid !== true && dateValue(component.supplier_payment_due_at) < today) add("supplier_payment", "critical", { dueAt: component.supplier_payment_due_at });
      if (unreadReplies) add("supplier_reply", "info", { count: unreadReplies });
      return result;
    }).sort((left, right) => priority[left.severity] - priority[right.severity]);
  }, [components]);
  const counts = useMemo(() => issues.reduce((result, issue) => ({ ...result, [issue.severity]: result[issue.severity] + 1 }), { critical: 0, warning: 0, info: 0 }), [issues]);
  const visibleIssues = filter === "all" ? issues : issues.filter((issue) => issue.severity === filter);
  const tone = { critical: "border-red-200 bg-red-50 text-red-800", warning: "border-amber-200 bg-amber-50 text-amber-800", info: "border-sky-200 bg-sky-50 text-sky-800" };
  const focusComponent = (id) => document.getElementById(`component-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  return <section>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="flex items-center gap-2 text-xl font-bold"><AlertTriangle size={20} className={issues.length ? "text-orange-600" : "text-emerald-600"} />{t("tb.issues.title")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.issues.hint")}</p></div>{issues.length > 0 && <div className="flex flex-wrap border border-gray-200 bg-gray-50 p-1">{["all", "critical", "warning", "info"].map((severity) => <button key={severity} type="button" onClick={() => setFilter(severity)} className={`h-9 px-3 text-sm font-semibold ${filter === severity ? "bg-gray-950 text-white" : "text-gray-600 hover:bg-white"}`}>{t(`tb.issues.filter_${severity}`)} <span className="ml-1 opacity-70">{severity === "all" ? issues.length : counts[severity]}</span></button>)}</div>}</div>
    {visibleIssues.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{visibleIssues.map((issue, index) => <button key={`${issue.component.id}-${issue.type}-${index}`} type="button" onClick={() => focusComponent(issue.component.id)} className={`flex min-h-20 items-center justify-between gap-3 border px-4 py-3 text-left hover:brightness-95 ${tone[issue.severity]}`}><div className="min-w-0"><div className="truncate font-bold">{issue.component.service_title || issue.component.provider_name || `#${issue.component.id}`}</div><div className="mt-1 text-sm">{t(`tb.issues.${issue.type}`, { count: issue.count, date: dateText(issue.dueAt) })}</div></div><ExternalLink size={17} className="shrink-0" /></button>)}</div> : <div className="mt-4 flex items-center gap-3 border-y border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-semibold text-emerald-800"><CheckCircle2 size={19} />{t("tb.issues.empty")}</div>}
  </section>;
}

function SupplierPerformanceSummary({ components, t }) {
  const reviewed = components.filter((item) => item.quality_rating && item.reliability_rating);
  if (!reviewed.length) return null;
  const quality = reviewed.reduce((total, item) => total + Number(item.quality_rating), 0) / reviewed.length;
  const reliability = reviewed.reduce((total, item) => total + Number(item.reliability_rating), 0) / reviewed.length;
  const strongest = [...reviewed].sort((left, right) => (Number(right.quality_rating) + Number(right.reliability_rating)) - (Number(left.quality_rating) + Number(left.reliability_rating)))[0];
  return <section className="border-y border-gray-200 py-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-bold">{t("tb.performance.title")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.performance.hint", { reviewed: reviewed.length, total: components.length })}</p></div><div className="flex gap-6 text-right"><div><div className="text-xs uppercase text-gray-400">{t("tb.performance.quality")}</div><div className="text-2xl font-bold">{quality.toFixed(1)}<span className="text-sm text-gray-400">/5</span></div></div><div><div className="text-xs uppercase text-gray-400">{t("tb.performance.reliability")}</div><div className="text-2xl font-bold">{reliability.toFixed(1)}<span className="text-sm text-gray-400">/5</span></div></div></div></div><div className="mt-3 text-sm text-emerald-700"><span className="font-semibold">{t("tb.performance.strongest")}:</span> {strongest.provider_name || strongest.service_title}</div></section>;
}

function FinancialReconciliation({ components, grossTotal, currency, t }) {
  if (!components.some((item) => item.actual_supplier_cost != null)) return null;
  const planned = components.reduce((total, item) => total + Number(item.provider_price || 0), 0);
  const actual = components.reduce((total, item) => total + Number(item.actual_supplier_cost ?? item.provider_price ?? 0), 0);
  const variance = actual - planned;
  const actualMargin = Number(grossTotal || 0) - actual;
  const closed = components.filter((item) => item.actual_supplier_cost != null).length;
  return <section className="border-y border-gray-200 py-5"><div><h2 className="text-xl font-bold">{t("tb.reconciliation.title")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.reconciliation.hint", { closed, total: components.length })}</p></div><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[["planned", planned, ""], ["actual", actual, ""], ["variance", variance, variance > 0 ? "text-red-700" : "text-emerald-700"], ["actual_margin", actualMargin, actualMargin < 0 ? "text-red-700" : "text-emerald-700"]].map(([key, value, tone]) => <div key={key} className="border-l-2 border-gray-200 pl-3"><div className="text-xs font-semibold uppercase text-gray-400">{t(`tb.reconciliation.${key}`)}</div><div className={`mt-1 text-xl font-bold ${tone}`}>{key === "variance" && value > 0 ? "+" : ""}{money(value, currency)}</div></div>)}</div></section>;
}

function IncidentRow({ item, saving, onSave, t }) {
  const [status, setStatus] = useState(item.status || "open");
  const [assignedTo, setAssignedTo] = useState(item.assigned_to || "");
  const [resolution, setResolution] = useState(item.resolution || "");
  const severityTone = { critical: "text-red-700", high: "text-orange-700", medium: "text-amber-700", low: "text-sky-700" };
  return <div className={`border-l-4 py-4 pl-4 ${item.status === "resolved" ? "border-emerald-400 opacity-70" : item.severity === "critical" ? "border-red-500" : "border-amber-400"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-bold">{item.title}</div><div className="mt-1 text-xs text-gray-500">{item.service_title || t("tb.incidents.general")} · {dateTimeText(item.created_at)}</div></div><span className={`text-xs font-bold uppercase ${severityTone[item.severity]}`}>{t(`tb.incidents.severity_${item.severity}`)}</span></div>{item.description && <div className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{item.description}</div>}<div className="mt-3 grid gap-2 sm:grid-cols-[150px_1fr_1.5fr_auto]"><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 border border-gray-300 bg-white px-2 text-sm"><option value="open">{t("tb.incidents.status_open")}</option><option value="monitoring">{t("tb.incidents.status_monitoring")}</option><option value="resolved">{t("tb.incidents.status_resolved")}</option></select><input value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} placeholder={t("tb.incidents.assigned_to")} className="h-10 border border-gray-300 px-3 text-sm" /><input value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder={status === "resolved" ? t("tb.incidents.resolution_required") : t("tb.incidents.resolution")} className="h-10 border border-gray-300 px-3 text-sm" /><button type="button" disabled={saving || (status === "resolved" && !resolution.trim())} onClick={() => onSave(item.id, { status, assigned_to: assignedTo, resolution })} className="inline-flex h-10 items-center justify-center gap-2 bg-gray-950 px-4 text-sm font-semibold text-white disabled:opacity-40"><Save size={15} />{t("common.save")}</button></div></div>;
}

function IncidentJournal({ incidents, components, saving, onCreate, onUpdate, t }) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("active");
  const [form, setForm] = useState({ title: "", description: "", severity: "medium", booking_id: "", assigned_to: "" });
  const visible = incidents.filter((item) => filter === "all" || (filter === "active" ? item.status !== "resolved" : item.status === "resolved"));
  const submit = async () => { if (await onCreate(form)) { setForm({ title: "", description: "", severity: "medium", booking_id: "", assigned_to: "" }); setShowForm(false); } };
  return <section><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-bold">{t("tb.incidents.title")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.incidents.hint")}</p></div><button type="button" onClick={() => setShowForm((value) => !value)} className="inline-flex h-10 items-center gap-2 bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700"><Plus size={16} />{t("tb.incidents.add")}</button></div>{showForm && <div className="mt-4 border-y border-gray-200 bg-gray-50 py-4"><div className="grid gap-3 sm:grid-cols-2"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={t("tb.incidents.title_ph")} className={fieldClass} /><select value={form.booking_id} onChange={(event) => setForm({ ...form, booking_id: event.target.value })} className={fieldClass}><option value="">{t("tb.incidents.general")}</option>{components.map((component) => <option key={component.id} value={component.id}>{component.service_title || component.provider_name || `#${component.id}`}</option>)}</select><select value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })} className={fieldClass}>{["low", "medium", "high", "critical"].map((value) => <option key={value} value={value}>{t(`tb.incidents.severity_${value}`)}</option>)}</select><input value={form.assigned_to} onChange={(event) => setForm({ ...form, assigned_to: event.target.value })} placeholder={t("tb.incidents.assigned_to")} className={fieldClass} /></div><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={t("tb.incidents.description_ph")} rows="3" className="mt-3 w-full border border-gray-300 bg-white px-3 py-2 text-sm" /><div className="mt-3 flex justify-end"><button type="button" disabled={saving || !form.title.trim()} onClick={submit} className="h-10 bg-gray-950 px-5 text-sm font-semibold text-white disabled:opacity-40">{t("tb.incidents.create")}</button></div></div>}<div className="mt-4 flex border-b border-gray-200">{["active", "resolved", "all"].map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={`h-10 border-b-2 px-4 text-sm font-semibold ${filter === value ? "border-orange-600 text-gray-950" : "border-transparent text-gray-500"}`}>{t(`tb.incidents.filter_${value}`)}</button>)}</div><div className="divide-y border-b border-gray-200">{visible.map((item) => <IncidentRow key={item.id} item={item} saving={saving} onSave={onUpdate} t={t} />)}{!visible.length && <div className="py-7 text-center text-sm text-gray-500">{t("tb.incidents.empty")}</div>}</div></section>;
}

export default function TourPackageWorkspace() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [tourPackage, setTourPackage] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [paymentForm, setPaymentForm] = useState({ paid_amount: 0, payment_due_at: "", payment_note: "" });
  const [managerName, setManagerName] = useState("");
  const [travelers, setTravelers] = useState([]);
  const [showCancellation, setShowCancellation] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancellationReasonCode, setCancellationReasonCode] = useState("client_plans");
  const [cancellationInitiator, setCancellationInitiator] = useState("client");
  const [refundForm, setRefundForm] = useState({ refund_due_amount: 0, refunded_amount: 0, refund_due_at: "", refund_note: "" });

  const loadPackage = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data } = await axios.get(`${API_BASE}/api/tour-packages/${id}`, cfg());
      setTourPackage(data); setForm(createForm(data)); setDirty(false);
      setManagerName(data.manager_name || "");
      setPaymentForm({ paid_amount: Number(data.paid_amount || 0), payment_due_at: dateValue(data.payment_due_at), payment_note: data.payment_note || "" });
      setTravelers(Array.isArray(data.travelers) ? data.travelers : []);
      setRefundForm({ refund_due_amount: Number(data.refund_due_amount || 0), refunded_amount: Number(data.refunded_amount || 0), refund_due_at: dateValue(data.refund_due_at), refund_note: data.refund_note || "" });
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.load_error"));
    } finally { setLoading(false); }
  }, [id, t]);

  useEffect(() => { loadPackage(); }, [loadPackage]);

  useEffect(() => {
    if (!tourPackage) return;
    const bookingId = new URLSearchParams(window.location.search).get("component");
    if (!bookingId) return;
    window.setTimeout(() => document.getElementById(`component-${bookingId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
  }, [tourPackage?.id]);

  const hasSupplierConversation = (tourPackage?.components || []).some((item) => ["sent", "accepted"].includes(item.service_order_status));
  useEffect(() => {
    if (!hasSupplierConversation) return undefined;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { data } = await axios.get(`${API_BASE}/api/tour-packages/${id}`, cfg());
        setTourPackage((current) => ({ ...current, components: data.components || [], tasks: data.tasks || [] }));
      } catch {}
    }, 15000);
    return () => window.clearInterval(timer);
  }, [hasSupplierConversation, id]);

  const setField = (name, value) => {
    setForm((current) => ({ ...current, [name]: value })); setDirty(true); setNotice("");
  };
  const setDay = (index, name, value) => setField("itinerary", form.itinerary.map((day, i) => i === index ? { ...day, [name]: value } : day));
  const grossPreview = useMemo(() => {
    const net = Number(tourPackage?.net_total || 0); const markup = Math.max(0, Number(form?.markup_value || 0));
    return form?.markup_type === "fixed" ? net + markup : net * (1 + markup / 100);
  }, [form?.markup_type, form?.markup_value, tourPackage?.net_total]);
  const margin = Number(tourPackage?.gross_total || 0) - Number(tourPackage?.net_total || 0);

  const saveDraft = async (quiet = false) => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.patch(`${API_BASE}/api/tour-packages/${id}`, form, cfg());
      const merged = { ...tourPackage, ...data };
      setTourPackage(merged); setForm(createForm(merged)); setDirty(false);
      if (!quiet) setNotice(t("tb.workspace.saved"));
      return true;
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.save_error")); return false;
    } finally { setSaving(false); }
  };

  const publishRevision = async () => {
    if (!(await saveDraft(true))) return;
    setSaving(true); setError("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/share`, {}, cfg());
      const url = `${window.location.origin}/tour-proposal/${data.token}`;
      await loadPackage(); setShareUrl(url); setEditing(false);
      setNotice(t("tb.workspace.published", { version: data.current_revision }));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.publish_error"));
    } finally { setSaving(false); }
  };

  const confirmSale = async () => {
    setSaving(true); setError(""); setNotice("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/confirm-sale`, {}, cfg());
      setTourPackage((current) => ({ ...current, ...data }));
      setNotice(t("tb.proposal.sale_confirmed", { reference: data.booking_reference }));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.save_error"));
    } finally { setSaving(false); }
  };

  const cancelTour = async () => {
    setSaving(true); setError(""); setNotice("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/cancel`, { reason: cancellationReason, reason_code: cancellationReasonCode, initiator: cancellationInitiator }, cfg());
      setTourPackage((current) => ({
        ...current, ...data,
        components: (current.components || []).map((item) => ["sent", "accepted"].includes(item.service_order_status) ? { ...item, service_order_status: "cancelled", service_order_responded_at: data.cancelled_at } : item),
        tasks: (current.tasks || []).map((item) => item.completed ? item : { ...item, completed: true, completed_at: data.cancelled_at }),
      }));
      setShowCancellation(false); setCancellationReason(""); setCancellationReasonCode("client_plans"); setCancellationInitiator("client");
      setRefundForm({ refund_due_amount: Number(data.refund_due_amount || 0), refunded_amount: Number(data.refunded_amount || 0), refund_due_at: "", refund_note: "" });
      setNotice(data.supplier_notifications_failed
        ? t("tb.workspace.cancellation_saved_with_warnings", { count: data.supplier_notifications_failed })
        : t("tb.workspace.cancellation_saved"));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.cancellation_error"));
    } finally { setSaving(false); }
  };

  const saveRefund = async () => {
    setSaving(true); setError(""); setNotice("");
    try {
      const dueAt = refundForm.refund_due_at ? new Date(`${refundForm.refund_due_at}T23:59:59`).toISOString() : null;
      const { data } = await axios.patch(`${API_BASE}/api/tour-packages/${id}/refund`, { ...refundForm, refund_due_at: dueAt }, cfg());
      setTourPackage((current) => ({ ...current, ...data, refund_events: [data.refund_event, ...(current.refund_events || [])] }));
      setRefundForm({ refund_due_amount: Number(data.refund_due_amount || 0), refunded_amount: Number(data.refunded_amount || 0), refund_due_at: dateValue(data.refund_due_at), refund_note: data.refund_note || "" });
      setNotice(t("tb.workspace.refund_saved"));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.refund_error"));
    } finally { setSaving(false); }
  };

  const savePayment = async () => {
    setSaving(true); setError("");
    try {
      const dueAt = paymentForm.payment_due_at ? new Date(`${paymentForm.payment_due_at}T23:59:59`).toISOString() : null;
      const { data } = await axios.patch(`${API_BASE}/api/tour-packages/${id}/payment`, { ...paymentForm, payment_due_at: dueAt }, cfg());
      setTourPackage((current) => ({ ...current, ...data, payment_events: [{ id: `new-${Date.now()}`, payment_status: data.payment_status, paid_amount: data.paid_amount, payment_due_at: data.payment_due_at, payment_note: data.payment_note, created_at: new Date().toISOString() }, ...(current.payment_events || [])] }));
      setPaymentForm({ paid_amount: Number(data.paid_amount || 0), payment_due_at: dateValue(data.payment_due_at), payment_note: data.payment_note || "" });
      setNotice(t("tb.workspace.payment_saved"));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.payment_error"));
    } finally { setSaving(false); }
  };

  const saveManager = async () => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.patch(`${API_BASE}/api/tour-packages/${id}/manager`, { manager_name: managerName }, cfg());
      setTourPackage((current) => ({ ...current, ...data }));
      setManagerName(data.manager_name || "");
      setNotice(t("tb.workspace.manager_saved"));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.manager_error"));
    } finally { setSaving(false); }
  };

  const recordClientFollowup = async (values) => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/client-followup`, values, cfg());
      setTourPackage((current) => ({ ...current, ...data, client_contacts: [data.contact, ...(current.client_contacts || [])] }));
      setNotice(t("tb.workspace.client_followup_saved"));
      return true;
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.client_followup_error"));
      return false;
    } finally { setSaving(false); }
  };

  const saveTravelers = async () => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.put(`${API_BASE}/api/tour-packages/${id}/travelers`, { travelers }, cfg());
      setTravelers(data.travelers || []); setTourPackage((current) => ({ ...current, travelers: data.travelers || [] }));
      setNotice(t("tb.travelers.saved"));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.travelers.save_error"));
    } finally { setSaving(false); }
  };

  const saveComponentOperations = async (bookingId, values) => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.patch(`${API_BASE}/api/tour-packages/${id}/components/${bookingId}`, values, cfg());
      setTourPackage((current) => ({ ...current, components: (current.components || []).map((item) => Number(item.id) === Number(bookingId) ? { ...item, ...data, service_order_events: data.service_order_event ? [data.service_order_event, ...(item.service_order_events || [])] : item.service_order_events } : item) }));
      setNotice(t("tb.workspace.component_saved"));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.component_save_error"));
    } finally { setSaving(false); }
  };

  const saveSupplierRefund = async (bookingId, values) => {
    setSaving(true); setError(""); setNotice("");
    try {
      const { data } = await axios.patch(`${API_BASE}/api/tour-packages/${id}/components/${bookingId}/refund`, values, cfg());
      setTourPackage((current) => ({ ...current, components: (current.components || []).map((item) => Number(item.id) === Number(bookingId) ? { ...item, ...data, service_order_events: data.service_order_event ? [data.service_order_event, ...(item.service_order_events || [])] : item.service_order_events } : item) }));
      setNotice(t("tb.workspace.supplier_refund_saved"));
    } catch (requestError) { setError(requestError?.response?.data?.message || t("tb.workspace.supplier_refund_error")); }
    finally { setSaving(false); }
  };

  const sendServiceOrder = async (bookingId) => {
    if (!window.confirm(t("tb.documents.send_service_order_confirm"))) return;
    setSaving(true); setError("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/components/${bookingId}/send-service-order`, {}, cfg());
      setTourPackage((current) => ({ ...current, components: (current.components || []).map((item) => Number(item.id) === Number(bookingId) ? { ...item, ...data, service_order_events: data.service_order_event ? [data.service_order_event, ...(item.service_order_events || [])] : item.service_order_events } : item), tasks: (current.tasks || []).map((task) => (data.closed_task_ids || []).includes(task.id) ? { ...task, completed: true, completed_at: new Date().toISOString() } : task) }));
      setNotice(t("tb.documents.service_order_sent_notice"));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.documents.service_order_send_error"));
    } finally { setSaving(false); }
  };

  const sendAllServiceOrders = async () => {
    const targets = (tourPackage?.components || []).filter((item) => !["sent", "accepted"].includes(String(item.service_order_status || "").toLowerCase()));
    if (!targets.length || !window.confirm(t("tb.documents.send_all_service_orders_confirm", { count: targets.length }))) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const results = await Promise.allSettled(targets.map(async (item) => {
        const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/components/${item.id}/send-service-order`, {}, cfg());
        return { bookingId: Number(item.id), data };
      }));
      const successes = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
      const updates = new Map(successes.map((result) => [result.bookingId, result.data]));
      const closedTaskIds = new Set(successes.flatMap((result) => result.data.closed_task_ids || []));
      setTourPackage((current) => ({
        ...current,
        components: (current.components || []).map((item) => {
          const data = updates.get(Number(item.id));
          return data ? { ...item, ...data, service_order_events: data.service_order_event ? [data.service_order_event, ...(item.service_order_events || [])] : item.service_order_events } : item;
        }),
        tasks: (current.tasks || []).map((task) => closedTaskIds.has(task.id) ? { ...task, completed: true, completed_at: new Date().toISOString() } : task),
      }));
      const failed = results.length - successes.length;
      if (successes.length) setNotice(t("tb.documents.send_all_service_orders_result", { sent: successes.length, total: results.length }));
      if (failed) setError(t("tb.documents.send_all_service_orders_failed", { count: failed }));
    } catch {
      setError(t("tb.documents.send_all_service_orders_failed", { count: targets.length }));
    } finally { setSaving(false); }
  };

  const remindServiceOrder = async (bookingId) => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/components/${bookingId}/remind-service-order`, {}, cfg());
      setTourPackage((current) => ({ ...current, components: (current.components || []).map((item) => Number(item.id) === Number(bookingId) ? { ...item, ...data, service_order_events: data.service_order_event ? [data.service_order_event, ...(item.service_order_events || [])] : item.service_order_events } : item) }));
      setNotice(t("tb.documents.reminder_sent"));
    } catch (requestError) {
      setError(requestError?.response?.status === 429 ? t("tb.documents.reminder_cooldown") : requestError?.response?.data?.message || t("tb.documents.reminder_error"));
    } finally { setSaving(false); }
  };

  const requestSupplierDocuments = async (bookingId) => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/components/${bookingId}/request-documents`, {}, cfg());
      setTourPackage((current) => ({ ...current, components: (current.components || []).map((item) => Number(item.id) === Number(bookingId) ? { ...item, service_order_events: data.service_order_event ? [data.service_order_event, ...(item.service_order_events || [])] : item.service_order_events } : item), tasks: data.task ? [data.task, ...(current.tasks || []).filter((task) => !(task.task_type === data.task.task_type && Number(task.booking_id) === Number(data.task.booking_id) && !task.completed))] : current.tasks }));
      setNotice(t("tb.documents.document_request_sent")); return true;
    } catch (requestError) {
      setError(requestError?.response?.status === 429 ? t("tb.documents.document_request_cooldown") : requestError?.response?.data?.message || t("tb.documents.document_request_error")); return false;
    } finally { setSaving(false); }
  };

  const requestAllSupplierDocuments = async () => {
    const targets = (tourPackage?.components || []).filter((item) => item.service_order_status === "accepted" && !(item.service_order_events || []).some((event) => event.event_type === "attachment_received") && !(item.service_order_events || []).some((event) => event.event_type === "document_request_sent" && Date.now() - new Date(event.created_at).getTime() < 60 * 60 * 1000));
    if (!targets.length || !window.confirm(t("tb.documents.request_all_documents_confirm", { count: targets.length }))) return;
    setSaving(true); setError("");
    const results = await Promise.allSettled(targets.map(async (item) => ({ bookingId: item.id, data: (await axios.post(`${API_BASE}/api/tour-packages/${id}/components/${item.id}/request-documents`, {}, cfg())).data })));
    const sent = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    const updates = new Map(sent.map((entry) => [Number(entry.bookingId), entry.data.service_order_event]));
    const tasks = sent.map((entry) => entry.data.task).filter(Boolean);
    setTourPackage((current) => ({ ...current, components: (current.components || []).map((item) => updates.has(Number(item.id)) ? { ...item, service_order_events: [updates.get(Number(item.id)), ...(item.service_order_events || [])] } : item), tasks: [...tasks, ...(current.tasks || []).filter((task) => !tasks.some((fresh) => fresh.task_type === task.task_type && Number(fresh.booking_id) === Number(task.booking_id) && !task.completed))] }));
    setNotice(t("tb.documents.request_all_documents_result", { sent: sent.length, total: targets.length }));
    if (sent.length < targets.length) setError(t("tb.documents.document_request_failed_count", { count: targets.length - sent.length }));
    setSaving(false);
  };

  const cancelServiceOrder = async (bookingId) => {
    if (!window.confirm(t("tb.documents.cancel_service_order_confirm"))) return;
    setSaving(true); setError("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/components/${bookingId}/cancel-service-order`, {}, cfg());
      setTourPackage((current) => ({ ...current, components: (current.components || []).map((item) => Number(item.id) === Number(bookingId) ? { ...item, ...data, service_order_events: data.service_order_event ? [data.service_order_event, ...(item.service_order_events || [])] : item.service_order_events } : item), tasks: (current.tasks || []).map((task) => (data.closed_task_ids || []).includes(task.id) ? { ...task, completed: true, completed_at: new Date().toISOString() } : task) }));
      setNotice(t("tb.documents.service_order_cancelled_notice"));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.documents.service_order_cancel_error"));
    } finally { setSaving(false); }
  };

  const messageServiceOrder = async (bookingId, message) => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/components/${bookingId}/message-service-order`, { message }, cfg());
      setTourPackage((current) => ({ ...current, components: (current.components || []).map((item) => Number(item.id) === Number(bookingId) ? { ...item, service_order_events: data.service_order_event ? [data.service_order_event, ...(item.service_order_events || [])] : item.service_order_events } : item) }));
      setNotice(t("tb.documents.supplier_message_sent")); return true;
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.documents.supplier_message_error")); return false;
    } finally { setSaving(false); }
  };

  const markSupplierMessagesRead = useCallback(async (bookingId) => {
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/components/${bookingId}/read-messages`, {}, cfg());
      if (!data.read) return;
      const readAt = data.read_at || new Date().toISOString();
      setTourPackage((current) => ({ ...current, components: (current.components || []).map((item) => Number(item.id) === Number(bookingId) ? { ...item, service_order_events: (item.service_order_events || []).map((event) => ["message_received", "attachment_received"].includes(event.event_type) && !event.read_at ? { ...event, read_at: readAt } : event) } : item) }));
    } catch {}
  }, [id]);

  const classifyAttachment = async (bookingId, eventId, documentType) => {
    setError("");
    try {
      const { data } = await axios.patch(`${API_BASE}/api/tour-packages/${id}/components/${bookingId}/events/${eventId}/attachment`, { document_type: documentType }, cfg());
      setTourPackage((current) => ({ ...current, components: (current.components || []).map((item) => Number(item.id) === Number(bookingId) ? { ...item, service_order_events: (item.service_order_events || []).map((event) => Number(event.id) === Number(eventId) ? { ...event, metadata: data.metadata } : event) } : item) }));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.documents.attachment_update_error"));
    }
  };

  const reviewAttachment = async (bookingId, eventId, reviewStatus) => {
    setSaving(true); setError("");
    try {
      await axios.post(`${API_BASE}/api/tour-packages/${id}/components/${bookingId}/events/${eventId}/review`, { review_status: reviewStatus }, cfg());
      await loadPackage();
      setNotice(t(reviewStatus === "approved" ? "tb.documents.attachment_approved_notice" : "tb.documents.attachment_rejected_notice"));
    } catch (requestError) { setError(requestError?.response?.data?.message || t("tb.documents.attachment_review_error")); }
    finally { setSaving(false); }
  };

  const createTask = async (values) => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/tasks`, values, cfg());
      setTourPackage((current) => ({ ...current, tasks: [data, ...(current.tasks || [])] }));
      setNotice(t("tb.tasks.created")); return true;
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.tasks.save_error")); return false;
    } finally { setSaving(false); }
  };
  const toggleTask = async (item) => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.patch(`${API_BASE}/api/tour-packages/${id}/tasks/${item.id}`, { ...item, completed: !item.completed }, cfg());
      setTourPackage((current) => ({ ...current, tasks: (current.tasks || []).map((task) => task.id === item.id ? { ...task, ...data } : task) }));
    } catch (requestError) { setError(requestError?.response?.data?.message || t("tb.tasks.save_error")); }
    finally { setSaving(false); }
  };
  const deleteTask = async (taskId) => {
    setSaving(true); setError("");
    try {
      await axios.delete(`${API_BASE}/api/tour-packages/${id}/tasks/${taskId}`, cfg());
      setTourPackage((current) => ({ ...current, tasks: (current.tasks || []).filter((task) => task.id !== taskId) }));
    } catch (requestError) { setError(requestError?.response?.data?.message || t("tb.tasks.delete_error")); }
    finally { setSaving(false); }
  };

  const createIncident = async (values) => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/${id}/incidents`, values, cfg());
      const component = components.find((item) => Number(item.id) === Number(data.booking_id));
      setTourPackage((current) => ({ ...current, incidents: [{ ...data, service_title: component?.service_title }, ...(current.incidents || [])] }));
      setNotice(t("tb.incidents.created")); return true;
    } catch (requestError) { setError(requestError?.response?.data?.message || t("tb.incidents.save_error")); return false; }
    finally { setSaving(false); }
  };
  const updateIncident = async (incidentId, values) => {
    setSaving(true); setError("");
    try {
      const { data } = await axios.patch(`${API_BASE}/api/tour-packages/${id}/incidents/${incidentId}`, values, cfg());
      setTourPackage((current) => ({ ...current, incidents: (current.incidents || []).map((item) => Number(item.id) === Number(incidentId) ? { ...item, ...data } : item) }));
      setNotice(t("tb.incidents.saved"));
    } catch (requestError) { setError(requestError?.response?.data?.message || t("tb.incidents.save_error")); }
    finally { setSaving(false); }
  };

  if (loading) return <main className="mx-auto max-w-7xl p-6 text-gray-500">{t("common.loading")}</main>;
  if (!tourPackage) return <main className="mx-auto max-w-3xl p-6"><div className="border border-red-200 bg-red-50 p-5 text-red-800">{error || t("tb.workspace.load_error")}</div></main>;

  const currency = tourPackage.currency || "UZS";
  const components = Array.isArray(tourPackage.components) ? tourPackage.components : [];
  const canIssueOrders = ["booked", "paid"].includes(String(tourPackage.status));
  const bulkOrderCount = components.filter((item) => !["sent", "accepted"].includes(String(item.service_order_status || "").toLowerCase())).length;
  const missingDocumentCount = components.filter((item) => item.service_order_status === "accepted" && !(item.service_order_events || []).some((event) => event.event_type === "attachment_received")).length;
  const revisions = Array.isArray(tourPackage.revisions) ? tourPackage.revisions : [];
  const confirmed = components.filter((item) => confirmedStatuses.has(String(item.status || "").toLowerCase())).length;
  const readinessPercent = components.length ? Math.round((confirmed / components.length) * 100) : 0;
  const locked = lockedStatuses.has(String(tourPackage.status || "").toLowerCase());
  const paxCount = Number(tourPackage.pax_adult || 0) + Number(tourPackage.pax_child || 0);
  const operationChecks = {
    sale_confirmed: ["booked", "paid"].includes(String(tourPackage.status || "").toLowerCase()),
    suppliers_confirmed: components.length > 0 && confirmed === components.length,
    supplier_orders_accepted: components.length > 0 && components.every((item) => item.service_order_status === "accepted"),
    references_complete: components.length > 0 && components.every((item) => String(item.confirmation_reference || "").trim()),
    documents_approved: components.length > 0 && components.every((item) => (item.service_order_events || []).some((event) => event.event_type === "attachment_received" && event.metadata?.review_status === "approved")),
    suppliers_paid: components.length > 0 && components.every((item) => item.supplier_paid === true),
    travelers_complete: paxCount > 0 && travelers.length === paxCount,
    client_paid: tourPackage.payment_status === "paid",
  };
  const operationPercent = Math.round((Object.values(operationChecks).filter(Boolean).length / Object.keys(operationChecks).length) * 100);
  const operationsTimeline = currentOperationsTimeline(tourPackage, components);
  const clientRefundRemaining = Math.max(0, Number(tourPackage.refund_due_amount || 0) - Number(tourPackage.refunded_amount || 0));
  const supplierRefundRemaining = components.reduce((total, item) => total + Math.max(0, Number(item.supplier_refund_due_amount || 0) - Number(item.supplier_refunded_amount || 0)), 0);
  const cancellationExposure = clientRefundRemaining - supplierRefundRemaining;
  const cancellationSettlementOpen = clientRefundRemaining > 0 || supplierRefundRemaining > 0;
  const clientRetained = Math.max(0, Number(tourPackage.paid_amount || 0) - Number(tourPackage.refund_due_amount || 0));
  const supplierCancellationLoss = components.reduce((total, item) => item.supplier_paid ? total + Math.max(0, Number(item.actual_supplier_cost ?? item.provider_price ?? 0) - Number(item.supplier_refund_due_amount || 0)) : total, 0);
  const cancellationResult = clientRetained - supplierCancellationLoss;

  return <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
    <Link to="/dashboard/bookings" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-950"><ArrowLeft size={17} />{t("tb.workspace.back")}</Link>
    <header className="mt-5 flex flex-wrap items-start justify-between gap-5 border-b border-gray-200 pb-6">
      <div><div className="text-xs font-semibold uppercase text-orange-600">Tour Builder · {t("tb.workspace.package")}</div><h1 className="mt-2 text-3xl font-bold">{tourPackage.title}</h1><div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600"><span className={`rounded-full px-2.5 py-1 font-semibold ring-1 ${tourPackage.status === "lost" ? "bg-red-50 text-red-700 ring-red-200" : tourPackage.status === "accepted" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-sky-50 text-sky-700 ring-sky-200"}`}>{t(`tb.package_status.${tourPackage.status}`, { defaultValue: tourPackage.status })}</span>{tourPackage.booking_reference && <span className="font-mono font-bold">{tourPackage.booking_reference}</span>}<span>{dateText(tourPackage.start_date)} — {dateText(tourPackage.end_date)}</span></div></div>
      <div className="flex flex-wrap items-center gap-3"><div className="mr-2 text-right"><div className="text-xs font-semibold uppercase text-gray-400">GROSS</div><div className="text-3xl font-bold text-emerald-700">{money(tourPackage.gross_total, currency)}</div></div>{["booked", "paid"].includes(String(tourPackage.status)) && <button type="button" onClick={() => setShowCancellation((value) => !value)} className="inline-flex h-11 items-center gap-2 border border-red-200 bg-white px-4 font-semibold text-red-700 hover:bg-red-50"><X size={17} />{t("tb.workspace.cancel_tour")}</button>}{!locked && !editing && <button type="button" onClick={() => setEditing(true)} className="inline-flex h-11 items-center gap-2 border border-gray-300 bg-white px-4 font-semibold hover:bg-gray-50"><Pencil size={17} />{t("tb.workspace.edit")}</button>}</div>
    </header>
    {error && <div className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>}
    {notice && <div className="mt-4 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</div>}
    {shareUrl && <div className="mt-4 flex flex-col gap-2 border border-sky-200 bg-sky-50 p-3 sm:flex-row"><input readOnly value={shareUrl} className="h-10 min-w-0 flex-1 border border-sky-200 bg-white px-3 text-sm" /><button type="button" onClick={async () => { await navigator.clipboard.writeText(shareUrl); setNotice(t("tb.workspace.link_copied")); }} className="inline-flex h-10 items-center justify-center gap-2 bg-gray-950 px-4 text-sm font-semibold text-white"><Copy size={16} />{t("tb.workspace.copy_link")}</button></div>}
    {tourPackage.status === "accepted" && <SaleConversionPanel confirmed={confirmed} total={components.length} saving={saving} onConfirm={confirmSale} t={t} />}
    {showCancellation && <section className="mt-5 grid gap-4 border-x border-t border-red-200 bg-red-50 p-5 sm:grid-cols-2"><label><span className="mb-1.5 block text-sm font-semibold text-red-900">{t("tb.workspace.cancellation_initiator")}</span><select value={cancellationInitiator} onChange={(event) => setCancellationInitiator(event.target.value)} className={fieldClass}>{["client", "supplier", "dmc", "external"].map((value) => <option key={value} value={value}>{t(`tb.workspace.cancellation_initiator_${value}`)}</option>)}</select></label><label><span className="mb-1.5 block text-sm font-semibold text-red-900">{t("tb.workspace.cancellation_reason_type")}</span><select value={cancellationReasonCode} onChange={(event) => setCancellationReasonCode(event.target.value)} className={fieldClass}>{["client_plans", "price", "visa", "flight", "supplier_failure", "force_majeure", "dmc_error", "other"].map((value) => <option key={value} value={value}>{t(`tb.workspace.cancellation_reason_${value}`)}</option>)}</select></label></section>}
    {showCancellation && <section className="mt-5 border border-red-200 bg-red-50 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-red-900">{t("tb.workspace.cancel_title")}</h2><p className="mt-1 text-sm text-red-800">{t("tb.workspace.cancel_hint")}</p></div><button type="button" onClick={() => { setShowCancellation(false); setCancellationReason(""); }} title={t("common.cancel")} className="inline-flex h-9 w-9 items-center justify-center text-red-700 hover:bg-red-100"><X size={18} /></button></div><label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold text-red-900">{t("tb.workspace.cancel_reason")}</span><textarea rows={3} maxLength={1000} value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder={t("tb.workspace.cancel_reason_ph")} className="w-full border border-red-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" /></label><div className="mt-4 flex justify-end"><button type="button" disabled={saving || cancellationReason.trim().length < 5} onClick={cancelTour} className="inline-flex h-11 items-center gap-2 bg-red-700 px-5 font-semibold text-white hover:bg-red-800 disabled:opacity-40"><X size={17} />{t("tb.workspace.confirm_cancel")}</button></div></section>}
    {tourPackage.status === "cancelled" && <section className="mt-5 border border-red-200 bg-red-50 p-5"><div className="flex items-center gap-2 font-bold text-red-900"><X size={18} />{t("tb.workspace.cancelled_title")}</div><div className="mt-2 text-sm text-red-800">{tourPackage.cancellation_reason}</div>{tourPackage.cancelled_at && <div className="mt-2 text-xs font-semibold text-red-700">{t("tb.workspace.cancelled_on")}: {dateTimeText(tourPackage.cancelled_at)}</div>}</section>}
    {tourPackage.status === "cancelled" && <div className="flex flex-wrap gap-2 border-x border-b border-red-200 bg-red-50 px-5 pb-4 text-xs font-semibold text-red-800"><span>{t(`tb.workspace.cancellation_initiator_${tourPackage.cancellation_initiator || "client"}`)}</span><span>·</span><span>{t(`tb.workspace.cancellation_reason_${tourPackage.cancellation_reason_code || "other"}`)}</span></div>}
    {tourPackage.status === "cancelled" && <section className="mt-4 border border-gray-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-semibold uppercase text-gray-400">{t("tb.workspace.cancellation_finance")}</div><div className={`mt-1 font-bold ${cancellationSettlementOpen ? "text-amber-700" : "text-emerald-700"}`}>{t(cancellationSettlementOpen ? "tb.workspace.cancellation_settlement_open" : "tb.workspace.cancellation_settlement_closed")}</div></div><CircleDollarSign size={22} className={cancellationSettlementOpen ? "text-amber-600" : "text-emerald-600"} /></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="border-l-2 border-red-500 pl-3"><div className="text-xs text-gray-500">{t("tb.workspace.client_refund_remaining")}</div><div className="mt-1 font-bold text-red-700">{money(clientRefundRemaining, currency)}</div></div><div className="border-l-2 border-emerald-500 pl-3"><div className="text-xs text-gray-500">{t("tb.workspace.supplier_refund_remaining")}</div><div className="mt-1 font-bold text-emerald-700">{money(supplierRefundRemaining, currency)}</div></div><div className="border-l-2 border-gray-950 pl-3"><div className="text-xs text-gray-500">{t("tb.workspace.net_cancellation_exposure")}</div><div className={`mt-1 font-bold ${cancellationExposure > 0 ? "text-red-700" : "text-gray-950"}`}>{money(cancellationExposure, currency)}</div></div></div></section>}
    {tourPackage.status === "cancelled" && <section className="border-x border-b border-gray-200 bg-gray-50 p-5"><div className="text-xs font-semibold uppercase text-gray-400">{t("tb.workspace.cancellation_result_title")}</div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div><div className="text-xs text-gray-500">{t("tb.workspace.client_cancellation_fee")}</div><div className="mt-1 font-bold">{money(clientRetained, currency)}</div></div><div><div className="text-xs text-gray-500">{t("tb.workspace.nonrecoverable_supplier_cost")}</div><div className="mt-1 font-bold text-red-700">{money(supplierCancellationLoss, currency)}</div></div><div><div className="text-xs text-gray-500">{t("tb.workspace.cancellation_result")}</div><div className={`mt-1 font-bold ${cancellationResult < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(cancellationResult, currency)}</div></div></div></section>}

    {editing && <section className="mt-6 border border-orange-200 bg-orange-50/40 p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold">{t("tb.workspace.edit_title")}</h2><p className="mt-1 text-sm text-gray-600">{t("tb.workspace.edit_hint")}</p></div><button type="button" onClick={() => { setForm(createForm(tourPackage)); setDirty(false); setEditing(false); }} className="inline-flex h-10 items-center gap-2 px-3 text-sm font-semibold text-gray-600"><X size={17} />{t("common.cancel")}</button></div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <LabeledField wide label={t("tb.workspace.tour_name")}><input value={form.title} onChange={(e) => setField("title", e.target.value)} className={fieldClass} /></LabeledField>
        {["client_name", "client_company", "client_phone", "client_email"].map((name) => <LabeledField key={name} label={t(`tb.workspace.${name}`)}><input type={name === "client_email" ? "email" : "text"} value={form[name]} onChange={(e) => setField(name, e.target.value)} className={fieldClass} /></LabeledField>)}
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {["start_date", "end_date", "quote_valid_until"].map((name) => <LabeledField key={name} label={t(`tb.workspace.${name}`)}><input type="date" value={form[name]} onChange={(e) => setField(name, e.target.value)} className={fieldClass} /></LabeledField>)}
        <LabeledField label={t("tb.workspace.adults")}><input type="number" min="0" value={form.pax_adult} onChange={(e) => setField("pax_adult", Math.max(0, Number(e.target.value)))} className={fieldClass} /></LabeledField>
        <LabeledField label={t("tb.workspace.children")}><input type="number" min="0" value={form.pax_child} onChange={(e) => setField("pax_child", Math.max(0, Number(e.target.value)))} className={fieldClass} /></LabeledField>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-[180px_1fr_auto] sm:items-end"><LabeledField label={t("tb.workspace.markup_type")}><select value={form.markup_type} onChange={(e) => setField("markup_type", e.target.value)} className={fieldClass}><option value="percent">%</option><option value="fixed">{currency}</option></select></LabeledField><LabeledField label={t("tb.summary.markup")}><input type="number" min="0" step="0.01" value={form.markup_value} onChange={(e) => setField("markup_value", Math.max(0, Number(e.target.value)))} className={fieldClass} /></LabeledField><div className="h-11 bg-gray-950 px-4 py-1.5 text-right text-white"><div className="text-[10px] uppercase text-gray-400">GROSS</div><div className="font-bold">{money(grossPreview, currency)}</div></div></div>
      <div className="mt-7 border-t border-gray-200 pt-6"><div className="flex items-center justify-between gap-3"><h3 className="font-bold">{t("tb.workspace.program")}</h3><button type="button" onClick={() => setField("itinerary", [...form.itinerary, { day: form.itinerary.length + 1, date: "", city: "", program_text: "" }])} className="inline-flex h-9 items-center gap-2 border border-gray-300 bg-white px-3 text-sm font-semibold"><Plus size={16} />{t("tb.workspace.add_day")}</button></div><div className="mt-3 space-y-3">{form.itinerary.map((day, index) => <div key={`${day.day}-${index}`} className="grid gap-3 border border-gray-200 bg-white p-3 md:grid-cols-[70px_150px_180px_1fr_40px]"><div className="pt-3 text-sm font-bold">{t("tb.workspace.day", { day: index + 1 })}</div><input type="date" value={day.date || ""} onChange={(e) => setDay(index, "date", e.target.value)} className={fieldClass} /><input value={day.city || ""} onChange={(e) => setDay(index, "city", e.target.value)} placeholder={t("tb.workspace.city")} className={fieldClass} /><textarea value={day.program_text || ""} onChange={(e) => setDay(index, "program_text", e.target.value)} placeholder={t("tb.workspace.program_placeholder")} rows="3" className="min-h-20 w-full border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500" /><button type="button" onClick={() => setField("itinerary", form.itinerary.filter((_, i) => i !== index).map((item, i) => ({ ...item, day: i + 1 })))} title={t("common.delete")} className="inline-flex h-10 items-center justify-center text-red-600 hover:bg-red-50"><Trash2 size={17} /></button></div>)}</div></div>
      <div className="mt-6 flex flex-wrap justify-end gap-3"><button type="button" disabled={saving || !dirty} onClick={() => saveDraft(false)} className="inline-flex h-11 items-center gap-2 border border-gray-300 bg-white px-5 font-semibold disabled:opacity-50"><Save size={17} />{t("tb.workspace.save_draft")}</button><button type="button" disabled={saving} onClick={publishRevision} className="inline-flex h-11 items-center gap-2 bg-orange-600 px-5 font-semibold text-white hover:bg-orange-700 disabled:opacity-50"><Send size={17} />{t("tb.workspace.publish_revision")}</button></div>
    </section>}

    <section className="grid border-b border-gray-200 lg:grid-cols-4">{[["NET", money(tourPackage.net_total, currency), ""], [t("tb.summary.markup"), tourPackage.markup_type === "percent" ? `${tourPackage.markup_value}%` : money(tourPackage.markup_value, currency), "text-orange-600"], [t("tb.workspace.margin"), money(margin, currency), "text-emerald-700"], ["PAX", Number(tourPackage.pax_adult || 0) + Number(tourPackage.pax_child || 0), ""]].map(([label, value, color]) => <div key={label} className="border-b border-gray-200 py-5 lg:border-b-0 lg:border-r lg:px-5 first:pl-0 last:border-r-0"><div className="text-xs font-semibold uppercase text-gray-400">{label}</div><div className={`mt-1 text-xl font-bold ${color}`}>{value}</div></div>)}</section>
    <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_340px]"><div className="space-y-8">
      <DepartureReadiness checks={operationChecks} percent={operationPercent} t={t} />
      <OperationsIssueCenter components={components} t={t} />
      <FinancialReconciliation components={components} grossTotal={tourPackage.gross_total} currency={currency} t={t} />
      <SupplierPerformanceSummary components={components} t={t} />
      <OperationsTimeline items={operationsTimeline} saving={saving} onClientFollowup={recordClientFollowup} t={t} />
      <ClientContactHistory items={tourPackage.client_contacts || []} t={t} />
      <OperationsTasks items={tourPackage.tasks} saving={saving} onCreate={createTask} onToggle={toggleTask} onDelete={deleteTask} t={t} />
      <IncidentJournal incidents={tourPackage.incidents || []} components={components} saving={saving} onCreate={createIncident} onUpdate={updateIncident} t={t} />
      <SupplierDocumentCenter components={components} packageId={id} saving={saving} onClassify={classifyAttachment} onReview={reviewAttachment} t={t} />
      <section><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">{t("tb.workspace.components")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.workspace.components_hint")}</p></div><div className="flex flex-wrap items-center gap-3"><span className="text-sm font-semibold text-gray-600">{confirmed}/{components.length}</span>{missingDocumentCount > 0 && <button type="button" disabled={saving} onClick={requestAllSupplierDocuments} className="inline-flex h-10 items-center gap-2 border border-orange-300 bg-white px-4 text-sm font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50"><Paperclip size={16} />{t("tb.documents.request_all_documents", { count: missingDocumentCount })}</button>}{canIssueOrders && bulkOrderCount > 0 && <button type="button" disabled={saving} onClick={sendAllServiceOrders} className="inline-flex h-10 items-center gap-2 bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"><Send size={16} />{t("tb.documents.send_all_service_orders", { count: bulkOrderCount })}</button>}</div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200"><div className="h-full bg-emerald-500" style={{ width: `${readinessPercent}%` }} /></div><div className="mt-4 space-y-3">{components.map((item) => <ComponentOperationsCard key={item.id} item={item} currency={currency} saving={saving} onSave={saveComponentOperations} onSaveSupplierRefund={saveSupplierRefund} onSendOrder={sendServiceOrder} onRemindOrder={remindServiceOrder} onCancelOrder={cancelServiceOrder} onMessageOrder={messageServiceOrder} onMarkRead={markSupplierMessagesRead} onClassifyAttachment={classifyAttachment} onRequestDocuments={requestSupplierDocuments} packageId={id} packageStatus={tourPackage.status} canIssueOrder={canIssueOrders} t={t} />)}{!components.length && <div className="border-y border-gray-200 py-6 text-gray-500">{t("tb.workspace.no_components")}</div>}</div></section>
      <TravelerSection travelers={travelers} setTravelers={setTravelers} capacity={Number(tourPackage.pax_adult || 0) + Number(tourPackage.pax_child || 0)} onSave={saveTravelers} saving={saving} t={t} />
      <section><h2 className="text-xl font-bold">{t("tb.workspace.revisions")}</h2><div className="mt-4 divide-y border-y border-gray-200">{revisions.map((revision) => <div key={revision.version} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-start"><div className="flex items-start gap-3"><Clock3 size={18} className="mt-0.5 text-gray-400" /><div><div className="font-bold">{t("tb.workspace.version", { version: revision.version })}{Number(tourPackage.accepted_revision) === Number(revision.version) ? ` · ${t("tb.workspace.accepted")}` : ""}</div><div className="text-sm text-gray-500">{dateText(revision.created_at)}</div>{revision.response && <div className={`mt-2 inline-flex px-2 py-1 text-xs font-bold ${revision.response === "accepted" ? "bg-emerald-50 text-emerald-700" : revision.response === "declined" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{t(`tb.proposal.response_${revision.response}`)}</div>}{revision.response_reason && <div className="mt-2 text-sm font-semibold text-red-700">{t(`tb.proposal.decline_reason_${revision.response_reason}`)}</div>}{revision.response_message && <div className="mt-2 max-w-2xl whitespace-pre-wrap text-sm text-gray-700">{revision.response_message}</div>}{revision.responded_at && <div className="mt-1 text-xs text-gray-400">{t("tb.workspace.responded_at")}: {dateTimeText(revision.responded_at)}</div>}</div></div><div className="font-bold">{money(revision.gross_total, revision.currency || currency)}</div></div>)}{!revisions.length && <div className="py-6 text-gray-500">{t("tb.workspace.no_revisions")}</div>}</div></section>
    </div><aside className="space-y-5"><section className="border border-gray-200 bg-white p-5"><div className="flex items-center gap-2 text-sm font-semibold uppercase text-gray-400"><BriefcaseBusiness size={17} />{t("tb.workspace.manager")}</div><div className="mt-4 flex gap-2"><input value={managerName} maxLength={120} onChange={(event) => setManagerName(event.target.value)} placeholder={t("tb.workspace.manager_ph")} className={fieldClass} /><button type="button" disabled={saving || managerName.trim() === String(tourPackage.manager_name || "")} onClick={saveManager} title={t("common.save")} className="inline-flex h-11 w-11 shrink-0 items-center justify-center bg-gray-950 text-white disabled:opacity-30"><Save size={16} /></button></div></section><section className="border border-gray-200 bg-white p-5"><div className="flex items-center gap-2 text-sm font-semibold uppercase text-gray-400"><UserRound size={17} />{t("tb.workspace.client")}</div><div className="mt-4 text-lg font-bold">{tourPackage.client_name || t("tb.workspace.client_missing")}</div>{tourPackage.client_company && <div className="text-sm text-gray-600">{tourPackage.client_company}</div>}{tourPackage.client_phone && <div className="mt-4 text-sm">{tourPackage.client_phone}</div>}{tourPackage.client_email && <div className="break-all text-sm">{tourPackage.client_email}</div>}</section><section className="border border-gray-200 bg-white p-5"><div className="flex items-center gap-2 text-sm font-semibold uppercase text-gray-400"><CalendarDays size={17} />{t("tb.workspace.proposal")}</div><div className="mt-4 text-sm text-gray-600">{t("tb.quote_valid_until")}</div><div className="font-bold">{dateText(tourPackage.quote_valid_until)}</div><div className="mt-4 text-sm text-gray-600">{t("tb.workspace.current_version")}</div><div className="font-bold">v{tourPackage.current_revision || 0}</div>{tourPackage.proposal_response && <div className="mt-4 border-l-2 border-orange-500 bg-orange-50 px-3 py-2 text-sm"><div className="font-bold">{t(`tb.proposal.response_${tourPackage.proposal_response}`)}</div>{tourPackage.proposal_response_reason && <div className="mt-1 font-semibold text-red-700">{t(`tb.proposal.decline_reason_${tourPackage.proposal_response_reason}`)}</div>}{tourPackage.proposal_response_message && <div className="mt-1 text-gray-700">{tourPackage.proposal_response_message}</div>}</div>}</section>{["booked", "paid"].includes(String(tourPackage.status)) && <section className="border border-gray-200 bg-white p-5"><div className="flex items-center gap-2 text-sm font-semibold uppercase text-gray-400"><FileText size={17} />{t("tb.documents.title")}</div><div className="mt-4 grid gap-2"><Link to={`/dashboard/tour-packages/${id}/document/operations-sheet`} className="inline-flex h-10 items-center justify-center bg-gray-950 px-3 text-sm font-semibold text-white hover:bg-gray-800">{t("tb.documents.open_operations_sheet")}</Link><Link to={`/dashboard/tour-packages/${id}/document/invoice`} className="inline-flex h-10 items-center justify-center border border-gray-300 bg-white px-3 text-sm font-semibold hover:bg-gray-50">{t("tb.documents.open_invoice")}</Link><Link to={`/dashboard/tour-packages/${id}/document/rooming-list`} className="inline-flex h-10 items-center justify-center border border-gray-300 bg-white px-3 text-sm font-semibold hover:bg-gray-50">{t("tb.documents.open_rooming_list")}</Link>{tourPackage.payment_status === "paid" ? <Link to={`/dashboard/tour-packages/${id}/document/voucher`} className="inline-flex h-10 items-center justify-center bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700">{t("tb.documents.open_voucher")}</Link> : <div className="text-xs text-gray-500">{t("tb.documents.voucher_after_payment")}</div>}</div></section>}{["booked", "paid"].includes(String(tourPackage.status)) && <section className="border border-gray-200 bg-white p-5"><div className="flex items-center gap-2 text-sm font-semibold uppercase text-gray-400"><CreditCard size={17} />{t("tb.workspace.client_payment")}</div><div className="mt-4 flex items-end justify-between gap-3"><div><div className="text-xs text-gray-500">{t("tb.workspace.received")}</div><div className="text-xl font-bold text-emerald-700">{money(tourPackage.paid_amount, currency)}</div></div><span className={`px-2 py-1 text-xs font-bold ${tourPackage.payment_status === "paid" ? "bg-emerald-50 text-emerald-700" : tourPackage.payment_status === "partial" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{t(`tb.workspace.payment_${tourPackage.payment_status || "unpaid"}`)}</span></div><div className="mt-4 space-y-3"><LabeledField label={t("tb.workspace.paid_amount")}><input type="number" min="0" max={tourPackage.gross_total} step="0.01" value={paymentForm.paid_amount} onChange={(e) => setPaymentForm((value) => ({ ...value, paid_amount: Math.max(0, Number(e.target.value)) }))} className={fieldClass} /></LabeledField><LabeledField label={t("tb.workspace.payment_due")}><input type="date" value={paymentForm.payment_due_at} onChange={(e) => setPaymentForm((value) => ({ ...value, payment_due_at: e.target.value }))} className={fieldClass} /></LabeledField><LabeledField label={t("tb.workspace.payment_note")}><textarea rows="3" value={paymentForm.payment_note} onChange={(e) => setPaymentForm((value) => ({ ...value, payment_note: e.target.value }))} className="w-full border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500" /></LabeledField><button type="button" disabled={saving} onClick={savePayment} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-gray-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save size={16} />{t("tb.workspace.save_payment")}</button></div>{tourPackage.payment_events?.length ? <div className="mt-5 border-t border-gray-200 pt-4"><div className="text-xs font-semibold uppercase text-gray-400">{t("tb.workspace.payment_history")}</div><div className="mt-2 space-y-3">{tourPackage.payment_events.slice(0, 5).map((event) => <div key={event.id} className="text-sm"><div className="flex justify-between gap-3"><span className="font-semibold">{money(event.paid_amount, currency)}</span><span className="text-xs text-gray-500">{dateText(event.created_at)}</span></div>{event.payment_note && <div className="mt-1 text-xs text-gray-600">{event.payment_note}</div>}</div>)}</div></div> : null}</section>}{tourPackage.status === "cancelled" && <section className="border border-red-200 bg-white p-5"><div className="flex items-center gap-2 text-sm font-semibold uppercase text-red-700"><CreditCard size={17} />{t("tb.workspace.client_refund")}</div><div className="mt-4 flex items-end justify-between gap-3"><div><div className="text-xs text-gray-500">{t("tb.workspace.refund_remaining")}</div><div className="text-xl font-bold text-red-700">{money(Math.max(0, Number(tourPackage.refund_due_amount || 0) - Number(tourPackage.refunded_amount || 0)), currency)}</div></div><span className={`px-2 py-1 text-xs font-bold ${tourPackage.refund_status === "refunded" || tourPackage.refund_status === "not_required" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{t(`tb.workspace.refund_${tourPackage.refund_status || "not_required"}`)}</span></div><div className="mt-4 space-y-3"><LabeledField label={t("tb.workspace.refund_due_amount")}><input type="number" min="0" max={tourPackage.paid_amount} step="0.01" value={refundForm.refund_due_amount} onChange={(event) => setRefundForm((value) => ({ ...value, refund_due_amount: Math.max(0, Number(event.target.value)), refunded_amount: Math.min(value.refunded_amount, Math.max(0, Number(event.target.value))) }))} className={fieldClass} /></LabeledField><LabeledField label={t("tb.workspace.refunded_amount")}><input type="number" min="0" max={refundForm.refund_due_amount} step="0.01" value={refundForm.refunded_amount} onChange={(event) => setRefundForm((value) => ({ ...value, refunded_amount: Math.max(0, Number(event.target.value)) }))} className={fieldClass} /></LabeledField><LabeledField label={t("tb.workspace.refund_due")}><input type="date" value={refundForm.refund_due_at} onChange={(event) => setRefundForm((value) => ({ ...value, refund_due_at: event.target.value }))} className={fieldClass} /></LabeledField><LabeledField label={t("tb.workspace.refund_note")}><textarea rows="3" maxLength={1000} value={refundForm.refund_note} onChange={(event) => setRefundForm((value) => ({ ...value, refund_note: event.target.value }))} className="w-full border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500" /></LabeledField><button type="button" disabled={saving} onClick={saveRefund} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save size={16} />{t("tb.workspace.save_refund")}</button></div>{tourPackage.refund_events?.length ? <div className="mt-5 border-t border-gray-200 pt-4"><div className="text-xs font-semibold uppercase text-gray-400">{t("tb.workspace.refund_history")}</div><div className="mt-2 space-y-3">{tourPackage.refund_events.slice(0, 5).map((event) => <div key={event.id} className="text-sm"><div className="flex justify-between gap-3"><span className="font-semibold">{money(event.refunded_amount, currency)} / {money(event.refund_due_amount, currency)}</span><span className="text-xs text-gray-500">{dateText(event.created_at)}</span></div>{event.refund_note && <div className="mt-1 text-xs text-gray-600">{event.refund_note}</div>}</div>)}</div></div> : null}</section>}</aside></div>
  </main>;
}
