import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { CalendarDays, MapPin, Printer, Users } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

const dateValue = (value, language) => {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString(language, { day: "numeric", month: "long", year: "numeric" });
};

const localizedProgram = (row, language) => {
  const code = String(language || "ru").split("-")[0];
  return row?.program_i18n?.[code] || row?.program_text || row?.program_i18n?.ru || row?.program_i18n?.en || "";
};

export default function TourProposal() {
  const { t, i18n } = useTranslation();
  const [proposal, setProposal] = useState(null);
  const [state, setState] = useState("loading");
  const token = window.location.pathname.split("/").filter(Boolean).pop();
  const language = i18n.resolvedLanguage || i18n.language || "ru";

  useEffect(() => {
    let active = true;
    axios.get(`${API_BASE}/api/tour-packages/public/${encodeURIComponent(token)}`)
      .then(({ data }) => {
        if (!active) return;
        setProposal(data);
        setState("ready");
      })
      .catch(() => active && setState("error"));
    return () => { active = false; };
  }, [token]);

  const routeLabel = useMemo(() => {
    const route = proposal?.route || {};
    return [route.from, route.to].filter(Boolean).join(" — ") || proposal?.title || "";
  }, [proposal]);

  if (state === "loading") {
    return <main className="min-h-[70vh] bg-gray-50 px-4 py-16 text-center text-gray-500">{t("tb.proposal.loading")}</main>;
  }
  if (state === "error" || !proposal) {
    return (
      <main className="min-h-[70vh] bg-gray-50 px-4 py-16">
        <div className="mx-auto max-w-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-gray-950">{t("tb.proposal.unavailable_title")}</h1>
          <p className="mt-3 text-gray-600">{t("tb.proposal.unavailable_text")}</p>
        </div>
      </main>
    );
  }

  const totalGuests = Number(proposal.pax_adult || 0) + Number(proposal.pax_child || 0);
  const amount = Number(proposal.gross_total || 0).toLocaleString(proposal.currency === "USD" ? "en-US" : "ru-RU", { maximumFractionDigits: 2 });
  const itinerary = Array.isArray(proposal.itinerary) ? proposal.itinerary : [];

  return (
    <main className="proposal-page min-h-screen bg-gray-100 px-4 py-8 sm:px-6 lg:py-12">
      <style>{`@media print { header:not(.proposal-cover), footer:not(.proposal-footer), .proposal-actions { display:none!important } .proposal-page { padding:0!important; background:white!important } .proposal-sheet { box-shadow:none!important; border:0!important; max-width:none!important } @page { margin:14mm } }`}</style>
      <article className="proposal-sheet mx-auto max-w-5xl overflow-hidden border border-gray-200 bg-white shadow-sm">
        <header className="proposal-cover bg-gray-950 px-6 py-8 text-white sm:px-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="text-sm font-semibold uppercase text-orange-400">{t("tb.proposal.label")}</div>
              <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{proposal.title}</h1>
              {proposal.client_name ? <p className="mt-3 text-gray-300">{t("tb.proposal.prepared_for", { name: proposal.client_name })}</p> : null}
            </div>
            <button type="button" onClick={() => window.print()} className="proposal-actions inline-flex h-11 items-center gap-2 border border-gray-600 px-4 font-semibold hover:bg-gray-800">
              <Printer size={18} /> {t("tb.proposal.print")}
            </button>
          </div>
        </header>

        <section className="grid border-b border-gray-200 sm:grid-cols-3">
          <div className="border-b border-gray-200 p-6 sm:border-b-0 sm:border-r">
            <CalendarDays className="text-orange-600" size={22} />
            <div className="mt-3 text-xs font-semibold uppercase text-gray-400">{t("tb.proposal.dates")}</div>
            <div className="mt-1 font-bold text-gray-950">{dateValue(proposal.start_date, language)}<br />{dateValue(proposal.end_date, language)}</div>
          </div>
          <div className="border-b border-gray-200 p-6 sm:border-b-0 sm:border-r">
            <MapPin className="text-orange-600" size={22} />
            <div className="mt-3 text-xs font-semibold uppercase text-gray-400">{t("tb.proposal.route")}</div>
            <div className="mt-1 font-bold text-gray-950">{routeLabel}</div>
          </div>
          <div className="p-6">
            <Users className="text-orange-600" size={22} />
            <div className="mt-3 text-xs font-semibold uppercase text-gray-400">{t("tb.proposal.guests")}</div>
            <div className="mt-1 font-bold text-gray-950">{totalGuests} · {t("tb.proposal.adults", { count: proposal.pax_adult })}, {t("tb.proposal.children", { count: proposal.pax_child })}</div>
          </div>
        </section>

        <section className="px-6 py-8 sm:px-10">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 pb-6">
            <div>
              <div className="text-sm font-semibold uppercase text-gray-500">{t("tb.proposal.total_price")}</div>
              <div className="mt-1 text-4xl font-bold text-gray-950">{amount} <span className="text-xl">{proposal.currency}</span></div>
              <div className="mt-2 text-sm text-gray-500">{t("tb.proposal.group_price")}</div>
            </div>
            {proposal.quote_valid_until ? <div className="text-sm text-gray-600">{t("tb.quote_valid_until")} <strong>{dateValue(proposal.quote_valid_until, language)}</strong></div> : null}
          </div>

          <h2 className="mt-8 text-2xl font-bold text-gray-950">{t("tb.proposal.itinerary")}</h2>
          <div className="mt-5 space-y-0">
            {itinerary.map((row, index) => (
              <div key={`${row.date}-${index}`} className="grid gap-4 border-t border-gray-200 py-6 sm:grid-cols-[110px_1fr]">
                <div>
                  <div className="text-sm font-bold uppercase text-orange-600">{t("tb.proposal.day", { count: row.day || index + 1 })}</div>
                  <div className="mt-1 text-sm text-gray-500">{dateValue(row.date, language)}</div>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-950">{row.city || routeLabel}</h3>
                  <p className="mt-2 whitespace-pre-line leading-7 text-gray-700">{localizedProgram(row, language) || t("tb.proposal.program_pending")}</p>
                </div>
              </div>
            ))}
            {!itinerary.length ? <p className="border-t border-gray-200 py-6 text-gray-500">{t("tb.proposal.program_pending")}</p> : null}
          </div>
        </section>

        <footer className="proposal-footer flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 bg-gray-50 px-6 py-6 sm:px-10">
          <div>
            <div className="font-bold text-gray-950">{proposal.agency?.name}</div>
            <div className="mt-1 text-sm text-gray-600">{t("tb.proposal.agency_contact")}</div>
          </div>
          <div className="text-right text-sm text-gray-700">
            {proposal.agency?.phone ? <div>{proposal.agency.phone}</div> : null}
            {proposal.agency?.email ? <div>{proposal.agency.email}</div> : null}
          </div>
        </footer>
      </article>
    </main>
  );
}
