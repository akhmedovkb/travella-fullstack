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
  localStorage.getItem("providerToken"); // на всякий случай
const cfg = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });

const isFiniteNum = (n) => Number.isFinite(n) && !Number.isNaN(n);
const fmt = (n) =>
  isFiniteNum(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";

/** единственный загрузчик */
async function fetchMyBookings() {
  const url = `${API_BASE}/api/bookings/my`;
  const res = await axios.get(url, cfg());
  return Array.isArray(res.data) ? res.data : res.data?.items || [];
}

/** универсальная попытка запроса; 2xx – успех, остальные пробуем дальше */
async function tryOne(method, url, data) {
  try {
    const r = await axios({
      method,
      url,
      data,
      ...cfg(),
      validateStatus: (s) => s >= 200 && s < 300, // считаем успехом только 2xx
    });
    return { ok: true, data: r.data };
  } catch (e) {
    // 404/400/… — возвращаем как "неудачу", чтобы попробовать следующий вариант
    return { ok: false, error: e };
  }
}

/**
 * Фолбэк-исполнитель действия клиента над бронированием.
 * action: "confirm" | "reject"
 */
async function performClientAction(bookingId, action) {
  const id = String(bookingId);
  const isConfirm = action === "confirm";

  // множество синонимов для бэков разных версий
  const slugs = isConfirm
    ? ["confirm", "approve", "accept", "client-accept", "accept-client", "confirm-client", "approve-client"]
    : ["reject", "decline", "cancel", "client-reject", "reject-client", "client-decline", "cancel-client"];

  // кандидаты URL/метод/данные в порядке убывания вероятности
  const candidates = [];

  // 1) POST /api/bookings/:id/<slug>
  slugs.forEach((slug) => {
    candidates.push(["post", `${API_BASE}/api/bookings/${id}/${slug}`, undefined]);
  });

  // 2) POST /api/client/bookings/:id/<slug>  и  /api/clients/…
  slugs.forEach((slug) => {
    candidates.push(["post", `${API_BASE}/api/client/bookings/${id}/${slug}`, undefined]);
    candidates.push(["post", `${API_BASE}/api/clients/bookings/${id}/${slug}`, undefined]);
  });

  // 3) POST /api/bookings/<slug>  с id в теле
  slugs.forEach((slug) => {
    candidates.push(["post", `${API_BASE}/api/bookings/${slug}`, { id }]);
  });

  // 4) POST /api/client/bookings/<slug>  и  /api/clients/bookings/<slug>  с id в теле
  slugs.forEach((slug) => {
    candidates.push(["post", `${API_BASE}/api/client/bookings/${slug}`, { id }]);
    candidates.push(["post", `${API_BASE}/api/clients/bookings/${slug}`, { id }]);
  });

  // 5) PATCH /api/bookings/:id  c status
  candidates.push([
    "patch",
    `${API_BASE}/api/bookings/${id}`,
    { status: isConfirm ? "confirmed" : "rejected" },
  ]);
  candidates.push([
    "put",
    `${API_BASE}/api/bookings/${id}`,
    { status: isConfirm ? "confirmed" : "rejected" },
  ]);

  // Пробуем по очереди
  let lastErr = null;
  for (const [method, url, data] of candidates) {
    const res = await tryOne(method, url, data);
    if (res.ok) return { ok: true, data: res.data, url, method };
    lastErr = res.error;
    // продолжим попытки
  }
  return { ok: false, error: lastErr };
}

/* ========= простая карточка ========= */
function AttachmentList({ items }) {
  const files = Array.isArray(items) ? items : items ? [items] : [];
  if (!files.length) return null;
  return (
    <div className="mt-2">
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
              className="px-2 py-1 text-sm rounded border bg-gray-50 hover:bg-gray-100"
            >
              {name || "файл"}
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* ========= страница ========= */
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
    // хук на «Обновить» из Dashboard
    const onRefresh = () => load();
    window.addEventListener("client:bookings:refresh", onRefresh);
    return () => window.removeEventListener("client:bookings:refresh", onRefresh);
  }, []);

  const confirm = async (b) => {
    setActingId(b.id);
    try {
      const res = await performClientAction(b.id, "confirm");
      if (res.ok) {
        tSuccess(t("bookings.confirmed", { defaultValue: "Бронирование подтверждено" }));
        await load();
      } else {
        console.warn("confirm failed last error:", res.error);
        tError(
          res.error?.response?.data?.message ||
            t("bookings.confirm_error", { defaultValue: "Ошибка подтверждения" })
        );
      }
    } finally {
      setActingId(null);
    }
  };

  const reject = async (b) => {
    setActingId(b.id);
    try {
      const res = await performClientAction(b.id, "reject");
      if (res.ok) {
        tInfo(t("bookings.rejected", { defaultValue: "Бронирование отклонено" }));
        await load();
      } else {
        console.warn("reject failed last error:", res.error);
        tError(
          res.error?.response?.data?.message ||
            t("bookings.reject_error", { defaultValue: "Ошибка отклонения" })
        );
      }
    } finally {
      setActingId(null);
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
          const providerName =
            b.provider_name || b.provider?.name || b.service?.provider_name || b.service?.providerTitle;
          const providerPhone =
            b.provider_phone || b.provider?.phone;
          const providerTg =
            b.provider_telegram || b.provider?.telegram || b.provider?.social;

          const dates =
            Array.isArray(b.dates) && b.dates.length >= 2
              ? `${b.dates[0].slice(0, 10)}, ${b.dates[1].slice(0, 10)}`
              : "";

          const lastOffer =
            b.provider_price ? `${fmt(Number(b.provider_price))} ${b.currency || "USD"}` : null;

          return (
            <div key={b.id} className="border rounded-xl p-4 bg-white">
              <div className="text-sm text-gray-500">
                #{b.id} · {b.service_title || b.service?.title || t("booking.title", { defaultValue: "Бронирование" })} ·{" "}
                <span className="lowercase">{String(b.status || "").toLowerCase()}</span>
              </div>

              <div className="mt-1">
                <span className="text-gray-500">{t("bookings.provider", { defaultValue: "Поставщик" })}: </span>
                <b>{providerName || "—"}</b>
              </div>

              <div className="text-sm text-gray-700 mt-1">
                {providerPhone ? (
                  <a className="hover:underline mr-3" href={`tel:${String(providerPhone).replace(/[^+\d]/g, "")}`}>
                    {providerPhone}
                  </a>
                ) : null}
                {providerTg ? (
                  <a
                    className="hover:underline"
                    href={
                      /^https?:\/\//i.test(providerTg)
                        ? providerTg
                        : `https://t.me/${String(providerTg).replace(/^@/, "")}`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {String(providerTg).startsWith("@") ? providerTg : `@${String(providerTg).replace(/^@/, "")}`}
                  </a>
                ) : null}
              </div>

              {b.client_message && (
                <div className="text-sm text-gray-700 mt-2">
                  <span className="text-gray-500">{t("common.comment", { defaultValue: "Комментарий" })}:</span>{" "}
                  {b.client_message}
                </div>
              )}

              {lastOffer && (
                <div className="mt-2">
                  <span className="inline-flex items-center gap-2 rounded bg-green-50 text-green-700 px-2 py-1 text-sm">
                    {t("bookings.provider_offer", { defaultValue: "Предложение поставщика" })}: <b>{lastOffer}</b>
                    {b.provider_note ? <span className="text-gray-600">· {b.provider_note}</span> : null}
                  </span>
                </div>
              )}

              <div className="text-sm text-gray-600 mt-1">
                {t("common.date", { defaultValue: "Дата" })}: {dates || "—"}
              </div>

              <AttachmentList items={b.attachments} />

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => confirm(b)}
                  disabled={actingId === b.id}
                  className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-60"
                >
                  {t("actions.confirm", { defaultValue: "Подтвердить" })}
                </button>
                <button
                  onClick={() => reject(b)}
                  disabled={actingId === b.id}
                  className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-60"
                >
                  {t("actions.reject", { defaultValue: "Отклонить" })}
                </button>
              </div>
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
