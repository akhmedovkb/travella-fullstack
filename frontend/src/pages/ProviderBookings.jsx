// frontend/src/pages/ProviderBookings.jsx// frontend/src/pages/ProviderBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import BookingRow from "../components/BookingRow";
import { tSuccess, tError } from "../shared/toast";

/* =============== helpers =============== */
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const getToken = () =>
  localStorage.getItem("token") || localStorage.getItem("providerToken");
const cfg = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });

const CURRENCIES = ["USD", "EUR", "UZS"];
const onlyDigitsDot = (s) => String(s || "").replace(/[^\d.]/g, "");
const isFiniteNum = (n) => Number.isFinite(n) && !Number.isNaN(n);
const fmt = (n) =>
  isFiniteNum(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "";

// JSON/helpers для вложений
function tryParseJSON(val) {
  if (!val) return null;
  if (Array.isArray(val) || typeof val === "object") return val;
  try {
    return JSON.parse(String(val));
  } catch {
    return null;
  }
}
function asArray(x) {
  const v = tryParseJSON(x) ?? x;
  if (!v) return [];
  return Array.isArray(v) ? v : typeof v === "object" ? [v] : [];
}
function isImage(att) {
  const type = att?.type || "";
  const url = att?.url || att?.src || att?.href || att;
  return (
    /(^image\/)/i.test(String(type)) ||
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(url || ""))
  );
}

/* =============== Attachments =============== */
function AttachmentList({ items }) {
  const { t } = useTranslation();
  const files = asArray(items);
  if (!files.length) return null;

  return (
    <div className="mt-4">
      <div className="text-xs text-gray-500 mb-1">
        {t("bookings.attachments", { defaultValue: "Вложения" })}
      </div>
      <div className="flex flex-wrap gap-2">
        {files.map((raw, i) => {
          const att = typeof raw === "string" ? { url: raw } : raw || {};
          const url = att.url || att.src || att.href || "";
          const name =
            att.name || att.filename || url.split("?")[0].split("/").pop();
          if (!url) return null;

          return isImage(att) ? (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block w-28 h-20 rounded border overflow-hidden bg-gray-50"
              title={name}
            >
              <img src={url} alt={name} className="w-full h-full object-cover" />
            </a>
          ) : (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 text-sm rounded border bg-gray-50 hover:bg-gray-100"
            >
              {name || t("bookings.file", { defaultValue: "файл" })}
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* =============== Карточка согласования цены =============== */
function PriceAgreementCard({ booking, onSent }) {
  const { t } = useTranslation();
  const [priceRaw, setPriceRaw] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // показать актуальное предложение, если уже отправляли
  const last = useMemo(() => {
    if (!isFiniteNum(Number(booking?.provider_price))) return null;
    const at = booking?.updated_at ? new Date(booking.updated_at) : null;
    return {
      price: Number(booking.provider_price),
      note: booking.provider_note,
      at: at
        ? at.toLocaleString(undefined, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
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
    if (!canSend) {
      setErr(
        t("bookings.price_invalid", { defaultValue: "Укажите корректную цену" })
      );
      return;
    }
    try {
      setBusy(true);
      await axios.post(
        `${API_BASE}/api/bookings/${booking.id}/quote`,
        { price: priceNum, currency, note: note.trim() },
        cfg()
      );
      tSuccess(t("bookings.price_sent", { defaultValue: "Цена отправлена" }));
      setPriceRaw("");
      setNote("");
      onSent?.();
    } catch (e) {
      tError(
        e?.response?.data?.message ||
          t("bookings.price_send_error", { defaultValue: "Ошибка отправки цены" })
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="font-semibold text-gray-900">
          {t("bookings.price_agreement", { defaultValue: "Согласование цены" })}
        </div>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
          {t("status.pending", { defaultValue: "ожидает" })}
        </span>
      </div>

      {last && (
        <div className="px-4 pt-3 text-sm text-gray-700">
          <div className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
            <span className="font-medium">
              {t("bookings.last_offer", { defaultValue: "Последнее предложение" })}
              :
            </span>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
              {fmt(last.price)} {booking.currency || "USD"}
            </span>
            {last.note ? <span>· {last.note}</span> : null}
            {last.at ? <span className="text-gray-500">· {last.at}</span> : null}
          </div>
        </div>
      )}

      <div className="px-4 pb-4 pt-3">
        <div className="grid gap-3 md:grid-cols-[220px,1fr,140px]">
          <label className="relative">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("bookings.price", { defaultValue: "Цена" })}
            </span>
            <div className="flex rounded-xl border bg-white focus-within:ring-2 focus-within:ring-orange-400">
              <div className="flex items-center px-3 text-gray-500">💵</div>
              <input
                inputMode="decimal"
                placeholder={t("bookings.price_placeholder", {
                  defaultValue: "Напр. 120",
                })}
                className="flex-1 rounded-xl px-0 py-2 outline-none"
                value={priceRaw}
                onChange={(e) => setPriceRaw(onlyDigitsDot(e.target.value))}
              />
              <select
                className="rounded-r-xl border-l bg-gray-50 px-3 py-2 text-sm outline-none"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </label>

        <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("bookings.comment_optional", {
                defaultValue: "Комментарий (необязательно)",
              })}
            </span>
            <input
              className="w-full rounded-xl border bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-orange-400"
              placeholder={t("bookings.comment_placeholder", {
                defaultValue: "Например: парковки и ожидание включены",
              })}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div className="flex items-end">
            <button
              onClick={submit}
              disabled={!canSend}
              className="w-full rounded-xl bg-orange-600 px-4 py-2 font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy
                ? t("common.sending", { defaultValue: "Отправка…" })
                : t("bookings.send_price", { defaultValue: "Отправить цену" })}
            </button>
          </div>
        </div>

        {err ? <div className="mt-2 text-sm text-red-600">{err}</div> : null}
      </div>
    </div>
  );
}

// алиас, если где-то в коде ожидали старое имя компонента
const QuoteForm = PriceAgreementCard;

/* =============== Page =============== */
export default function ProviderBookings() {
  const { t } = useTranslation();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!getToken()) return;
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/bookings/provider`, cfg());
      const rows = Array.isArray(res.data) ? res.data : res.data?.items || [];
      setList(rows);
    } catch (e) {
      console.error("load provider bookings failed", e);
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const hasQuotedPrice = (b) =>
    isFiniteNum(Number(b?.provider_price)) && Number(b.provider_price) > 0;

  const accept = async (b) => {
    if (!hasQuotedPrice(b)) {
      tError(
        t("bookings.need_price_first", {
          defaultValue: "Сначала отправьте цену",
        })
      );
      return;
    }
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/accept`, {}, cfg());
      tSuccess(t("bookings.accepted", { defaultValue: "Бронь подтверждена" }));
    } catch (e) {
      tError(
        e?.response?.data?.message ||
          t("bookings.accept_error", { defaultValue: "Ошибка подтверждения" })
      );
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };

  const reject = async (b) => {
    if (!hasQuotedPrice(b)) {
      tError(
        t("bookings.need_price_first", {
          defaultValue: "Сначала отправьте цену",
        })
      );
      return;
    }
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/reject`, {}, cfg());
      tSuccess(t("bookings.rejected", { defaultValue: "Бронь отклонена" }));
    } catch (e) {
      tError(
        e?.response?.data?.message ||
          t("bookings.reject_error", { defaultValue: "Ошибка отклонения" })
      );
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };

  const cancel = async (b) => {
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/cancel`, {}, cfg());
      tSuccess(t("bookings.cancelled", { defaultValue: "Бронь отменена" }));
    } catch (e) {
      tError(
        e?.response?.data?.message ||
          t("bookings.cancel_error", { defaultValue: "Ошибка отмены" })
      );
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="text-gray-500">
          {t("common.loading", { defaultValue: "Загрузка..." })}
        </div>
      );
    }
    if (!list.length) {
      return (
        <div className="text-gray-500">
          {t("bookings.empty", { defaultValue: "Пока нет бронирований." })}
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {list.map((b) => (
          <div key={b.id} className="border rounded-xl p-3 bg-white">
            <BookingRow
              booking={b}
              viewerRole="provider"
              onAccept={(bk) => accept(bk)}
              onReject={(bk) => reject(bk)}
              onCancel={(bk) => cancel(bk)}
            />

            {/* уже отправленная цена (если есть) */}
            {hasQuotedPrice(b) && (
              <div className="mt-3 text-sm text-gray-700">
                {t("bookings.current_price", { defaultValue: "Текущая цена" })}:{" "}
                <b>{fmt(Number(b.provider_price))}</b>
                {b.currency ? ` ${b.currency}` : " USD"}
                {b.provider_note ? ` · ${b.provider_note}` : ""}
              </div>
            )}

            {/* блок согласования цены (только при pending) */}
            {String(b.status) === "pending" && (
              <PriceAgreementCard booking={b} onSent={load} />
            )}

            {/* вложения клиента к заявке */}
            <AttachmentList items={b.attachments} />
          </div>
        ))}
      </div>
    );
  }, [list, loading, t]);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-4">
        {t("bookings.title_provider", { defaultValue: "Бронирования (Поставщик)" })}
      </h1>
      {content}
    </div>
  );
}
