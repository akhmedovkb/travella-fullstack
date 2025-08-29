// frontend/src/pages/ClientBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { tSuccess, tError } from "../shared/toast";
import BookingRow from "../components/BookingRow";

/* ================= helpers ================= */
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const token = () => localStorage.getItem("token");
const cfg = () => ({ headers: { Authorization: `Bearer ${token()}` } });
const isNum = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
const fmtMoney = (n) =>
  Number.isFinite(Number(n))
    ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "";

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

/* ================= small widgets ================= */
function Field({ label, children }) {
  return (
    <div className="text-sm">
      <span className="text-gray-500">{label}: </span>
      <span className="font-medium break-all">{children || "—"}</span>
    </div>
  );
}

function AttachmentList({ items }) {
  const { t } = useTranslation();
  const files = asArray(items);
  if (!files.length) return null;

  return (
    <div className="mt-3">
      <div className="text-xs text-gray-500 mb-1">
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

/* ========= actions with graceful fallbacks (разные бекенды) ========= */
async function postWithFallback(id, variants, body) {
  let lastErr;
  for (const path of variants) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await axios.post(`${API_BASE}${path.replace(":id", id)}`, body || {}, cfg());
      return true;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/* ================= main page ================= */
export default function ClientBookings() {
  const { t } = useTranslation();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!token()) return;
    setLoading(true);
    try {
      // основная точка для клиента
      const res = await axios.get(`${API_BASE}/api/bookings/client`, cfg());
      const rows = Array.isArray(res.data) ? res.data : res.data?.items || [];
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
  }, []);

  const confirmOffer = async (b) => {
    if (!isNum(b?.provider_price)) {
      tError(t("bookings.need_price_first", { defaultValue: "Нет цены поставщика" }));
      return;
    }
    try {
      await postWithFallback(
        b.id,
        [
          "/api/bookings/:id/confirm",
          "/api/bookings/:id/acceptByClient",
          "/api/bookings/:id/accept",
        ],
        {},
      );
      tSuccess(t("bookings.accepted", { defaultValue: "Бронирование подтверждено" }));
      await load();
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.accept_error", { defaultValue: "Ошибка подтверждения" }));
    }
  };

  const declineOffer = async (b) => {
    try {
      await postWithFallback(
        b.id,
        [
          "/api/bookings/:id/decline",
          "/api/bookings/:id/rejectByClient",
          "/api/bookings/:id/reject",
        ],
        {},
      );
      tSuccess(t("bookings.rejected", { defaultValue: "Предложение отклонено" }));
      await load();
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.reject_error", { defaultValue: "Ошибка отклонения" }));
    }
  };

  const cancel = async (b) => {
    try {
      await axios.post(`${API_BASE}/api/bookings/${b.id}/cancel`, {}, cfg());
      tSuccess(t("bookings.cancelled", { defaultValue: "Бронь отменена" }));
      await load();
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.cancel_error", { defaultValue: "Ошибка отмены" }));
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
        {list.map((b) => {
          const createdAt = b?.created_at ? new Date(b.created_at) : null;
          const canRespond = String(b.status) === "pending" && isNum(b.provider_price);
          const canCancel = ["pending", "active"].includes(String(b.status));

          return (
            <div key={b.id} className="border rounded-xl p-3 bg-white">
              {/* верхний блок — имя поставщика/контакты через общий компонент */}
              <BookingRow
                booking={b}
                viewerRole="client"
                onCancel={canCancel ? () => cancel(b) : undefined}
              />

              {/* инфо по брони */}
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                <Field label={t("common.created_at", { defaultValue: "Дата создания" })}>
                  {createdAt
                    ? createdAt.toLocaleString()
                    : "—"}
                </Field>
                <Field label={t("common.status", { defaultValue: "Статус" })}>
                  {String(b.status || "").toLowerCase()}
                </Field>
                <Field label={t("common.date", { defaultValue: "Дата(ы)" })}>
                  {Array.isArray(b.dates) && b.dates.length
                    ? b.dates.map((d) => String(d).slice(0, 10)).join(", ")
                    : "—"}
                </Field>
                <Field label={t("bookings.address", { defaultValue: "Адрес" })}>
                  {b.provider_address || "—"}
                </Field>
                {b.client_message ? (
                  <Field label={t("bookings.client_message", { defaultValue: "Комментарий клиента" })}>
                    {b.client_message}
                  </Field>
                ) : null}
                {b.provider_note ? (
                  <Field label={t("bookings.provider_note", { defaultValue: "Комментарий поставщика" })}>
                    {b.provider_note}
                  </Field>
                ) : null}
              </div>

              {/* предложение поставщика */}
              <div className="mt-3 text-sm">
                {isNum(b.provider_price) ? (
                  <div className="inline-flex flex-wrap items-center gap-2 rounded bg-emerald-50 px-2.5 py-1">
                    <span className="text-gray-600">
                      {t("bookings.current_price", { defaultValue: "Текущая цена" })}:
                    </span>
                    <b className="text-emerald-700">
                      {fmtMoney(b.provider_price)} {b.currency || "USD"}
                    </b>
                    {b.provider_note ? <span className="text-gray-600">· {b.provider_note}</span> : null}
                  </div>
                ) : (
                  <span className="text-gray-500">
                    {t("bookings.waiting_provider", { defaultValue: "Ожидаем предложение от поставщика" })}
                  </span>
                )}
              </div>

              {/* действия клиента */}
              <div className="mt-3 flex flex-wrap gap-2">
                {canRespond && (
                  <>
                    <button
                      onClick={() => confirmOffer(b)}
                      className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white text-sm"
                    >
                      {t("actions.accept", { defaultValue: "Подтвердить" })}
                    </button>
                    <button
                      onClick={() => declineOffer(b)}
                      className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-sm"
                    >
                      {t("actions.reject", { defaultValue: "Отклонить" })}
                    </button>
                  </>
                )}
                {canCancel && (
                  <button
                    onClick={() => cancel(b)}
                    className="px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm"
                  >
                    {t("actions.cancel", { defaultValue: "Отменить" })}
                  </button>
                )}
              </div>

              {/* приложения к заявке (то, что приложил клиент при запросе) */}
              <AttachmentList items={b.attachments} />
            </div>
          );
        })}
      </div>
    );
  }, [list, loading, t]);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-4">
        {t("bookings.title_client", { defaultValue: "Мои бронирования" })}
      </h1>
      {content}
    </div>
  );
}
