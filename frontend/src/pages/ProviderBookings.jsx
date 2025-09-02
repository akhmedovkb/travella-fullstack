// frontend/src/pages/ProviderBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import BookingRow from "../components/BookingRow";
import { tSuccess, tError } from "../shared/toast";

/* ================= helpers ================= */
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const getToken = () =>
  localStorage.getItem("token") || localStorage.getItem("providerToken");
const cfg = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });

const CURRENCIES = ["USD", "EUR", "UZS"];
const onlyDigitsDot = (s) => String(s || "").replace(/[^\d.]/g, "");
const isFiniteNum = (n) => Number.isFinite(n) && !Number.isNaN(n);
const fmt = (n) =>
  isFiniteNum(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";

/* =============== Attachments =============== */
function tryParseJSON(val) {
  if (!val) return null;
  if (Array.isArray(val) || typeof val === "object") return val;
  try { return JSON.parse(String(val)); } catch { return null; }
}
function asArray(x) { const v = tryParseJSON(x) ?? x; if (!v) return []; return Array.isArray(v) ? v : typeof v === "object" ? [v] : []; }
function isImage(att) {
  const type = att?.type || "";
  const url = att?.url || att?.src || att?.href || att;
  return /(^image\/)/i.test(String(type)) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(url || ""));
}
function AttachmentList({ items }) {
  const { t } = useTranslation();
  const files = asArray(items);
  if (!files.length) return null;
  return (
    <div className="mt-4">
      <div className="mb-1 text-xs text-gray-500">{t("bookings.attachments", { defaultValue: "Вложения" })}</div>
      <div className="flex flex-wrap gap-2">
        {files.map((raw, i) => {
          const att = typeof raw === "string" ? { url: raw } : raw || {};
          const url = att.url || att.src || att.href || "";
          const name = att.name || att.filename || url.split("?")[0].split("/").pop();
          if (!url) return null;
          return isImage(att) ? (
            <a key={i} href={url} target="_blank" rel="noreferrer" className="block h-20 w-28 overflow-hidden rounded border bg-gray-50" title={name}>
              <img src={url} alt={name} className="h-full w-full object-cover" />
            </a>
          ) : (
            <a key={i} href={url} target="_blank" rel="noreferrer" className="rounded border bg-gray-50 px-2 py-1 text-sm hover:bg-gray-100">
              {name || t("bookings.file", { defaultValue: "файл" })}
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* =============== Карточка согласования цены (входящие) =============== */
function PriceAgreementCard({ booking, onSent }) {
  const { t } = useTranslation();
  const [priceRaw, setPriceRaw] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const last = useMemo(() => {
    if (!isFiniteNum(Number(booking?.provider_price))) return null;
    const at = booking?.updated_at ? new Date(booking.updated_at) : null;
    return {
      price: Number(booking.provider_price),
      note: booking.provider_note,
      at: at
        ? at.toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        : null,
    };
  }, [booking?.provider_price, booking?.provider_note, booking?.updated_at]);

  const priceNum = useMemo(() => {
    const n = Number(onlyDigitsDot(priceRaw));
    return isFiniteNum(n) ? n : NaN;
  }, [priceRaw]);

  const canSend =
    !busy &&
    String(booking?.status) === "pending" &&
    isFiniteNum(priceNum) &&
    priceNum > 0 &&
    CURRENCIES.includes(currency);

  const submit = async () => {
    setErr("");
    if (!canSend) { setErr(t("bookings.price_invalid", { defaultValue: "Укажите корректную цену" })); return; }
    try {
      setBusy(true);
      await axios.post(`${API_BASE}/api/bookings/${booking.id}/quote`,
        { price: Number(priceNum), currency, note: note.trim() }, cfg());
      setPriceRaw(""); setNote("");
      tSuccess(t("bookings.price_sent", { defaultValue: "Цена отправлена" }));
      onSent?.();
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.price_send_error", { defaultValue: "Ошибка отправки цены" }));
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 rounded-xl border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="font-semibold text-gray-900">{t("bookings.price_agreement", { defaultValue: "Согласование цены" })}</div>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
          {t("status.pending", { defaultValue: "ожидает" })}
        </span>
      </div>

      {last && (
        <div className="px-4 pt-3 text-sm text-gray-700">
          <div className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
            <span className="font-medium">{t("bookings.last_offer", { defaultValue: "Последнее предложение" })}:</span>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
              {fmt(last.price)} {booking.currency || "USD"}
            </span>
            {last.note ? <span>· {last.note}</span> : null}
            {last.at ? <span className="text-gray-500">· {last.at}</span> : null}
          </div>
        </div>
      )}

      <div className="px-4 pb-4 pt-3">
        <div className="grid gap-3 md:grid-cols-[240px,110px,1fr,170px]">
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">{t("bookings.price", { defaultValue: "Цена" })}</span>
            <div className="flex h-11 items-center rounded-xl border bg-white focus-within:ring-2 focus-within:ring-orange-400">
              <div className="px-3 text-gray-500">💵</div>
              <input
                inputMode="decimal"
                placeholder={t("bookings.price_placeholder", { defaultValue: "Напр. 120" })}
                className="h-full w-full flex-1 bg-transparent px-0 pr-3 outline-none placeholder:text-gray-400"
                value={priceRaw}
                onChange={(e) => setPriceRaw(onlyDigitsDot(e.target.value))}
              />
            </div>
          </label>

          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">{t("bookings.currency", { defaultValue: "Валюта" })}</span>
            <select className="h-11 w-full rounded-xl border bg-gray-50 px-3 outline-none" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">{t("bookings.comment_optional", { defaultValue: "Комментарий (необязательно)" })}</span>
            <input
              className="h-11 w-full rounded-xl border bg-white px-3 outline-none focus:ring-2 focus:ring-orange-400 placeholder:text-gray-400"
              placeholder={t("bookings.comment_placeholder", { defaultValue: "Например: парковки и ожидание включены" })}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div className="flex items-end">
            <button onClick={submit} disabled={!canSend} className="h-11 w-full rounded-xl bg-orange-600 px-4 font-semibold text-white transition hover:bg-orange-700 disabled:opacity-60">
              {busy ? t("common.sending", { defaultValue: "Отправка…" }) : t("bookings.send_price", { defaultValue: "Отправить цену" })}
            </button>
          </div>
        </div>

        {err ? <div className="mt-2 text-sm text-red-600">{err}</div> : null}
      </div>
    </div>
  );
}

/* ================= page ================= */
export default function ProviderBookings() {
  const { t } = useTranslation();

  const [tab, setTab] = useState("incoming");
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!getToken()) return;
    setLoading(true);
    try {
      const [incRes, outRes] = await Promise.all([
        axios.get(`${API_BASE}/api/bookings/provider`, cfg()),
        axios.get(`${API_BASE}/api/bookings/provider/outgoing`, cfg()),
      ]);
      setIncoming(Array.isArray(incRes.data) ? incRes.data : []);
      setOutgoing(Array.isArray(outRes.data) ? outRes.data : []);
    } catch (e) {
      console.error("load provider bookings failed", e);
      setIncoming([]); setOutgoing([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const hasQuotedPrice = (b) => isFiniteNum(Number(b?.provider_price)) && Number(b.provider_price) > 0;

  const accept = async (b) => {
    if (!hasQuotedPrice(b)) { tError(t("bookings.need_price_first", { defaultValue: "Сначала отправьте цену" })); return; }
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/accept`, {}, cfg());
      tSuccess(t("bookings.accepted", { defaultValue: "Бронь подтверждена" }));
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.accept_error", { defaultValue: "Ошибка подтверждения" }));
    } finally { await load(); window.dispatchEvent(new Event("provider:counts:refresh")); }
  };

  const reject = async (b) => {
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/reject`, {}, cfg());
      tSuccess(t("bookings.rejected", { defaultValue: "Бронь отклонена" }));
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.reject_error", { defaultValue: "Ошибка отклонения" }));
    } finally { await load(); window.dispatchEvent(new Event("provider:counts:refresh")); }
  };

  // исходящие (я как заказчик)
  const confirmOutgoing = async (b) => {
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/confirm-by-requester`, {}, cfg());
      tSuccess(t("bookings.confirmed", { defaultValue: "Бронирование подтверждено" }));
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.confirm_error", { defaultValue: "Ошибка подтверждения" }));
    } finally { await load(); window.dispatchEvent(new Event("provider:counts:refresh")); }
  };
  const cancelOutgoing = async (b) => {
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/cancel-by-requester`, {}, cfg());
      tSuccess(t("bookings.cancelled", { defaultValue: "Бронь отменена" }));
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.cancel_error", { defaultValue: "Ошибка отмены" }));
    } finally { await load(); window.dispatchEvent(new Event("provider:counts:refresh")); }
  };

  const list = tab === "incoming" ? incoming : outgoing;

  const content = useMemo(() => {
    if (loading) return <div className="text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>;
    if (!list.length) return <div className="text-gray-500">{t("bookings.empty", { defaultValue: "Пока нет бронирований." })}</div>;
    return (
      <div className="space-y-4">
        {list.map((b) => {
          const isIncoming = tab === "incoming";
          return (
            <div key={b.id} className="rounded-xl border bg-white p-3">
              <BookingRow
                booking={b}
                viewerRole={isIncoming ? "provider" : "client"}
                needPriceForAccept={isIncoming}    // скрыть «Подтвердить» без цены
                hideClientCancel={!isIncoming}      // <<< убираем верхний «Отмена» в «Мои бронирования услуг»
                onAccept={accept}
                onReject={reject}
                onCancel={cancelOutgoing}
              />

              {/* Входящие: моя форма согласования цены */}
              {isIncoming && String(b.status) === "pending" && (
                <PriceAgreementCard booking={b} onSent={load} />
              )}

              {/* Исходящие: предложение и действия */}
              {!isIncoming && (
                <>
                  {isFiniteNum(Number(b.provider_price)) && (
                    <div className="mt-3">
                      <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-3 py-1.5">
                        <span className="font-medium">{t("bookings.provider_offer", { defaultValue: "Предложение поставщика" })}:</span>
                        <b>{fmt(Number(b.provider_price))} {b.currency || "USD"}</b>
                        {b.provider_note ? <span className="text-emerald-800/70">· {b.provider_note}</span> : null}
                      </span>
                    </div>
                  )}

                  {String(b.status) === "pending" && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => confirmOutgoing(b)}
                        disabled={!isFiniteNum(Number(b.provider_price))}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
                      >
                        {t("actions.confirm", { defaultValue: "Подтвердить" })}
                      </button>
                      <button
                        onClick={() => cancelOutgoing(b)}
                        className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800"
                      >
                        {t("actions.cancel", { defaultValue: "Отмена" })}
                      </button>
                    </div>
                  )}
                </>
              )}

              <AttachmentList items={b.attachments} />
            </div>
          );
        })}
      </div>
    );
  }, [list, loading, tab, t]);

  const incomingCount = incoming.length;
  const outgoingCount = outgoing.length;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("bookings.title_provider", { defaultValue: "Бронирования (Поставщик)" })}</h1>
        <button onClick={load} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50">
          {t("common.refresh", { defaultValue: "Обновить" })}
        </button>
      </div>

      {/* Вкладки */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setTab("incoming")}
          className={"rounded-full px-4 py-2 ring-1 " + (tab === "incoming" ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-gray-800 ring-gray-200 hover:bg-gray-50")}
        >
          {t("bookings.incoming", { defaultValue: "Бронирования моих услуг" })}
          <span className={"ml-2 inline-flex items-center rounded-full px-1.5 text-xs " + (tab === "incoming" ? "bg-white/20" : "bg-gray-100")}>
            {incomingCount}
          </span>
        </button>

        <button
          onClick={() => setTab("outgoing")}
          className={"rounded-full px-4 py-2 ring-1 " + (tab === "outgoing" ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-gray-800 ring-gray-200 hover:bg-gray-50")}
        >
          {t("bookings.outgoing", { defaultValue: "Мои бронирования услуг" })}
          <span className={"ml-2 inline-flex items-center rounded-full px-1.5 text-xs " + (tab === "outgoing" ? "bg-white/20" : "bg-gray-100")}>
            {outgoingCount}
          </span>
        </button>
      </div>

      {content}
    </div>
  );
}
