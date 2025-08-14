// src/components/ProviderInboxList.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";

function StatusBadge({ status }) {
  const map =
    status === "new"
      ? "bg-yellow-100 text-yellow-800"
      : status === "rejected"
      ? "bg-red-100 text-red-700"
      : status === "processed"
      ? "bg-green-100 text-green-700"
      : status === "active"
      ? "bg-blue-100 text-blue-700"
      : "bg-gray-100 text-gray-700";
  const label =
    status === "new"
      ? "New"
      : status === "rejected"
      ? "Rejected"
      : status === "processed"
      ? "Processed"
      : status === "active"
      ? "Active"
      : status || "—";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map}`}>
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
      second: "2-digit",
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
  const [busy, setBusy] = useState({});
  const [busyDel, setBusyDel] = useState({});

  const token = localStorage.getItem("token");
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const config = { headers: { Authorization: `Bearer ${token}` } };

  const load = async () => {
    try {
      setLoading(true);
      try { await axios.post(`${API_BASE}/api/requests/cleanup-expired`, {}, config); } catch {}
      const res = await axios.get(`${API_BASE}/api/requests/provider`, config);
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch (e) {
      console.error("Ошибка загрузки входящих:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleMarkProcessed = async (id) => {
    if (!id) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await axios.put(`${API_BASE}/api/requests/${id}/processed`, {}, config);
      setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: "processed" } : r)));
    } catch (e) {
      console.error("mark processed failed:", e?.response?.data || e?.message);
      alert(t("errors.action_failed", { defaultValue: "Action failed" }));
    } finally {
      setBusy((b) => {
        const n = { ...b };
        delete n[id];
        return n;
      });
    }
  };

  const handleDelete = async (id) => {
    if (!id) return;
    if (!window.confirm(t("provider.inbox.confirm_delete", { defaultValue: "Delete request?" }))) {
      return;
    }
    setBusyDel((b) => ({ ...b, [id]: true }));
    try {
      await axios.delete(`${API_BASE}/api/requests/${id}`, config);
      setItems((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      console.error("delete request failed:", e?.response?.data || e?.message);
      alert(t("errors.action_failed", { defaultValue: "Action failed" }));
    } finally {
      setBusyDel((b) => {
        const n = { ...b };
        delete n[id];
        return n;
      });
    }
  };

  return (
    <div className="space-y-4">
      {showHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-[20px] font-semibold">
            {t("provider.inbox.title", { defaultValue: "Входящие заявки" })}
          </h3>
          <button
            onClick={load}
            disabled={loading}
            className={`px-3 py-1 rounded-md text-white text-sm ${
              loading ? "bg-blue-300 cursor-wait" : "bg-blue-500 hover:bg-blue-600"
            }`}
          >
            {t("common.refresh", { defaultValue: "refresh" })}
          </button>
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-500">
          {t("common.loading", { defaultValue: "Loading…" })}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-sm text-gray-500">
          {t("provider.inbox.empty", { defaultValue: "No requests" })}
        </div>
      )}

      <div className="space-y-3">
        {items.map((r) => {
          const phone = r?.client?.phone || null;
          const tg = r?.client?.telegram || null;
          const tgHref = makeTgHref(tg);
          const isProcessed = String(r.status) === "processed";

          return (
            <div
              key={r.id}
              className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
            >
              {/* Верхняя строка: заголовок услуги */}
              <div className="text-[15px] font-semibold text-gray-900">
                {r.service?.title || "—"}
              </div>

              {/* Подзаголовок: от кого */}
              <div className="mt-1 text-sm text-gray-600">
                {t("provider.inbox.from", { defaultValue: "От" })}:{" "}
                <span className="font-medium text-gray-800">
                  {r.client?.name || "—"}
                </span>
                {phone ? (
                  <>
                    ,{" "}
                    <a
                      href={`tel:${phone}`}
                      className="text-gray-800 underline decoration-gray-300 hover:decoration-transparent"
                    >
                      {phone}
                    </a>
                  </>
                ) : null}
                {tg ? (
                  <>
                    ,{" "}
                    <a
                      href={tgHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-800 underline decoration-gray-300 hover:decoration-transparent"
                    >
                      {tg.startsWith("@") ? tg : `@${tg.replace(/^https?:\/\/t\.me\//i, "")}`}
                    </a>
                  </>
                ) : null}
              </div>

              {/* Дата + статус-бейдж */}
              <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                <span>{formatDate(r.created_at)}</span>
                <span className="mx-1">•</span>
                <StatusBadge status={r.status} />
              </div>

              {/* Кнопки */}
              <div className="mt-3 flex items-center gap-8">
                <div className="flex items-center gap-8">
                  {!isProcessed && (
                    <button
                      onClick={() => handleMarkProcessed(r.id)}
                      disabled={!!busy[r.id]}
                      className={`px-3 py-1 rounded-md text-sm text-white ${
                        busy[r.id] ? "bg-green-300 cursor-wait" : "bg-green-600 hover:bg-green-700"
                      }`}
                    >
                      {t("provider.inbox.mark_processed", { defaultValue: "Обработано" })}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(r.id)}
                    disabled={!!busyDel[r.id]}
                    className={`px-3 py-1 rounded-md text-sm text-white ${
                      busyDel[r.id] ? "bg-red-300 cursor-wait" : "bg-red-600 hover:bg-red-700"
                    }`}
                  >
                    {t("delete", { defaultValue: "Удалить" })}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProviderInboxList;
