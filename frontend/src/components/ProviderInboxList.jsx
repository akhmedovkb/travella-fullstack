// src/components/ProviderInboxList.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";

/* ===== Helpers ===== */
function StatusBadge({ status }) {
  const map =
    status === "new"
      ? "bg-yellow-100 text-yellow-800"
      : status === "processed"
      ? "bg-green-100 text-green-700"
      : status === "rejected"
      ? "bg-red-100 text-red-700"
      : status === "active"
      ? "bg-blue-100 text-blue-700"
      : "bg-gray-100 text-gray-700";
  const label =
    status === "new"
      ? "New"
      : status === "processed"
      ? "Processed"
      : status === "rejected"
      ? "Rejected"
      : status === "active"
      ? "Active"
      : status || "—";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map}`}
    >
      {label}
    </span>
  );
}

function formatDate(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function makeTgHref(v) {
  if (!v) return null;
  let s = String(v).trim();
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("@")) s = s.slice(1);
  return `https://t.me/${s}`;
}

const ProviderInboxList = ({ showHeader = false }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const token = localStorage.getItem("token");
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const config = { headers: { Authorization: `Bearer ${token}` } };

  const load = async () => {
    try {
      setLoading(true);
      // авто-очистка перед загрузкой
      await axios.delete(`${API_BASE}/api/requests/cleanup`, config);

      const res = await axios.get(
        `${API_BASE}/api/requests/provider`,
        config
      );
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch (e) {
      console.error("Ошибка загрузки входящих:", e);
    } finally {
      setLoading(false);
    }
  };

  const markProcessed = async (id) => {
    try {
      await axios.patch(
        `${API_BASE}/api/requests/${id}/status`,
        { status: "processed" },
        config
      );
      setItems((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "processed" } : r))
      );
    } catch (e) {
      console.error("Ошибка обновления статуса:", e);
    }
  };

  const removeRequest = async (id) => {
    if (!window.confirm(t("confirm_delete", { defaultValue: "Удалить заявку?" })))
      return;
    try {
      await axios.delete(`${API_BASE}/api/requests/${id}`, config);
      setItems((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      console.error("Ошибка удаления заявки:", e);
    }
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div>
      {showHeader && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xl font-semibold">
            {t("incoming_requests", { defaultValue: "Входящие запросы" })}
          </h3>
          <button
            onClick={load}
            className="text-orange-600 hover:text-orange-700 text-sm"
            disabled={loading}
          >
            {t("refresh", { defaultValue: "Обновить" })}
          </button>
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-500">
          {t("loading", { defaultValue: "Загрузка..." })}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-sm text-gray-500">
          {t("no_inbox", { defaultValue: "Пока нет входящих запросов." })}
        </div>
      )}

      <div className="space-y-4">
        {items.map((r) => {
          const phone = r?.client?.phone || null;
          const tg = r?.client?.telegram || null;
          const tgHref = makeTgHref(tg);

          return (
            <div
              key={r.id}
              className="border rounded-lg p-4 bg-white shadow-sm"
            >
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-medium">#{r.id}</span>
                <StatusBadge status={r.status} />
                <span>•</span>
                <span>{formatDate(r.created_at)}</span>
              </div>

              <div className="mt-2">
                <div className="text-sm text-gray-600">
                  {t("service", { defaultValue: "Услуга" })}:
                </div>
                <div className="text-base font-semibold">
                  {r.service?.title || "—"}
                </div>
              </div>

              <div className="mt-2 text-sm">
                <div className="text-gray-600">
                  {t("from_whom", { defaultValue: "От кого" })}:
                </div>
                <div className="font-medium">
                  {r.client?.name || "—"}
                </div>

                {/* телефон и телеграм */}
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-700">
                  {phone ? (
                    <a
                      href={`tel:${phone}`}
                      className="underline hover:no-underline"
                      title={t("call", { defaultValue: "Позвонить" })}
                    >
                      {phone}
                    </a>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                  {tg ? (
                    <a
                      href={tgHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:no-underline"
                      title="Открыть в Telegram"
                    >
                      {tg.startsWith("@")
                        ? tg
                        : `@${tg.replace(/^https?:\/\/t\.me\//i, "")}`}
                    </a>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </div>
              </div>

              {r.note && (
                <div className="mt-3">
                  <div className="text-sm text-gray-600">
                    {t("comment", { defaultValue: "Комментарий" })}:
                  </div>
                  <div className="text-sm bg-gray-50 border rounded px-3 py-2">
                    {r.note}
                  </div>
                </div>
              )}

              {/* Кнопки действий */}
              <div className="mt-3 flex gap-3">
                {r.status === "new" && (
                  <button
                    onClick={() => markProcessed(r.id)}
                    className="px-3 py-1 bg-green-100 text-green-700 rounded text-sm hover:bg-green-200"
                  >
                    {t("mark_processed", { defaultValue: "Отметить как обработано" })}
                  </button>
                )}
                <button
                  onClick={() => removeRequest(r.id)}
                  className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200"
                >
                  {t("delete", { defaultValue: "Удалить" })}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProviderInboxList;
