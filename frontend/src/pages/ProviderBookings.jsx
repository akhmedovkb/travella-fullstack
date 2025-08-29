// frontend/src/pages/ProviderBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import BookingRow from "../components/BookingRow";
import { tSuccess, tError } from "../shared/toast";

/* ==== helpers ==== */
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const token = () => localStorage.getItem("token") || localStorage.getItem("providerToken");
const cfg = () => ({ headers: { Authorization: `Bearer ${token()}` } });

function tryParseJSON(val) {
  if (!val) return null;
  if (Array.isArray(val) || typeof val === "object") return val;
  try { return JSON.parse(String(val)); } catch { return null; }
}
function asArray(x) {
  if (!x) return [];
  const v = tryParseJSON(x) ?? x;
  return Array.isArray(v) ? v : typeof v === "object" ? [v] : [];
}
function isImage(att) {
  const type = att?.type || "";
  const url  = att?.url  || att;
  return /(^image\/)|(.(png|jpe?g|webp|gif|bmp)(\?|$))/i.test(`${type}`) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(`${url}`);
}

/* ==== Attachments block ==== */
function AttachmentList({ items }) {
  const { t } = useTranslation();
  const files = asArray(items);
  if (!files.length) return null;

  return (
    <div className="mt-2">
      <div className="text-xs text-gray-500 mb-1">
        {t("bookings.attachments", { defaultValue: "Вложения" })}
      </div>
      <div className="flex flex-wrap gap-2">
        {files.map((raw, i) => {
          const att = typeof raw === "string" ? { url: raw, name: raw.split("/").pop() } : raw;
          const url = att.url || att.src || att.href || "";
          const name = att.name || att.filename || url.split("?")[0].split("/").pop();
          if (!url) return null;

          if (isImage(att)) {
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block w-28 h-20 rounded border overflow-hidden"
                title={name}
              >
                <img src={url} alt={name} className="w-full h-full object-cover" />
              </a>
            );
          }
          return (
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

/* ==== Quote form (цена + комментарий) ==== */
function QuoteForm({ booking, onSent }) {
  const { t } = useTranslation();
  const [price, setPrice] = useState(booking?.provider_price ?? "");
  const [note, setNote] = useState(booking?.provider_note ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = Number(String(price).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      tError(t("bookings.price_invalid", { defaultValue: "Укажите корректную цену" }));
      return;
    }
    setBusy(true);
    try {
      await axios.post(
        `${API_BASE}/api/bookings/${booking.id}/quote`,
        { price: n, note },
        cfg()
      );
      tSuccess(t("bookings.price_sent", { defaultValue: "Цена отправлена" }));
      onSent?.();
    } catch (e) {
      console.error(e);
      tError(e?.response?.data?.message || t("bookings.price_send_error", { defaultValue: "Ошибка отправки цены" }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded border p-3 bg-gray-50">
      <div className="text-sm font-medium mb-2">
        {t("bookings.quote_title", { defaultValue: "Согласование цены" })}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="number"
          min="1"
          step="0.01"
          className="border rounded px-3 py-2 w-full sm:w-48"
          placeholder={t("bookings.price_placeholder", { defaultValue: "Цена (USD)" })}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <input
          type="text"
          className="border rounded px-3 py-2 flex-1"
          placeholder={t("bookings.note_placeholder", { defaultValue: "Комментарий (необязательно)" })}
          value={note || ""}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-60"
        >
          {t("bookings.send_price", { defaultValue: "Отправить цену" })}
        </button>
      </div>
      {!!booking?.provider_price && (
        <div className="text-xs text-gray-500 mt-2">
          {t("bookings.current_price", { defaultValue: "Текущая цена" })}: <b>{booking.provider_price}</b>{" "}
          {booking.provider_note ? `· ${booking.provider_note}` : ""}
        </div>
      )}
    </div>
  );
}

/* ==== Page ==== */
export default function ProviderBookings() {
  const { t } = useTranslation();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!token()) return;
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

  useEffect(() => { load(); }, []);

  const ensureQuoted = (b) => Number.isFinite(Number(b?.provider_price)) && Number(b.provider_price) > 0;

  const accept = async (b) => {
    if (!ensureQuoted(b)) {
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
    if (!ensureQuoted(b)) {
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

  const content = useMemo(() => {
    if (loading) {
      return <div className="text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>;
    }
    if (!list.length) {
      return <div className="text-gray-500">{t("bookings.empty", { defaultValue: "Пока нет бронирований." })}</div>;
    }
    return (
      <div className="space-y-4">
        {list.map((b) => (
          <div key={b.id} className="border rounded-xl p-3">
            <BookingRow
              booking={b}
              viewerRole="provider"
              onAccept={(bk) => accept(bk)}
              onReject={(bk) => reject(bk)}
              onCancel={(bk) => cancel(bk)}
            />

            {/* текущее предложение цены (если уже есть) */}
            {!!b?.provider_price && (
              <div className="mt-2 text-sm text-gray-700">
                {t("bookings.current_price", { defaultValue: "Текущая цена" })}: <b>{b.provider_price}</b>{" "}
                {b.provider_note ? `· ${b.provider_note}` : ""}
              </div>
            )}

            {/* форма согласования цены доступна в pending */}
            {String(b.status) === "pending" && (
              <QuoteForm booking={b} onSent={load} />
            )}

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
