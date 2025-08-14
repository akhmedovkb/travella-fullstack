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
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map}`}>
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

/**
 * props:
 *  - showHeader?: boolean
 *  - cleanupExpired?: ()=>Promise<void>           // опц. внешний триггер автоочистки
 *  - nameResolver?: (req)=>Promise<string>        // опц. резолвер имени клиента
 *  - onAfterAction?: ()=>Promise<void>|void       // дергается после обработано/удалить
 *  - onCounters?: ({total,new,processed})=>void   // сообщает счётчики наверх (для бейджа)
 */
const ProviderInboxList = ({
  showHeader = false,
  cleanupExpired,
  nameResolver,
  onAfterAction,
  onCounters,
}) => {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState({});
  const [busyDel, setBusyDel] = useState({});
  const [counters, setCounters] = useState({ total: 0, new: 0, processed: 0 });

  const token = localStorage.getItem("token");
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const config = { headers: { Authorization: `Bearer ${token}` } };

  const pullCounters = async () => {
    try {
      const s = await axios.get(`${API_BASE}/api/requests/provider/stats`, config);
      const next = {
        total: Number(s?.data?.total) || 0,
        new: Number(s?.data?.new) || 0,
        processed: Number(s?.data?.processed) || 0,
      };
      setCounters(next);
      onCounters?.(next);
    } catch {
      // если бек не ответил — посчитаем по локальному списку
      const total = items.length;
      const fresh = items.filter((r) => !r.status || String(r.status) === "new").length;
      const processed = items.filter((r) => String(r.status) === "processed").length;
      const next = { total, new: fresh, processed };
      setCounters(next);
      onCounters?.(next);
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      // авто-очистка (если есть внешний helper — сначала он)
      try {
        if (typeof cleanupExpired === "function") await cleanupExpired();
        else await axios.post(`${API_BASE}/api/requests/cleanup-expired`, {}, config);
      } catch {}
      // инбокс
      const res = await axios.get(`${API_BASE}/api/requests/provider`, config);
      const arr = Array.isArray(res?.data?.items) ? res.data.items : [];
      // обогащение "От:" если юзер захотел свой резолвер
      if (typeof nameResolver === "function") {
        for (const r of arr) {
          if (!r?.client?.name) {
            try {
              const nm = await nameResolver(r);
              if (nm && r.client) r.client.name = nm;
            } catch {}
          }
        }
      }
      setItems(arr);
    } catch (e) {
      console.error("Ошибка загрузки входящих:", e);
    } finally {
      setLoading(false);
      // обновим счётчики после любой загрузки
      pullCounters();
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
      // FIX: правильный эндпоинт/тело запроса
      await axios.put(`${API_BASE}/api/requests/${id}/status`, { status: "processed" }, config);
      setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: "processed" } : r)));
      await pullCounters();
      await onAfterAction?.();
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
    if (
      !window.confirm(
        t("provider.inbox.confirm_delete", { defaultValue: "Delete request?" })
      )
    ) {
      return;
    }
    setBusyDel((b) => ({ ...b, [id]: true }));
    try {
      await axios.delete(`${API_BASE}/api/requests/${id}`, config);
      setItems((prev) => prev.filter((r) => r.id !== id));
      await pullCounters();
      await onAfterAction?.();
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
    <div>
      {showHeader && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-semibold">
              {t("provider.inbox.title", { defaultValue: "Incoming Requests" })}
            </h3>
            {/* мини-счётчики как на скрине */}
            <div className="text-sm text-gray-600 flex items-center gap-4">
              <span>
                {t("provider.inbox.total", { defaultValue: "Всего" })}:{" "}
                <b>{counters.total}</b>
              </span>
              <span>
                {t("provider.inbox.new", { defaultValue: "Новые" })}:{" "}
                <b>{counters.new}</b>
              </span>
              <span>
                {t("provider.inbox.processed", { defaultValue: "Обработанные" })}:{" "}
                <b>{counters.processed}</b>
              </span>
            </div>
          </div>
          <button
            onClick={load}
            className="text-orange-600 hover:text-orange-700 text-sm"
            disabled={loading}
          >
            {t("common.refresh", { defaultValue: "Refresh" })}
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

      <div className="space-y-4">
        {items.map((r) => {
          const phone = r?.client?.phone || null;
          const tg = r?.client?.telegram || null;
          const tgHref = makeTgHref(tg);
          const isProcessed = String(r.status) === "processed";

          return (
            <div key={r.id} className="border rounded-lg p-4 bg-white shadow-sm">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-medium">#{r.id}</span>
                <StatusBadge status={r.status || "new"} />
                <span>•</span>
                <span>{formatDate(r.created_at)}</span>
              </div>

              <div className="mt-2">
                <div className="text-sm text-gray-600">
                  {t("service", { defaultValue: "Service" })}:
                </div>
                <div className="text-base font-semibold">
                  {r.service?.title || "—"}
                </div>
              </div>

              <div className="mt-2 text-sm">
                <div className="text-gray-600">
                  {t("provider.inbox.from", { defaultValue: "From" })}:
                </div>
                <div className="font-medium">
                  {r.client?.name || "—"}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-700">
                  {phone ? (
                    <a href={`tel:${phone}`} className="underline hover:no-underline">
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
                      title="Telegram"
                    >
                      {tg.startsWith("@") ? tg : `@${tg.replace(/^https?:\/\/t\.me\//i, "")}`}
                    </a>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </div>
              </div>

              {r.note && (
                <div className="mt-3">
                  <div className="text-sm text-gray-600">
                    {t("comment", { defaultValue: "Comment" })}:
                  </div>
                  <div className="text-sm bg-gray-50 border rounded px-3 py-2">
                    {r.note}
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                {!isProcessed && (
                  <button
                    onClick={() => handleMarkProcessed(r.id)}
                    disabled={!!busy[r.id]}
                    className={`px-3 py-1 rounded text-sm text-white ${
                      busy[r.id] ? "bg-green-300 cursor-wait" : "bg-green-600 hover:bg-green-700"
                    }`}
                  >
                    {t("provider.inbox.mark_processed", { defaultValue: "Processed" })}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(r.id)}
                  disabled={!!busyDel[r.id]}
                  className={`px-3 py-1 rounded text-sm text-white ${
                    busyDel[r.id] ? "bg-red-300 cursor-wait" : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {t("delete", { defaultValue: "Delete" })}
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
