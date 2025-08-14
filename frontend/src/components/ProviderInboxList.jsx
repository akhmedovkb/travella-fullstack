// src/components/ProviderInboxList.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";

/* ------------------------ UI helpers ------------------------ */

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

/* ------------------------ Nice Confirm ------------------------ */

function ConfirmModal({ open, title, message, confirmText = "OK", cancelText = "Отмена", onClose, onConfirm }) {
  // закрытие по ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[999]">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-black/5">
          <div className="px-5 pt-5">
            <h4 className="text-lg font-semibold">{title}</h4>
            <p className="mt-2 text-sm text-gray-600">{message}</p>
          </div>
          <div className="mt-5 px-5 pb-5 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-sm ring-1 ring-gray-300 hover:bg-gray-50"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className="px-3 py-1.5 rounded-md text-sm text-white bg-red-600 hover:bg-red-700"
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------ Tiny Toasts ------------------------ */

function ToastHost({ toasts, onDone }) {
  return (
    <div className="fixed right-4 bottom-4 z-[998] space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-lg px-3 py-2 shadow-lg ring-1 ring-black/5 text-sm text-white ${
            t.kind === "error" ? "bg-red-600" : "bg-green-600"
          }`}
          onAnimationEnd={() => onDone(t.id)}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ------------------------ Main component ------------------------ */

const ProviderInboxList = ({ showHeader = false, onCounters /* optional: позволяет пробросить цифры в шапку */ }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState({});
  const [busyDel, setBusyDel] = useState({});
  const [stats, setStats] = useState({ total: 0, new: 0, processed: 0 });

  // confirm
  const [confirm, setConfirm] = useState({
    open: false,
    title: "",
    message: "",
    resolve: null,
  });
  const askConfirm = (title, message) =>
    new Promise((resolve) => setConfirm({ open: true, title, message, resolve }));
  const closeConfirm = () => setConfirm((c) => ({ ...c, open: false }));

  // toasts
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(1);
  const pushToast = (text, kind = "ok") => {
    const id = toastId.current++;
    setToasts((arr) => [...arr, { id, text, kind }]);
    // автоудаление
    setTimeout(() => setToasts((arr) => arr.filter((x) => x.id !== id)), 2200);
  };

  // API
  const token = localStorage.getItem("token");
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const config = useMemo(() => ({ headers: { Authorization: `Bearer ${token}` } }), [token]);

  const fetchStats = async () => {
    try {
      const r = await axios.get(`${API_BASE}/api/requests/provider/stats`, config);
      const s = r.data || { total: 0, new: 0, processed: 0 };
      setStats(s);
      onCounters?.(s); // отдать наверх, если нужно показать в бейдже меню
    } catch (e) {
      // не шумим тостом — это вспомогательный вызов
      console.error("stats load error:", e?.response?.data || e?.message);
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      try {
        // не обязательно, но можно вручную инициировать очистку
        await axios.post(`${API_BASE}/api/requests/cleanup-expired`, {}, config);
      } catch {}
      const res = await axios.get(`${API_BASE}/api/requests/provider`, config);
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
      await fetchStats();
    } catch (e) {
      console.error("Ошибка загрузки входящих:", e);
      pushToast(t("errors.loading_error", { defaultValue: "Failed to load data" }), "error");
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
      pushToast(t("provider.inbox.mark_processed", { defaultValue: "Processed" }));
      fetchStats();
    } catch (e) {
      console.error("mark processed failed:", e?.response?.data || e?.message);
      pushToast(t("errors.action_failed", { defaultValue: "Action failed" }), "error");
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
    const ok = await askConfirm(
      t("delete", { defaultValue: "Delete" }),
      t("provider.inbox.confirm_delete", { defaultValue: "Delete request?" })
    );
    closeConfirm();
    if (!ok) return;

    setBusyDel((b) => ({ ...b, [id]: true }));
    try {
      await axios.delete(`${API_BASE}/api/requests/${id}`, config);
      setItems((prev) => prev.filter((r) => r.id !== id));
      pushToast(t("service_deleted", { defaultValue: "Deleted" }));
      fetchStats();
    } catch (e) {
      console.error("delete request failed:", e?.response?.data || e?.message);
      pushToast(t("errors.action_failed", { defaultValue: "Action failed" }), "error");
    } finally {
      setBusyDel((b) => {
        const n = { ...b };
        delete n[id];
        return n;
      });
    }
  };

  // обработчики модалки
  const onConfirmYes = () => {
    const resolver = confirm.resolve;
    closeConfirm();
    // чуть позже, после анимации
    setTimeout(() => resolver?.(true), 0);
  };
  const onConfirmNo = () => {
    const resolver = confirm.resolve;
    closeConfirm();
    setTimeout(() => resolver?.(false), 0);
  };

  return (
    <div>
      {/* Заголовок + counters */}
      {showHeader && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-semibold">
              {t("provider.inbox.title", { defaultValue: "Incoming Requests" })}
            </h3>
            <span className="inline-flex items-center text-xs font-medium text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full">
              {stats.total}
            </span>
          </div>
          <button
            onClick={load}
            className="text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm"
            disabled={loading}
          >
            {t("common.refresh", { defaultValue: "Refresh" })}
          </button>
        </div>
      )}

      {/* мини-строка со счётчиками */}
      <div className="mb-3 text-sm text-gray-700">
        <span className="mr-4">
          {t("stats.requests_total", { defaultValue: "Всего" })}:{" "}
          <span className="font-medium">{stats.total}</span>
        </span>
        <span className="mr-4">
          {t("provider.inbox.new", { defaultValue: "Новые" })}:{" "}
          <span className="font-medium">{stats.new}</span>
        </span>
        <span>
          {t("provider.inbox.processed", { defaultValue: "Обработанные" })}:{" "}
          <span className="font-medium">{stats.processed}</span>
        </span>
      </div>

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
              {/* Верхняя строка: дата + статус */}
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-medium">{formatDate(r.created_at)}</span>
                <span>•</span>
                <StatusBadge status={r.status} />
              </div>

              {/* Заголовок услуги */}
              <div className="mt-2 text-base font-semibold">
                {r.service?.title || "—"}
              </div>

              {/* От кого */}
              <div className="mt-2 text-sm">
                <div className="text-gray-600">
                  {t("provider.inbox.from", { defaultValue: "From" })}:
                </div>
                <div className="font-medium">{r.client?.name || "—"}</div>

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

              {/* Комментарий */}
              {r.note && (
                <div className="mt-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    {t("comment", { defaultValue: "Comment" })}
                  </div>
                  <div className="mt-1 text-sm bg-gray-50 border border-gray-200 rounded px-3 py-2">
                    {r.note}
                  </div>
                </div>
              )}

              {/* Действия */}
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

      {/* модал подтверждения */}
      <ConfirmModal
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmText={t("ok", { defaultValue: "OK" })}
        cancelText={t("cancel", { defaultValue: "Отмена" })}
        onClose={onConfirmNo}
        onConfirm={onConfirmYes}
      />

      {/* тосты */}
      <ToastHost toasts={toasts} onDone={(id) => setToasts((arr) => arr.filter((x) => x.id !== id))} />
    </div>
  );
};

export default ProviderInboxList;
