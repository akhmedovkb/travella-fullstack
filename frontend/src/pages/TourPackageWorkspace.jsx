import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CalendarDays, CheckCircle2, CircleDashed, Clock3, Copy, CreditCard, FileText, Pencil, Plus, Save, Send, Trash2, UserRound, Users, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const cfg = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("token") || localStorage.getItem("providerToken")}` } });
const money = (value, currency) => `${Number(value || 0).toLocaleString(currency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} ${currency || "UZS"}`;
const dateText = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";
const dateValue = (value) => value ? String(value).slice(0, 10) : "";
const confirmedStatuses = new Set(["confirmed", "paid", "completed"]);
const lockedStatuses = new Set(["booked", "paid", "cancelled"]);
const fieldClass = "h-11 w-full border border-gray-300 bg-white px-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100";

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

function ComponentOperationsCard({ item, currency, saving, onSave, t }) {
  const [form, setForm] = useState({
    confirmation_reference: item.confirmation_reference || "",
    supplier_payment_due_at: dateValue(item.supplier_payment_due_at),
    supplier_paid: Boolean(item.supplier_paid),
    operational_note: item.operational_note || "",
  });
  const ready = confirmedStatuses.has(String(item.status || "").toLowerCase());
  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  return <article className="border border-gray-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="font-bold">{item.service_title || item.provider_name || t("tb.workspace.supplier")}</div>
        <div className="mt-1 text-sm text-gray-500">{item.provider_name || t("tb.workspace.supplier")} · #{item.id}{item.date ? ` · ${dateText(item.date)}` : ""}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {item.provider_phone && <a href={`tel:${item.provider_phone}`} className="font-semibold text-sky-700 hover:underline">{item.provider_phone}</a>}
          {item.provider_telegram && <span className="text-gray-600">{item.provider_telegram}</span>}
        </div>
      </div>
      <div className="text-right"><div className="font-bold">{money(item.provider_price, item.currency || currency)}</div><span className={`mt-1 inline-flex items-center gap-1.5 text-sm font-semibold ${ready ? "text-emerald-700" : "text-amber-700"}`}>{ready ? <CheckCircle2 size={17} /> : <CircleDashed size={17} />}{item.status}</span></div>
    </div>
    {item.provider_note && <div className="mt-3 border-l-2 border-sky-300 bg-sky-50 px-3 py-2 text-sm text-gray-700"><span className="font-semibold">{t("tb.workspace.supplier_note")}:</span> {item.provider_note}</div>}
    <div className="mt-4 grid gap-3 border-t border-gray-200 pt-4 md:grid-cols-[1fr_180px_1.5fr_auto] md:items-end">
      <LabeledField label={t("tb.workspace.confirmation_reference")}><input value={form.confirmation_reference} onChange={(e) => setField("confirmation_reference", e.target.value)} placeholder={t("tb.workspace.confirmation_reference_ph")} className={fieldClass} /></LabeledField>
      <LabeledField label={t("tb.workspace.supplier_payment_due")}><input type="date" value={form.supplier_payment_due_at} onChange={(e) => setField("supplier_payment_due_at", e.target.value)} className={fieldClass} /></LabeledField>
      <LabeledField label={t("tb.workspace.operational_note")}><input value={form.operational_note} onChange={(e) => setField("operational_note", e.target.value)} placeholder={t("tb.workspace.operational_note_ph")} className={fieldClass} /></LabeledField>
      <button type="button" disabled={saving} onClick={() => onSave(item.id, form)} className="inline-flex h-11 items-center justify-center gap-2 bg-gray-950 px-4 text-sm font-semibold text-white disabled:opacity-40"><Save size={16} />{t("common.save")}</button>
    </div>
    <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.supplier_paid} onChange={(e) => setField("supplier_paid", e.target.checked)} className="h-4 w-4 accent-emerald-600" />{t("tb.workspace.supplier_paid")}</label>
  </article>;
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
  const [travelers, setTravelers] = useState([]);

  const loadPackage = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data } = await axios.get(`${API_BASE}/api/tour-packages/${id}`, cfg());
      setTourPackage(data); setForm(createForm(data)); setDirty(false);
      setPaymentForm({ paid_amount: Number(data.paid_amount || 0), payment_due_at: dateValue(data.payment_due_at), payment_note: data.payment_note || "" });
      setTravelers(Array.isArray(data.travelers) ? data.travelers : []);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.load_error"));
    } finally { setLoading(false); }
  }, [id, t]);

  useEffect(() => { loadPackage(); }, [loadPackage]);

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
      setTourPackage((current) => ({ ...current, components: (current.components || []).map((item) => Number(item.id) === Number(bookingId) ? { ...item, ...data } : item) }));
      setNotice(t("tb.workspace.component_saved"));
    } catch (requestError) {
      setError(requestError?.response?.data?.message || t("tb.workspace.component_save_error"));
    } finally { setSaving(false); }
  };

  if (loading) return <main className="mx-auto max-w-7xl p-6 text-gray-500">{t("common.loading")}</main>;
  if (!tourPackage) return <main className="mx-auto max-w-3xl p-6"><div className="border border-red-200 bg-red-50 p-5 text-red-800">{error || t("tb.workspace.load_error")}</div></main>;

  const currency = tourPackage.currency || "UZS";
  const components = Array.isArray(tourPackage.components) ? tourPackage.components : [];
  const revisions = Array.isArray(tourPackage.revisions) ? tourPackage.revisions : [];
  const confirmed = components.filter((item) => confirmedStatuses.has(String(item.status || "").toLowerCase())).length;
  const readinessPercent = components.length ? Math.round((confirmed / components.length) * 100) : 0;
  const locked = lockedStatuses.has(String(tourPackage.status || "").toLowerCase());

  return <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
    <Link to="/dashboard/bookings" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-950"><ArrowLeft size={17} />{t("tb.workspace.back")}</Link>
    <header className="mt-5 flex flex-wrap items-start justify-between gap-5 border-b border-gray-200 pb-6">
      <div><div className="text-xs font-semibold uppercase text-orange-600">Tour Builder · {t("tb.workspace.package")}</div><h1 className="mt-2 text-3xl font-bold">{tourPackage.title}</h1><div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600"><span className="rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 ring-1 ring-sky-200">{t(`tb.package_status.${tourPackage.status}`, { defaultValue: tourPackage.status })}</span>{tourPackage.booking_reference && <span className="font-mono font-bold">{tourPackage.booking_reference}</span>}<span>{dateText(tourPackage.start_date)} — {dateText(tourPackage.end_date)}</span></div></div>
      <div className="flex flex-wrap items-center gap-3"><div className="mr-2 text-right"><div className="text-xs font-semibold uppercase text-gray-400">GROSS</div><div className="text-3xl font-bold text-emerald-700">{money(tourPackage.gross_total, currency)}</div></div>{!locked && !editing && <button type="button" onClick={() => setEditing(true)} className="inline-flex h-11 items-center gap-2 border border-gray-300 bg-white px-4 font-semibold hover:bg-gray-50"><Pencil size={17} />{t("tb.workspace.edit")}</button>}</div>
    </header>
    {error && <div className="mt-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>}
    {notice && <div className="mt-4 border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</div>}
    {shareUrl && <div className="mt-4 flex flex-col gap-2 border border-sky-200 bg-sky-50 p-3 sm:flex-row"><input readOnly value={shareUrl} className="h-10 min-w-0 flex-1 border border-sky-200 bg-white px-3 text-sm" /><button type="button" onClick={async () => { await navigator.clipboard.writeText(shareUrl); setNotice(t("tb.workspace.link_copied")); }} className="inline-flex h-10 items-center justify-center gap-2 bg-gray-950 px-4 text-sm font-semibold text-white"><Copy size={16} />{t("tb.workspace.copy_link")}</button></div>}

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
      <section><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">{t("tb.workspace.components")}</h2><p className="mt-1 text-sm text-gray-500">{t("tb.workspace.components_hint")}</p></div><span className="text-sm font-semibold text-gray-600">{confirmed}/{components.length}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200"><div className="h-full bg-emerald-500" style={{ width: `${readinessPercent}%` }} /></div><div className="mt-4 space-y-3">{components.map((item) => <ComponentOperationsCard key={item.id} item={item} currency={currency} saving={saving} onSave={saveComponentOperations} t={t} />)}{!components.length && <div className="border-y border-gray-200 py-6 text-gray-500">{t("tb.workspace.no_components")}</div>}</div></section>
      <TravelerSection travelers={travelers} setTravelers={setTravelers} capacity={Number(tourPackage.pax_adult || 0) + Number(tourPackage.pax_child || 0)} onSave={saveTravelers} saving={saving} t={t} />
      <section><h2 className="text-xl font-bold">{t("tb.workspace.revisions")}</h2><div className="mt-4 divide-y border-y border-gray-200">{revisions.map((revision) => <div key={revision.version} className="flex items-center justify-between gap-4 py-4"><div className="flex items-center gap-3"><Clock3 size={18} className="text-gray-400" /><div><div className="font-bold">{t("tb.workspace.version", { version: revision.version })}{Number(tourPackage.accepted_revision) === Number(revision.version) ? ` · ${t("tb.workspace.accepted")}` : ""}</div><div className="text-sm text-gray-500">{dateText(revision.created_at)}</div></div></div><div className="font-bold">{money(revision.gross_total, revision.currency || currency)}</div></div>)}{!revisions.length && <div className="py-6 text-gray-500">{t("tb.workspace.no_revisions")}</div>}</div></section>
    </div><aside className="space-y-5"><section className="border border-gray-200 bg-white p-5"><div className="flex items-center gap-2 text-sm font-semibold uppercase text-gray-400"><UserRound size={17} />{t("tb.workspace.client")}</div><div className="mt-4 text-lg font-bold">{tourPackage.client_name || t("tb.workspace.client_missing")}</div>{tourPackage.client_company && <div className="text-sm text-gray-600">{tourPackage.client_company}</div>}{tourPackage.client_phone && <div className="mt-4 text-sm">{tourPackage.client_phone}</div>}{tourPackage.client_email && <div className="break-all text-sm">{tourPackage.client_email}</div>}</section><section className="border border-gray-200 bg-white p-5"><div className="flex items-center gap-2 text-sm font-semibold uppercase text-gray-400"><CalendarDays size={17} />{t("tb.workspace.proposal")}</div><div className="mt-4 text-sm text-gray-600">{t("tb.quote_valid_until")}</div><div className="font-bold">{dateText(tourPackage.quote_valid_until)}</div><div className="mt-4 text-sm text-gray-600">{t("tb.workspace.current_version")}</div><div className="font-bold">v{tourPackage.current_revision || 0}</div>{tourPackage.proposal_response && <div className="mt-4 border-l-2 border-orange-500 bg-orange-50 px-3 py-2 text-sm"><div className="font-bold">{t(`tb.proposal.response_${tourPackage.proposal_response}`)}</div>{tourPackage.proposal_response_message && <div className="mt-1 text-gray-700">{tourPackage.proposal_response_message}</div>}</div>}</section>{["booked", "paid"].includes(String(tourPackage.status)) && <section className="border border-gray-200 bg-white p-5"><div className="flex items-center gap-2 text-sm font-semibold uppercase text-gray-400"><FileText size={17} />{t("tb.documents.title")}</div><div className="mt-4 grid gap-2"><Link to={`/dashboard/tour-packages/${id}/document/invoice`} className="inline-flex h-10 items-center justify-center border border-gray-300 bg-white px-3 text-sm font-semibold hover:bg-gray-50">{t("tb.documents.open_invoice")}</Link><Link to={`/dashboard/tour-packages/${id}/document/rooming-list`} className="inline-flex h-10 items-center justify-center border border-gray-300 bg-white px-3 text-sm font-semibold hover:bg-gray-50">{t("tb.documents.open_rooming_list")}</Link>{tourPackage.payment_status === "paid" ? <Link to={`/dashboard/tour-packages/${id}/document/voucher`} className="inline-flex h-10 items-center justify-center bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700">{t("tb.documents.open_voucher")}</Link> : <div className="text-xs text-gray-500">{t("tb.documents.voucher_after_payment")}</div>}</div></section>}{["booked", "paid"].includes(String(tourPackage.status)) && <section className="border border-gray-200 bg-white p-5"><div className="flex items-center gap-2 text-sm font-semibold uppercase text-gray-400"><CreditCard size={17} />{t("tb.workspace.client_payment")}</div><div className="mt-4 flex items-end justify-between gap-3"><div><div className="text-xs text-gray-500">{t("tb.workspace.received")}</div><div className="text-xl font-bold text-emerald-700">{money(tourPackage.paid_amount, currency)}</div></div><span className={`px-2 py-1 text-xs font-bold ${tourPackage.payment_status === "paid" ? "bg-emerald-50 text-emerald-700" : tourPackage.payment_status === "partial" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{t(`tb.workspace.payment_${tourPackage.payment_status || "unpaid"}`)}</span></div><div className="mt-4 space-y-3"><LabeledField label={t("tb.workspace.paid_amount")}><input type="number" min="0" max={tourPackage.gross_total} step="0.01" value={paymentForm.paid_amount} onChange={(e) => setPaymentForm((value) => ({ ...value, paid_amount: Math.max(0, Number(e.target.value)) }))} className={fieldClass} /></LabeledField><LabeledField label={t("tb.workspace.payment_due")}><input type="date" value={paymentForm.payment_due_at} onChange={(e) => setPaymentForm((value) => ({ ...value, payment_due_at: e.target.value }))} className={fieldClass} /></LabeledField><LabeledField label={t("tb.workspace.payment_note")}><textarea rows="3" value={paymentForm.payment_note} onChange={(e) => setPaymentForm((value) => ({ ...value, payment_note: e.target.value }))} className="w-full border border-gray-300 px-3 py-2 text-sm outline-none focus:border-orange-500" /></LabeledField><button type="button" disabled={saving} onClick={savePayment} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-gray-950 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save size={16} />{t("tb.workspace.save_payment")}</button></div>{tourPackage.payment_events?.length ? <div className="mt-5 border-t border-gray-200 pt-4"><div className="text-xs font-semibold uppercase text-gray-400">{t("tb.workspace.payment_history")}</div><div className="mt-2 space-y-3">{tourPackage.payment_events.slice(0, 5).map((event) => <div key={event.id} className="text-sm"><div className="flex justify-between gap-3"><span className="font-semibold">{money(event.paid_amount, currency)}</span><span className="text-xs text-gray-500">{dateText(event.created_at)}</span></div>{event.payment_note && <div className="mt-1 text-xs text-gray-600">{event.payment_note}</div>}</div>)}</div></div> : null}</section>}</aside></div>
  </main>;
}
