// frontend/src/pages/ProviderBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import BookingRow from "../components/BookingRow";
import { tSuccess, tError } from "../shared/toast";

/* ================= helpers ================= */
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const getToken = () =>
  localStorage.getItem("providerToken") ||
  localStorage.getItem("token") ||
  localStorage.getItem("clientToken");
const cfg = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });

const CURRENCIES = ["USD", "EUR", "UZS"];
const onlyDigitsDot = (s) => String(s || "").replace(/[^\d.]/g, "");
const isFiniteNum = (n) => Number.isFinite(n) && !Number.isNaN(n);
const fmt = (n) =>
  isFiniteNum(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";

/* attachments helpers */
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
  return /(^image\/)/i.test(String(type)) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(url || ""));
}

/* =============== Attachments =============== */
function AttachmentList({ items }) {
  const { t } = useTranslation();
  const files = asArray(items);
  if (!files.length) return null;

  return (
    <div className="mt-4">
      <div className="mb-1 text-xs text-gray-500">
        {t("bookings.attachments", { defaultValue: "Вложения" })}
      </div>
      <div className="flex flex-wrap gap-2">
        {files.map((raw, i) => {
          const att = typeof raw === "string" ? { url: raw } : raw || {};
          const url = att.url || att.src || att.href || "";
          const name = att.name || att.filename || url.split("?")[0].split("/").pop();
          if (!url) return null;

          return isImage(att) ? (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block h-20 w-28 overflow-hidden rounded border bg-gray-50"
              title={name}
            >
              <img src={url} alt={name} className="h-full w-full object-cover" />
            </a>
          ) : (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="rounded border bg-gray-50 px-2 py-1 text-sm hover:bg-gray-100"
            >
              {name || t("bookings.file", { defaultValue: "файл" })}
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* =============== Карточка согласования цены (для входящих) =============== */
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
      setErr(t("bookings.price_invalid", { defaultValue: "Укажите корректную цену" }));
      return;
    }
    try {
      setBusy(true);
      await axios.post(
        `${API_BASE}/api/bookings/${booking.id}/quote`,
        { price: priceNum, currency, note: note.trim() },
        cfg()
      );
      setPriceRaw("");
      setNote("");
      tSuccess(t("bookings.price_sent", { defaultValue: "Цена отправлена" }));
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
      {/* header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="font-semibold text-gray-900">
          {t("bookings.price_agreement", { defaultValue: "Согласование цены" })}
        </div>
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700">
          {t("status.pending", { defaultValue: "ожидает" })}
        </span>
      </div>

      {/* last offer */}
      {last && (
        <div className="px-4 pt-3 text-sm text-gray-700">
          <div className="inline-flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
            <span className="font-medium">
              {t("bookings.last_offer", { defaultValue: "Последнее предложение" })}:
            </span>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
              {fmt(last.price)} {booking.currency || "USD"}
            </span>
            {last.note ? <span>· {last.note}</span> : null}
            {last.at ? <span className="text-gray-500">· {last.at}</span> : null}
          </div>
        </div>
      )}

      {/* form */}
      <div className="px-4 pb-4 pt-3">
        <div className="grid gap-3 md:grid-cols-[240px,110px,1fr,170px]">
          {/* price */}
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("bookings.price", { defaultValue: "Цена" })}
            </span>
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

          {/* currency */}
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("bookings.currency", { defaultValue: "Валюта" })}
            </span>
            <select
              className="h-11 w-full rounded-xl border bg-gray-50 px-3 outline-none"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          {/* note */}
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("bookings.comment_optional", { defaultValue: "Комментарий (необязательно)" })}
            </span>
            <input
              className="h-11 w-full rounded-xl border bg-white px-3 outline-none focus:ring-2 focus:ring-orange-400 placeholder:text-gray-400"
              placeholder={t("bookings.comment_placeholder", {
                defaultValue: "Например: парковки и ожидание включены",
              })}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          {/* button */}
          <div className="flex items-end">
            <button
              onClick={submit}
              disabled={!canSend}
              className="h-11 w-full rounded-xl bg-orange-600 px-4 font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
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

/* ================= page ================= */
export default function ProviderBookings() {
  const { t } = useTranslation();

  // вкладки
  const [tab, setTab] = useState("incoming"); // 'incoming' | 'outgoing'

  // входящие (мои услуги) и исходящие (мои брони у других поставщиков)
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);

  // ====== загрузка
  const load = async () => {
    if (!getToken()) {
      setIncoming([]);
      setOutgoing([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // входящие: новый эндпоинт, фолбэк на старый
      let inc = [];
      try {
        const r1 = await axios.get(`${API_BASE}/api/bookings/provider/incoming`, cfg());
        inc = Array.isArray(r1.data) ? r1.data : r1.data?.items || [];
      } catch {
        const r1b = await axios.get(`${API_BASE}/api/bookings/provider`, cfg());
        inc = Array.isArray(r1b.data) ? r1b.data : r1b.data?.items || [];
      }

      // исходящие (если эндпоинта нет — просто пусто)
      let out = [];
      try {
        const r2 = await axios.get(`${API_BASE}/api/bookings/provider/outgoing`, cfg());
        out = Array.isArray(r2.data) ? r2.data : r2.data?.items || [];
      } catch {
        out = [];
      }

      setIncoming(inc);
      setOutgoing(out);
    } catch (e) {
      console.error("load provider bookings failed", e);
      setIncoming([]);
      setOutgoing([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener("provider:bookings:refresh", onRefresh);
    return () => window.removeEventListener("provider:bookings:refresh", onRefresh);
  }, []);

  // ====== бизнес-логика действий
  const hasQuotedPrice = (b) =>
    isFiniteNum(Number(b?.provider_price)) && Number(b.provider_price) > 0;

  const accept = async (b) => {
    if (!hasQuotedPrice(b)) {
      tError(t("bookings.need_price_first", { defaultValue: "Сначала отправьте цену" }));
      return;
    }
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/accept`, {}, cfg());
      tSuccess(t("bookings.accepted", { defaultValue: "Бронь подтверждена" }));
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.accept_error", { defaultValue: "Ошибка подтверждения" }));
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };

  const reject = async (b) => {
    if (!hasQuotedPrice(b)) {
      tError(t("bookings.need_price_first", { defaultValue: "Сначала отправьте цену" }));
      return;
    }
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/reject`, {}, cfg());
      tSuccess(t("bookings.rejected", { defaultValue: "Бронь отклонена" }));
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.reject_error", { defaultValue: "Ошибка отклонения" }));
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
      tError(e?.response?.data?.message || t("bookings.cancel_error", { defaultValue: "Ошибка отмены" }));
    } finally {
      await load();
      window.dispatchEvent(new Event("provider:counts:refresh"));
    }
  };

  // ====== UI данные
  const counts = useMemo(
    () => ({ incoming: incoming.length, outgoing: outgoing.length }),
    [incoming, outgoing]
  );

  const currentList = tab === "incoming" ? incoming : outgoing;

  // ====== отрисовка
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">
          {t("bookings.title_provider", { defaultValue: "Бронирования (Поставщик)" })}
        </h1>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setTab("incoming")}
            className={`px-3 py-1.5 rounded-full ring-1 ${
              tab === "incoming"
                ? "bg-indigo-600 text-white ring-indigo-600"
                : "bg-white text-gray-700 ring-gray-200"
            }`}
          >
            {t("bookings.incoming", { defaultValue: "Бронирования моих услуг" })}
            <span
              className={`ml-2 text-xs px-1.5 rounded-full ${
                tab === "incoming" ? "bg-white/20" : "bg-gray-100 text-gray-700"
              }`}
            >
              {counts.incoming}
            </span>
          </button>

          <button
            onClick={() => setTab("outgoing")}
            className={`px-3 py-1.5 rounded-full ring-1 ${
              tab === "outgoing"
                ? "bg-indigo-600 text-white ring-indigo-600"
                : "bg-white text-gray-700 ring-gray-200"
            }`}
          >
            {t("bookings.outgoing", { defaultValue: "Мои бронирования услуг" })}
            <span
              className={`ml-2 text-xs px-1.5 rounded-full ${
                tab === "outgoing" ? "bg-white/20" : "bg-gray-100 text-gray-700"
              }`}
            >
              {counts.outgoing}
            </span>
          </button>

          <button
            onClick={load}
            className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
          >
            {t("common.refresh", { defaultValue: "Обновить" })}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="animate-pulse border rounded-2xl p-4 bg-white">
              <div className="h-5 w-1/3 bg-gray-200 rounded mb-3" />
              <div className="h-4 w-2/3 bg-gray-200 rounded mb-2" />
              <div className="h-4 w-1/2 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      ) : !currentList.length ? (
        <div className="text-gray-500">
          {t("bookings.empty", { defaultValue: "Пока нет бронирований." })}
        </div>
      ) : (
        <div className="space-y-4">
          {currentList.map((b) => {
            const viewerRole = tab === "incoming" ? "provider" : "client"; // важно для BookingRow

            return (
              <div key={b.id} className="rounded-xl border bg-white p-3">
                <BookingRow
                  booking={b}
                  viewerRole={viewerRole}
                  onAccept={tab === "incoming" ? (bk) => accept(bk) : undefined}
                  onReject={tab === "incoming" ? (bk) => reject(bk) : undefined}
                  onCancel={(bk) => cancel(bk)} // в BookingRow кнопка «Отменить» показывается только у viewerRole='client'
                />

                {/* для входящих показываем текущую цену и карточку согласования */}
                {tab === "incoming" && isFiniteNum(Number(b?.provider_price)) && Number(b.provider_price) > 0 && (
                  <div className="mt-3 text-sm text-gray-700">
                    {t("bookings.current_price", { defaultValue: "Текущая цена" })}:{" "}
                    <b>{fmt(Number(b.provider_price))}</b>
                    {b.currency ? ` ${b.currency}` : " USD"}
                    {b.provider_note ? ` · ${b.provider_note}` : ""}
                  </div>
                )}

                {tab === "incoming" && String(b.status) === "pending" && (
                  <PriceAgreementCard booking={b} onSent={load} />
                )}

                <AttachmentList items={b.attachments} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
