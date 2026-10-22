import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CalendarDays, CheckCircle2, CircleDashed, Clock3, UserRound } from "lucide-react";
import { Link, useParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const getToken = () => localStorage.getItem("token") || localStorage.getItem("providerToken");
const cfg = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });

const money = (value, currency) => `${Number(value || 0).toLocaleString(currency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 })} ${currency || "UZS"}`;
const dateText = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";
const confirmedStatuses = new Set(["confirmed", "paid", "completed"]);

export default function TourPackageWorkspace() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [tourPackage, setTourPackage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    axios.get(`${API_BASE}/api/tour-packages/${id}`, cfg())
      .then(({ data }) => active && setTourPackage(data))
      .catch((requestError) => active && setError(requestError?.response?.data?.message || t("tb.workspace.load_error")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id, t]);

  const margin = useMemo(() => Number(tourPackage?.gross_total || 0) - Number(tourPackage?.net_total || 0), [tourPackage]);
  if (loading) return <main className="mx-auto max-w-7xl p-6 text-gray-500">{t("common.loading")}</main>;
  if (error || !tourPackage) return <main className="mx-auto max-w-3xl p-6"><div className="border border-red-200 bg-red-50 p-5 text-red-800">{error || t("tb.workspace.load_error")}</div></main>;

  const currency = tourPackage.currency || "UZS";
  const components = Array.isArray(tourPackage.components) ? tourPackage.components : [];
  const revisions = Array.isArray(tourPackage.revisions) ? tourPackage.revisions : [];
  const confirmed = components.filter((item) => confirmedStatuses.has(String(item.status || "").toLowerCase())).length;
  const readinessPercent = components.length ? Math.round((confirmed / components.length) * 100) : 0;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
      <Link to="/dashboard/bookings" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-gray-950"><ArrowLeft size={17} />{t("tb.workspace.back")}</Link>
      <header className="mt-5 flex flex-wrap items-start justify-between gap-5 border-b border-gray-200 pb-6">
        <div>
          <div className="text-xs font-semibold uppercase text-orange-600">Tour Builder · {t("tb.workspace.package")}</div>
          <h1 className="mt-2 text-3xl font-bold text-gray-950">{tourPackage.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <span className="rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 ring-1 ring-sky-200">{t(`tb.package_status.${tourPackage.status}`, { defaultValue: tourPackage.status })}</span>
            {tourPackage.booking_reference ? <span className="font-mono font-bold">{tourPackage.booking_reference}</span> : null}
            <span>{dateText(tourPackage.start_date)} — {dateText(tourPackage.end_date)}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold uppercase text-gray-400">GROSS</div>
          <div className="mt-1 text-3xl font-bold text-emerald-700">{money(tourPackage.gross_total, currency)}</div>
        </div>
      </header>

      <section className="grid border-b border-gray-200 lg:grid-cols-4">
        <div className="border-b border-gray-200 py-5 lg:border-b-0 lg:border-r lg:pr-5"><div className="text-xs font-semibold uppercase text-gray-400">NET</div><div className="mt-1 text-xl font-bold">{money(tourPackage.net_total, currency)}</div></div>
        <div className="border-b border-gray-200 py-5 lg:border-b-0 lg:border-r lg:px-5"><div className="text-xs font-semibold uppercase text-gray-400">{t("tb.summary.markup")}</div><div className="mt-1 text-xl font-bold text-orange-600">{tourPackage.markup_type === "percent" ? `${tourPackage.markup_value}%` : money(tourPackage.markup_value, currency)}</div></div>
        <div className="border-b border-gray-200 py-5 lg:border-b-0 lg:border-r lg:px-5"><div className="text-xs font-semibold uppercase text-gray-400">{t("tb.workspace.margin")}</div><div className="mt-1 text-xl font-bold text-emerald-700">{money(margin, currency)}</div></div>
        <div className="py-5 lg:pl-5"><div className="text-xs font-semibold uppercase text-gray-400">PAX</div><div className="mt-1 text-xl font-bold">{Number(tourPackage.pax_adult || 0) + Number(tourPackage.pax_child || 0)}</div></div>
      </section>

      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          <section>
            <div className="flex items-center justify-between gap-4"><h2 className="text-xl font-bold text-gray-950">{t("tb.workspace.components")}</h2><span className="text-sm font-semibold text-gray-600">{confirmed}/{components.length}</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200"><div className="h-full bg-emerald-500" style={{ width: `${readinessPercent}%` }} /></div>
            <div className="mt-4 divide-y border-y border-gray-200">
              {components.map((item) => {
                const ready = confirmedStatuses.has(String(item.status || "").toLowerCase());
                return <div key={item.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><div className="font-bold text-gray-950">{item.provider_name || t("tb.workspace.supplier")}</div><div className="mt-1 text-sm text-gray-500">{item.provider_type || "—"} · #{item.id}</div></div><div className="font-semibold text-gray-800">{money(item.provider_price, item.currency || currency)}</div><span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${ready ? "text-emerald-700" : "text-amber-700"}`}>{ready ? <CheckCircle2 size={17} /> : <CircleDashed size={17} />}{item.status}</span></div>;
              })}
              {!components.length ? <div className="py-6 text-gray-500">{t("tb.workspace.no_components")}</div> : null}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-950">{t("tb.workspace.revisions")}</h2>
            <div className="mt-4 divide-y border-y border-gray-200">
              {revisions.map((revision) => <div key={revision.version} className="flex flex-wrap items-center justify-between gap-4 py-4"><div className="flex items-center gap-3"><Clock3 size={18} className="text-gray-400" /><div><div className="font-bold">{t("tb.workspace.version", { version: revision.version })}{Number(tourPackage.accepted_revision) === Number(revision.version) ? ` · ${t("tb.workspace.accepted")}` : ""}</div><div className="text-sm text-gray-500">{dateText(revision.created_at)}</div></div></div><div className="font-bold">{money(revision.gross_total, revision.currency || currency)}</div></div>)}
              {!revisions.length ? <div className="py-6 text-gray-500">{t("tb.workspace.no_revisions")}</div> : null}
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <section className="border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase text-gray-400"><UserRound size={17} />{t("tb.workspace.client")}</div>
            <div className="mt-4 text-lg font-bold text-gray-950">{tourPackage.client_name || t("tb.workspace.client_missing")}</div>
            {tourPackage.client_company ? <div className="mt-1 text-sm text-gray-600">{tourPackage.client_company}</div> : null}
            {tourPackage.client_phone ? <div className="mt-4 text-sm text-gray-700">{tourPackage.client_phone}</div> : null}
            {tourPackage.client_email ? <div className="mt-1 break-all text-sm text-gray-700">{tourPackage.client_email}</div> : null}
          </section>
          <section className="border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold uppercase text-gray-400"><CalendarDays size={17} />{t("tb.workspace.proposal")}</div>
            <div className="mt-4 text-sm text-gray-600">{t("tb.quote_valid_until")}</div><div className="font-bold">{dateText(tourPackage.quote_valid_until)}</div>
            <div className="mt-4 text-sm text-gray-600">{t("tb.workspace.current_version")}</div><div className="font-bold">v{tourPackage.current_revision || 0}</div>
            {tourPackage.proposal_response ? <div className="mt-4 border-l-2 border-orange-500 bg-orange-50 px-3 py-2 text-sm"><div className="font-bold">{t(`tb.proposal.response_${tourPackage.proposal_response}`)}</div>{tourPackage.proposal_response_message ? <div className="mt-1 text-gray-700">{tourPackage.proposal_response_message}</div> : null}</div> : null}
          </section>
        </aside>
      </div>
    </main>
  );
}
