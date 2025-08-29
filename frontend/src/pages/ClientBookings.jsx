// frontend/src/pages/ClientBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { tSuccess, tError } from "../shared/toast";

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const getToken = () =>
  localStorage.getItem("clientToken") ||
  localStorage.getItem("token") ||
  localStorage.getItem("providerToken"); // на всякий случай
const cfg = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });

/* helpers */
const arrify = (x) =>
  Array.isArray(x) ? x : x?.items || x?.data || x?.list || [];

const tryParse = (v) => {
  if (!v) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
};
const asArray = (x) => {
  const v = tryParse(x) ?? x;
  if (!v) return [];
  return Array.isArray(v) ? v : typeof v === "object" ? [v] : [];
};
const isImg = (att) => {
  const type = att?.type || "";
  const url = att?.url || att?.src || att?.href || att;
  return (
    /(^image\/)/i.test(String(type)) ||
    /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(url || ""))
  );
};
const fmt = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : "";

/* маленький util: последовательно пробуем список эндпойнтов */
async function tryEndpoints(method, candidates, body) {
  let lastErr;
  for (const url of candidates) {
    try {
      const full = url.startsWith("http") ? url : `${API_BASE}${url}`;
      if (method === "GET") {
        const { data } = await axios.get(full, cfg());
        return data;
      } else if (method === "POST") {
        const { data } = await axios.post(full, body ?? {}, cfg());
        return data;
      } else if (method === "PUT") {
        const { data } = await axios.put(full, body ?? {}, cfg());
        return data;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/* вложения */
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
          const att =
            typeof raw === "string"
              ? { url: raw, name: raw.split("/").pop() }
              : raw || {};
          const url = att.url || att.src || att.href || "";
          const name =
            att.name || att.filename || url.split("?")[0].split("/").pop();
          if (!url) return null;

          return isImg(att) ? (
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

/* основной компонент */
export default function ClientBookings({ refreshKey }) {
  const { t } = useTranslation();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await tryEndpoints("GET", [
        "/api/bookings/my",
        "/api/bookings/mine",
        "/api/my/bookings",
        "/api/client/bookings",
        "/api/clients/bookings",
        "/api/bookings?mine=1",
        "/api/bookings?me=1",
      ]);
      setList(arrify(data));
    } catch (e) {
      console.error("client bookings load failed", e);
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (refreshKey !== undefined) load();
  }, [refreshKey]);
  useEffect(() => {
    const onRefresh = () => load();
    window.addEventListener("client:bookings:refresh", onRefresh);
    return () => window.removeEventListener("client:bookings:refresh", onRefresh);
  }, []);

  const canConfirm = (b) =>
    Number.isFinite(Number(b?.provider_price)) &&
    Number(b.provider_price) > 0 &&
    String(b.status) === "pending";

  const confirmBooking = async (b) => {
    if (!canConfirm(b)) {
      tError(
        t("bookings.need_price_first", {
          defaultValue: "Сначала дождитесь цены от поставщика",
        })
      );
      return;
    }
    try {
      await tryEndpoints("POST", [
        `/api/bookings/${b.id}/confirm`,
        `/api/bookings/${b.id}/approve`,
        `/api/bookings/${b.id}/client-accept`,
        `/api/bookings/${b.id}/accept-client`,
        `/api/bookings/${b.id}/accept`, // вдруг один общий эндпойнт
        "/api/bookings/confirm",
      ], { id: b.id });

      tSuccess(t("bookings.confirmed", { defaultValue: "Бронирование подтверждено" }));
      await load();
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        t("bookings.confirm_error", { defaultValue: "Ошибка подтверждения" });
      tError(String(msg));
      console.error("confirmBooking failed", e);
    }
  };

  const declineBooking = async (b) => {
    try {
      await tryEndpoints("POST", [
        `/api/bookings/${b.id}/client-reject`,
        `/api/bookings/${b.id}/reject-client`,
        `/api/bookings/${b.id}/decline`,
        `/api/bookings/${b.id}/reject`,
        `/api/bookings/${b.id}/cancel`,
        "/api/bookings/cancel",
      ], { id: b.id });

      tSuccess(t("bookings.rejected", { defaultValue: "Бронирование отклонено" }));
      await load();
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        t("bookings.reject_error", { defaultValue: "Ошибка отклонения" });
      tError(String(msg));
      console.error("declineBooking failed", e);
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
          {t("bookings.empty_client", { defaultValue: "Пока нет бронирований." })}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {list.map((b) => {
          const dates =
            Array.isArray(b?.dates) && b.dates.length >= 2
              ? `${String(b.dates[0]).slice(0, 10)}, ${String(b.dates[1]).slice(0, 10)}`
              : `${b?.date || ""}`;
          const providerName =
            b?.provider_name || b?.provider?.name || b?.service?.provider_name;
          const providerPhone =
            b?.provider_phone || b?.provider?.phone;
          const providerTg =
            b?.provider_telegram || b?.provider?.telegram;
          const address = b?.service_city || b?.city || b?.address;

          return (
            <div key={b.id} className="border rounded-xl p-4 bg-white">
              <div className="text-sm text-gray-600">
                #{b.id} · {b?.service_title || b?.title || t("booking.title", { defaultValue: "Бронирование" })} ·{" "}
                <span className="text-gray-500">{String(b.status || "").toLowerCase()}</span>
              </div>

              <div className="mt-1">
                <b>{t("common.provider", { defaultValue: "Поставщик" })}</b>:{" "}
                {providerName || "—"}
              </div>

              <div className="text-sm text-gray-700 mt-1">
                {providerPhone && (
                  <>
                    {t("client.dashboard.phone", { defaultValue: "Телефон" })}:{" "}
                    <a className="hover:underline" href={`tel:${String(providerPhone).replace(/[^+\d]/g, "")}`}>
                      {providerPhone}
                    </a>{" "}
                  </>
                )}
                {providerTg && (
                  <>
                    · Telegram:{" "}
                    <a
                      className="hover:underline"
                      href={`https://t.me/${String(providerTg).replace(/^@/, "")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      @{String(providerTg).replace(/^@/, "")}
                    </a>
                  </>
                )}
                {address && <> · {t("common.address", { defaultValue: "Адрес" })}: {address}</>}
              </div>

              {dates && (
                <div className="text-sm text-gray-700 mt-1">
                  {t("common.date", { defaultValue: "Дата" })}: {dates}
                </div>
              )}

              {!!b?.client_message && (
                <div className="mt-2 text-sm">
                  <b>{t("common.comment", { defaultValue: "Комментарий" })}</b>: {b.client_message}
                </div>
              )}

              {!!b?.provider_price && (
                <div className="mt-2">
                  <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 text-emerald-800 px-2 py-1 text-sm">
                    {t("bookings.last_offer", { defaultValue: "Предложение поставщика" })}:{" "}
                    <b>{fmt(Number(b.provider_price))}</b>{" "}
                    {b.currency || "USD"}
                    {b.provider_note ? ` · ${b.provider_note}` : ""}
                  </span>
                </div>
              )}

              <AttachmentList items={b.attachments} />

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => confirmBooking(b)}
                  disabled={!canConfirm(b)}
                  className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-50"
                >
                  {t("actions.confirm", { defaultValue: "Подтвердить" })}
                </button>
                <button
                  onClick={() => declineBooking(b)}
                  className="px-4 py-2 rounded bg-red-600 text-white"
                >
                  {t("actions.reject", { defaultValue: "Отклонить" })}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }, [list, loading, t]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-3">
        {t("bookings.title_client", { defaultValue: "Мои бронирования" })}
      </h2>
      {content}
    </div>
  );
}
