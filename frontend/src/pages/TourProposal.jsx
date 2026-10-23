import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { CalendarDays, CheckCircle2, CreditCard, MapPin, MessageSquare, Printer, Users, XCircle } from "lucide-react";

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
  const [responseMode, setResponseMode] = useState("");
  const [responseMessage, setResponseMessage] = useState("");
  const [responseBusy, setResponseBusy] = useState(false);
  const [responseError, setResponseError] = useState("");
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

  const submitResponse = async (response) => {
    if (responseBusy) return;
    setResponseBusy(true);
    setResponseError("");
    try {
      const { data } = await axios.post(`${API_BASE}/api/tour-packages/public/${encodeURIComponent(token)}/respond`, {
        response,
        message: responseMessage,
      });
      setProposal((value) => ({ ...value, ...data }));
      setResponseMode("");
    } catch (error) {
      setResponseError(error?.response?.data?.message || t("tb.proposal.response_error"));
    } finally {
      setResponseBusy(false);
    }
  };

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
  const isBooked = ["booked", "paid"].includes(String(proposal.status || "").toLowerCase());

  return (
    <main className="proposal-page min-h-screen bg-gray-100 px-4 py-8 sm:px-6 lg:py-12">
      <style>{`@media print { header:not(.proposal-cover), footer:not(.proposal-footer), .proposal-actions { display:none!important } .proposal-page { padding:0!important; background:white!important } .proposal-sheet { box-shadow:none!important; border:0!important; max-width:none!important } @page { margin:14mm } }`}</style>
      <article className="proposal-sheet mx-auto max-w-5xl overflow-hidden border border-gray-200 bg-white shadow-sm">
        <header className="proposal-cover bg-gray-950 px-6 py-8 text-white sm:px-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="text-sm font-semibold uppercase text-orange-400">{isBooked ? t("tb.proposal.voucher_label") : t("tb.proposal.label")}{proposal.revision ? ` · v${proposal.revision}` : ""}</div>
              <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{proposal.title}</h1>
              {proposal.client_name ? <p className="mt-3 text-gray-300">{t("tb.proposal.prepared_for", { name: proposal.client_name })}</p> : null}
              {proposal.booking_reference ? <div className="mt-4 inline-flex border border-emerald-500 bg-emerald-500/10 px-3 py-2 font-mono text-sm font-bold text-emerald-300">{proposal.booking_reference}</div> : null}
            </div>
            <button type="button" onClick={() => window.print()} className="proposal-actions inline-flex h-11 items-center gap-2 border border-gray-600 px-4 font-semibold hover:bg-gray-800">
              <Printer size={18} /> {isBooked ? t("tb.proposal.print_voucher") : t("tb.proposal.print")}
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

        <section className="proposal-actions border-t border-gray-200 bg-gray-50 px-6 py-8 sm:px-10">
          {isBooked ? (
            <div className="border border-emerald-300 bg-emerald-50 p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 text-emerald-700" />
                <div>
                  <h2 className="font-bold text-gray-950">{t("tb.proposal.booking_confirmed")}</h2>
                  <p className="mt-1 text-sm text-gray-700">{t("tb.proposal.booking_confirmed_text", { reference: proposal.booking_reference })}</p>
                  {proposal.booked_at ? <p className="mt-2 text-xs text-gray-500">{t("tb.proposal.booked_at")}: {dateValue(proposal.booked_at, language)}</p> : null}
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-emerald-200 pt-4 text-sm">
                    <CreditCard size={18} className="text-emerald-700" />
                    <strong>{t(`tb.proposal.payment_${proposal.payment_status || "unpaid"}`)}</strong>
                    {Number(proposal.paid_amount || 0) > 0 ? <span>{t("tb.proposal.amount_received")}: {Number(proposal.paid_amount).toLocaleString(language, { maximumFractionDigits: 2 })} {proposal.currency}</span> : null}
                    {proposal.payment_due_at && proposal.payment_status !== "paid" ? <span>{t("tb.proposal.payment_due")}: {dateValue(proposal.payment_due_at, language)}</span> : null}
                  </div>
                </div>
              </div>
            </div>
          ) : proposal.proposal_response ? (
            <div className={`border p-5 ${proposal.proposal_response === "accepted" ? "border-emerald-300 bg-emerald-50" : proposal.proposal_response === "declined" ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}>
              <div className="flex items-start gap-3">
                {proposal.proposal_response === "accepted" ? <CheckCircle2 className="mt-0.5 text-emerald-700" /> : proposal.proposal_response === "declined" ? <XCircle className="mt-0.5 text-red-700" /> : <MessageSquare className="mt-0.5 text-amber-700" />}
                <div>
                  <h2 className="font-bold text-gray-950">{t(`tb.proposal.response_${proposal.proposal_response}`)}</h2>
                  <p className="mt-1 text-sm text-gray-700">{t("tb.proposal.response_saved")}</p>
                  {proposal.proposal_response_message ? <p className="mt-3 whitespace-pre-line border-t border-current/20 pt-3 text-sm text-gray-800">{proposal.proposal_response_message}</p> : null}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <h2 className="text-xl font-bold text-gray-950">{t("tb.proposal.decision_title")}</h2>
              <p className="mt-1 text-sm text-gray-600">{t("tb.proposal.decision_text")}</p>
              {["changes_requested", "declined"].includes(responseMode) ? (
                <div className="mt-5 max-w-2xl">
                  <label className="block text-sm font-semibold text-gray-800">{t(responseMode === "declined" ? "tb.proposal.decline_comment" : "tb.proposal.change_comment")}
                    <textarea rows={4} value={responseMessage} onChange={(event) => setResponseMessage(event.target.value)} placeholder={t(responseMode === "declined" ? "tb.proposal.decline_comment_ph" : "tb.proposal.change_comment_ph")} className="mt-2 w-full border border-gray-300 bg-white p-3 font-normal outline-none focus:border-orange-500" />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={responseBusy || !responseMessage.trim()} onClick={() => submitResponse(responseMode)} className={`h-11 px-5 font-semibold text-white disabled:opacity-50 ${responseMode === "declined" ? "bg-red-700 hover:bg-red-800" : "bg-orange-600 hover:bg-orange-700"}`}>{responseBusy ? t("common.loading") : t(responseMode === "declined" ? "tb.proposal.send_decline" : "tb.proposal.send_changes")}</button>
                    <button type="button" onClick={() => setResponseMode("")} className="h-11 border border-gray-300 bg-white px-5 font-semibold text-gray-700">{t("actions.cancel")}</button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" disabled={responseBusy} onClick={() => submitResponse("accepted")} className="inline-flex h-12 items-center gap-2 bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={20} />{t("tb.proposal.accept")}</button>
                  <button type="button" onClick={() => setResponseMode("changes_requested")} className="inline-flex h-12 items-center gap-2 border border-gray-300 bg-white px-6 font-bold text-gray-800 hover:border-orange-400"><MessageSquare size={20} />{t("tb.proposal.request_changes")}</button>
                  <button type="button" onClick={() => setResponseMode("declined")} className="inline-flex h-12 items-center gap-2 border border-red-300 bg-white px-6 font-bold text-red-700 hover:bg-red-50"><XCircle size={20} />{t("tb.proposal.decline")}</button>
                </div>
              )}
              {responseError ? <p className="mt-3 text-sm font-medium text-red-600">{responseError}</p> : null}
            </div>
          )}
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
