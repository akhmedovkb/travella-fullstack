// frontend/src/pages/ClientBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { tSuccess, tError, tInfo } from "../shared/toast";

/* ========= helpers ========= */
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const getToken = () =>
  localStorage.getItem("clientToken") ||
  localStorage.getItem("token") ||
  localStorage.getItem("providerToken");
const cfg = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });

const isFiniteNum = (n) => Number.isFinite(n) && !Number.isNaN(n);
const fmt = (n) =>
  isFiniteNum(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";

/** загрузчик */
async function fetchMyBookings() {
  const url = `${API_BASE}/api/bookings/my`;
  const res = await axios.get(url, cfg());
  return Array.isArray(res.data) ? res.data : res.data?.items || [];
}
/** точные вызовы API */
async function confirmBookingByClient(id) {
  await axios.post(`${API_BASE}/api/bookings/${id}/confirm`, {}, cfg());
}
async function cancelBookingByClient(id) {
  await axios.post(`${API_BASE}/api/bookings/${id}/cancel`, {}, cfg());
}

/* ========= форматирование ========= */
const toYMD = (s) => String(s || "").slice(0, 10);
const formatDate = (ymd) => {
  try {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return ymd;
  }
};
const formatDateRange = (dates) => {
  if (!Array.isArray(dates) || !dates.length) return "";
  const a = toYMD(dates[0]);
  const b = toYMD(dates[1] || dates[0]);
  return a === b ? formatDate(a) : `${formatDate(a)}, ${formatDate(b)}`;
};
const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const cx = (...arr) => arr.filter(Boolean).join(" ");

/* ========= иконки (inline, без либ) ========= */
const Icon = ({ name, className = "w-5 h-5" }) => {
  switch (name) {
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path d="M7 2v3M17 2v3M3 9h18M5 5h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      );
    case "phone":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path d="M4 5c0-1 1-2 2-2h2l2 4-2 2c1 2 3 4 5 5l2-2 4 2v2c0 1-1 2-2 2 0 0-9 1-15-11Z" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "tg":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M9.5 15.3l-.2 3.2c.3 0 .5-.1.6-.3l1.5-1.4 3.1 2.2c.6.3 1 .1 1.1-.6l2-12c.2-.9-.3-1.3-1-1L3.8 9.9c-.9.3-.9.8-.2 1l3.8 1.2 8.8-5.5-6.4 6.5-.3 1.2Z"/>
        </svg>
      );
    case "badge":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path d="M12 2l2.39 4.84L20 8l-4 3.9L17 18l-5-2.6L7 18l1-6.1L4 8l5.61-1.16L12 2Z" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      );
    default:
      return null;
  }
};

/* ========= UI кусочки ========= */
const StatusBadge = ({ status }) => {
  const s = String(status || "").toLowerCase();
  const map = {
    pending: { text: "ожидает", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
    confirmed: { text: "подтверждено", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    active: { text: "активно", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    rejected: { text: "отклонено", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
    cancelled: { text: "отменено", cls: "bg-gray-100 text-gray-600 ring-gray-200" },
  };
  const { text, cls } = map[s] || { text: s, cls: "bg-gray-100 text-gray-700 ring-gray-200" };
  return (
    <span className={cx("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ring-1", cls)}>
      <Icon name="badge" className="w-3.5 h-3.5" /> {text}
    </span>
  );
};

function AttachmentList({ items }) {
  const files = Array.isArray(items) ? items : items ? [items] : [];
  if (!files.length) return null;
  return (
    <div className="mt-3">
      <div className="text-xs text-gray-500 mb-1">Вложения</div>
      <div className="flex flex-wrap gap-2">
        {files.map((raw, i) => {
          const att = typeof raw === "string" ? { url: raw } : raw || {};
          const url = att.url || att.href || att.dataUrl || "";
          const name = att.name || att.filename || url.split("?")[0].split("/").pop();
          if (!url) return null;
          return (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 text-xs rounded-full border border-gray-200 bg-white hover:bg-gray-50"
            >
              {name || "файл"}
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* ========= основная страница ========= */
export default function ClientBookings() {
  const { t } = useTranslation();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await fetchMyBookings();
      setList(rows);
    } catch (e) {
      console.error("load client bookings failed", e);
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener("client:bookings:refresh", onRefresh);
    return () => window.removeEventListener("client:bookings:refresh", onRefresh);
  }, []);

  const confirm = async (b) => {
    setActingId(b.id);
    try {
      await confirmBookingByClient(b.id);
      tSuccess(t("bookings.confirmed", { defaultValue: "Бронирование подтверждено" }));
      await load();
    } catch (e) {
      console.warn("confirm failed:", e);
      tError(
        e?.response?.data?.message ||
          t("bookings.confirm_error", { defaultValue: "Ошибка подтверждения" })
      );
    } finally {
      setActingId(null);
    }
  };

  const reject = async (b) => {
    setActingId(b.id);
    try {
      await cancelBookingByClient(b.id);
      tInfo(t("bookings.rejected", { defaultValue: "Бронирование отклонено" }));
      await load();
    } catch (e) {
      console.warn("reject failed:", e);
      tError(
        e?.response?.data?.message ||
          t("bookings.reject_error", { defaultValue: "Ошибка отклонения" })
      );
    } finally {
      setActingId(null);
    }
  };

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="animate-pulse border rounded-2xl p-4 bg-white">
              <div className="h-5 w-1/3 bg-gray-200 rounded mb-3" />
              <div className="h-4 w-2/3 bg-gray-200 rounded mb-2" />
              <div className="h-4 w-1/2 bg-gray-200 rounded" />
            </div>
          ))}
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
        {list.map((b) => {
          const providerName =
            b.provider_name || b.provider?.name || b.service?.provider_name || b.service?.providerTitle;
          const providerPhone = b.provider_phone || b.provider?.phone;
          const providerTg = b.provider_telegram || b.provider?.telegram || b.provider?.social;
          const status = String(b.status || "").toLowerCase();
          const dateText = formatDateRange(b.dates);
          const lastOffer =
            b.provider_price ? `${fmt(Number(b.provider_price))} ${b.currency || "USD"}` : null;

          return (
            <div key={b.id} className="border rounded-2xl p-4 bg-white shadow-sm">
              {/* header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-600 text-white grid place-items-center font-semibold">
                    {initials(providerName || "P")}
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">
                      #{b.id} · {b.service_title || b.service?.title || t("booking.title", { defaultValue: "Бронирование" })} ·{" "}
                      <StatusBadge status={status} />
                    </div>
                    <div className="font-semibold text-gray-900 mt-0.5">{providerName || "—"}</div>
                    <div className="text-sm text-gray-700 mt-1 flex items-center gap-3">
                      {providerPhone && (
                        <a className="hover:underline inline-flex items-center gap-1" href={`tel:${String(providerPhone).replace(/[^+\d]/g, "")}`}>
                          <Icon name="phone" className="w-4 h-4" /> {providerPhone}
                        </a>
                      )}
                      {providerTg && (
                        <a
                          className="hover:underline inline-flex items-center gap-1"
                          href={
                            /^https?:\/\//i.test(providerTg)
                              ? providerTg
                              : `https://t.me/${String(providerTg).replace(/^@/, "")}`
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Icon name="tg" className="w-4 h-4" /> {String(providerTg).startsWith("@") ? providerTg : `@${String(providerTg).replace(/^@/, "")}`}
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* price chip */}
                {lastOffer && (
                  <div className="shrink-0">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                      <span className="font-semibold">{lastOffer}</span>
                      {b.provider_note ? <span className="text-emerald-800/70">· {b.provider_note}</span> : null}
                    </div>
                  </div>
                )}
              </div>

              {/* dates */}
              <div className="mt-3 inline-flex items-center gap-2 text-sm text-gray-700">
                <Icon name="calendar" className="w-5 h-5" />
                <span className="font-medium">{t("common.date", { defaultValue: "Дата" })}:</span>
                <span>{dateText || "—"}</span>
              </div>

              {/* client message */}
              {b.client_message && (
                <div className="text-sm text-gray-700 mt-2">
                  <span className="text-gray-500">{t("common.comment", { defaultValue: "Комментарий" })}:</span>{" "}
                  {b.client_message}
                </div>
              )}

              <AttachmentList items={b.attachments} />

              {/* actions — только пока pending */}
              {status === "pending" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => confirm(b)}
                    disabled={actingId === b.id}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
                  >
                    {t("actions.confirm", { defaultValue: "Подтвердить" })}
                  </button>
                  <button
                    onClick={() => reject(b)}
                    disabled={actingId === b.id}
                    className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60"
                  >
                    {t("actions.reject", { defaultValue: "Отклонить" })}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }, [list, loading, actingId, t]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">
        {t("tabs.my_bookings", { defaultValue: "Мои бронирования" })}
      </h2>
      {content}
    </div>
  );
}
