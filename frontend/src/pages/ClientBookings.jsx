// frontend/src/pages/ClientBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api";
import { tSuccess, tError, tInfo } from "../shared/toast";

/* ================= helpers ================= */

const arrify = (res) =>
  Array.isArray(res) ? res : res?.items || res?.data || res?.list || res?.results || [];

/** безопасная загрузка «моих» бронирований с фолбэками */
async function fetchClientBookingsSafe() {
  const candidates = [
    "/api/bookings/my",
    "/api/bookings/mine",
    "/api/my/bookings",
    "/api/client/bookings",
    "/api/clients/bookings",
    "/api/bookings?mine=1",
    "/api/bookings?me=1",
  ];
  for (const url of candidates) {
    try {
      const r = await apiGet(url);
      return arrify(r);
    } catch {}
  }
  return [];
}

/** постим на первый сработавший эндпоинт из списка */
async function postOneOf(paths = [], body = {}) {
  let lastErr;
  for (const p of paths) {
    try {
      return await apiPost(p, body);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("No endpoint accepted the request");
}

function tryParseJSON(val) {
  if (!val) return null;
  if (Array.isArray(val) || typeof val === "object") return val;
  try { return JSON.parse(String(val)); } catch { return null; }
}
function asArray(x) {
  const v = tryParseJSON(x) ?? x;
  if (!v) return [];
  return Array.isArray(v) ? v : typeof v === "object" ? [v] : [];
}
function isImage(att) {
  const type = att?.type || "";
  const url  = att?.url || att?.src || att?.href || (typeof att === "string" ? att : "");
  return /(^image\/)/i.test(String(type)) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(url || ""));
}
function normalizeTelegram(v) {
  if (!v) return null;
  let s = String(v).trim().replace(/\s+/g, "");
  if (!s) return null;

  const mUrl = s.match(/(?:https?:\/\/)?(?:t\.me|telegram\.(?:me|dog))\/(@?[\w\d_]+)/i);
  if (mUrl) { const u = mUrl[1].replace(/^@/, ""); return { href: `https://t.me/${u}`, label: `@${u}` }; }
  const mUser = s.match(/^@?([\w\d_]{3,})$/);
  if (mUser) { const u = mUser[1]; return { href: `https://t.me/${u}`, label: `@${u}` }; }
  return { href: s.startsWith("http") ? s : `https://t.me/${s.replace(/^@/, "")}`, label: s.startsWith("@") ? s : `@${s}` };
}
const fmtMoney = (n) =>
  Number.isFinite(Number(n)) ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";

/* ================ Attachments block ================ */
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
          const att  = typeof raw === "string" ? { url: raw } : raw || {};
          const url  = att.url || att.src || att.href || "";
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

/* ================ Single booking card ================ */
function ClientBookingCard({ b, onConfirm, onReject }) {
  const { t } = useTranslation();

  // провайдерские поля из плоских алиасов + запасные из вложенного объекта
  const providerId    = b.provider_id ?? b.providerId ?? b.provider?.id ?? null;
  const providerName  = b.provider_name ?? b.provider?.name ?? null;
  const providerAddr  = b.provider_address ?? b.provider?.address ?? b.address ?? null;
  const providerPhone = b.provider_phone ?? b.provider?.phone ?? b.phone ?? null;
  const providerTgRaw = b.provider_telegram ?? b.provider_social ?? b.provider?.telegram ?? b.provider?.social ?? null;
  const providerTg    = normalizeTelegram(providerTgRaw);

  const created = b.created_at ? new Date(b.created_at).toLocaleString() : "";
  const status  = String(b.status || "").toLowerCase();

  const datesList = (b.dates && Array.isArray(b.dates) ? b.dates : []).map(d => String(d).slice(0,10)).join(", ");

  const canConfirmOrReject =
    Number.isFinite(Number(b.provider_price)) &&
    Number(b.provider_price) > 0 &&
    ["pending","quoted","awaiting_client","waiting_client","price_sent"].includes(status);

  return (
    <div className="border rounded-xl p-4 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* header line */}
          <div className="text-sm text-gray-500">
            #{b.id} · {b.service_title || t("common.service", { defaultValue: "услуга" })} · {status}
          </div>

          {/* provider line */}
          <div className="mt-0.5 text-base">
            <span className="text-gray-500">{t("roles.provider", { defaultValue: "Поставщик" })}</span>
            {" · "}
            {providerId ? (
              <Link className="font-semibold underline" to={`/profile/provider/${providerId}`}>
                {providerName || t("roles.provider", { defaultValue: "Поставщик" })}
              </Link>
            ) : (
              <span className="font-semibold">{providerName || t("roles.provider", { defaultValue: "Поставщик" })}</span>
            )}
          </div>

          {/* contacts */}
          <div className="text-sm text-gray-700 mt-1 space-x-3">
            {providerPhone && (
              <span>
                {t("marketplace.phone", { defaultValue: "Телефон" })}:{" "}
                <a className="underline" href={`tel:${String(providerPhone).replace(/[^+\d]/g, "")}`}>{providerPhone}</a>
              </span>
            )}
            {providerTg?.label && (
              <span>
                {t("marketplace.telegram", { defaultValue: "Телеграм" })}:{" "}
                {providerTg.href ? (
                  <a className="underline break-all" href={providerTg.href} target="_blank" rel="noreferrer">
                    {providerTg.label}
                  </a>
                ) : (
                  <span>{providerTg.label}</span>
                )}
              </span>
            )}
            {providerAddr && (
              <span>
                {t("marketplace.address", { defaultValue: "Адрес" })}: <b>{providerAddr}</b>
              </span>
            )}
          </div>

          {/* dates & created */}
          <div className="text-sm text-gray-500 mt-1">
            {t("common.date", { defaultValue: "Дата" })}: {datesList || "—"}
          </div>
          {created && (
            <div className="text-xs text-gray-400 mt-0.5">
              {t("common.created", { defaultValue: "Создан" })}: {created}
            </div>
          )}

          {/* your message */}
          {b.client_message && (
            <div className="text-sm text-gray-700 whitespace-pre-line mt-2">
              <b>{t("common.comment", { defaultValue: "Комментарий" })}:</b> {b.client_message}
            </div>
          )}

          {/* provider price / note */}
          {Number.isFinite(Number(b.provider_price)) && Number(b.provider_price) > 0 && (
            <div className="mt-2 text-sm text-gray-800">
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
                {t("bookings.provider_offer", { defaultValue: "Предложение поставщика" })}:
                {" "}
                <b>{fmtMoney(b.provider_price)}</b> {b.currency || "USD"}
              </span>
              {b.provider_note ? <span className="ml-2 text-gray-600">· {b.provider_note}</span> : null}
            </div>
          )}

          {/* attachments */}
          <AttachmentList items={b.attachments} />
        </div>

        {/* actions */}
        <div className="shrink-0 flex flex-col gap-2">
          {canConfirmOrReject && (
            <>
              <button
                onClick={() => onConfirm?.(b)}
                className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white text-sm"
              >
                {t("actions.confirm", { defaultValue: "Подтвердить" })}
              </button>
              <button
                onClick={() => onReject?.(b)}
                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-sm"
              >
                {t("actions.reject", { defaultValue: "Отклонить" })}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================= Page ================= */
export default function ClientBookings({ refreshKey = 0 }) {
  const { t } = useTranslation();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await fetchClientBookingsSafe();
      setList(rows);
    } catch (e) {
      console.error("load client bookings failed", e);
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { load(); }, [refreshKey]); // реагируем на проп от Dashboard

  // слушатель глобального события
  useEffect(() => {
    const onRefresh = () => load();
    window.addEventListener("client:bookings:refresh", onRefresh);
    return () => window.removeEventListener("client:bookings:refresh", onRefresh);
  }, []);

  const confirm = async (b) => {
    try {
      // согласие клиента на цену поставщика
      await postOneOf(
        [
          `/api/bookings/${b.id}/confirm`,        // предпочтительно
          `/api/bookings/${b.id}/accept-client`,  // вариант 2
          `/api/bookings/${b.id}/approve`,        // вариант 3
          `/api/bookings/${b.id}/accept`,         // крайний случай (если бэк не различает роли)
        ],
        {}
      );
      tSuccess(t("bookings.accepted", { defaultValue: "Бронь подтверждена" }), { autoClose: 1600 });
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.accept_error", { defaultValue: "Ошибка подтверждения" }));
    } finally {
      await load();
      window.dispatchEvent(new Event("client:counts:refresh"));
    }
  };

  const reject = async (b) => {
    try {
      // отказ клиента от предложенной цены/брони
      await postOneOf(
        [
          `/api/bookings/${b.id}/reject-client`,
          `/api/bookings/${b.id}/decline`,
          `/api/bookings/${b.id}/reject`,
          `/api/bookings/${b.id}/cancel`,
        ],
        {}
      );
      tInfo(t("bookings.rejected", { defaultValue: "Бронь отклонена" }), { autoClose: 1500 });
    } catch (e) {
      tError(e?.response?.data?.message || t("bookings.reject_error", { defaultValue: "Ошибка отклонения" }));
    } finally {
      await load();
      window.dispatchEvent(new Event("client:counts:refresh"));
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
          <ClientBookingCard key={b.id} b={b} onConfirm={confirm} onReject={reject} />
        ))}
      </div>
    );
  }, [list, loading, t]);

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">
        {t("bookings.title_client", { defaultValue: "Мои бронирования" })}
      </h2>
      {content}
    </div>
  );
}
