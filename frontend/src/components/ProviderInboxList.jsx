//src/components/ProviderInboxList.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

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
  // убираем ведущий @ и возможные префиксы t.me
  s = s.replace(/^@/, "")
       .replace(/^https?:\/\/t\.me\//i, "")
       .replace(/^t\.me\//i, "");
  return `https://t.me/${s}`;
}


const ProviderInboxList = ({ showHeader = false }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState({}); // { [id]: true }
  const [busyDel, setBusyDel] = useState({}); // { [id]: true }

  const token = localStorage.getItem("token");
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const config = { headers: { Authorization: `Bearer ${token}` } };

  const load = async () => {
    try {
      setLoading(true);
      // авто-очистка можно попытаться, но логики не трогаем — так и оставим
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
      // ЛОГИКУ НЕ МЕНЯЕМ: тот же эндпоинт, что у тебя уже работает
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

  // ======= Шапка со счётчиками в «красивом» стиле =======
  const total = items.length;
  const newCnt = items.filter((x) => String(x.status) === "new" || !x.status).length;
  const processedCnt = items.filter((x) => String(x.status) === "processed").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-2xl font-semibold">
            {t("provider.inbox.title", { defaultValue: "Входящие заявки" })}
          </h3>
          <span className="ml-1 inline-flex items-center justify-center text-xs font-medium
                           min-w-[20px] h-[20px] px-1 rounded-full bg-gray-100 text-gray-700">
            {total}
          </span>
        </div>

        <button
          onClick={load}
          className="px-3 py-1 rounded-lg text-white bg-blue-500 hover:bg-blue-600 text-sm disabled:opacity-60"
          disabled={loading}
        >
          {t("common.refresh", { defaultValue: "Refresh" })}
        </button>
      </div>

      <div className="mb-3 text-sm text-gray-700 flex items-center gap-5">
        <div>
          <span className="text-gray-500">{t("provider.inbox.total", { defaultValue: "Всего" })}:</span>{" "}
          <span className="font-medium">{total}</span>
        </div>
        <div>
          <span className="text-gray-500">{t("provider.inbox.new", { defaultValue: "Новые" })}:</span>{" "}
          <span className="font-medium">{newCnt}</span>
        </div>
        <div>
          <span className="text-gray-500">
            {t("provider.inbox.processed", { defaultValue: "Обработанные" })}:
          </span>{" "}
          <span className="font-medium">{processedCnt}</span>
        </div>
      </div>

      {loading && (
        <div className="text-sm text-gray-500">
          {t("common.loading", { defaultValue: "Loading…" })}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-sm text-gray-500">
          {t("provider.inbox.empty", { defaultValue: "Нет заявок" })}
        </div>
      )}

      <div className="space-y-4">
        {items.map((r) => {
          const rawPhone = r?.client?.phone || null;
          const phoneHref = rawPhone ? `tel:${String(rawPhone).replace(/[^+\d]/g, "")}` : null;
          
          const rawTg = r?.client?.telegram || null;
          const tgHref = rawTg ? makeTgHref(rawTg) : null;
          const tgLabel = rawTg
            ? "@" + String(rawTg).trim()
                .replace(/^@/, "")
                .replace(/^https?:\/\/t\.me\//i, "")
                .replace(/^t\.me\//i, "")
            : null;

          return (
            <div key={r.id} className="border rounded-lg p-4 bg-white shadow-sm">
              {/* Верхняя строка: №, дата, статус */}
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                <span className="font-medium">#{r.id}</span>
                <span>•</span>
                <span>{formatDate(r.created_at)}</span>
                {r.status ? (
                  <StatusBadge status={r.status} />
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                    New
                  </span>
                )}
              </div>

              {/* Заголовок услуги */}
              <div className="mt-2">
                <div className="text-sm text-gray-600">{t("service", { defaultValue: "Service" })}:</div>
                <div className="text-lg font-semibold">{r.service?.title || "—"}</div>
              </div>

              {/* От кого */}
              
              <div className="mt-2 text-sm">
                <div className="text-gray-600">
                  {t("provider.inbox.from", { defaultValue: "От" })}:
              </div>
              <div className="font-medium flex items-center gap-2 min-w-0">
                                        {(() => {
                          const c = r?.client || {};
                          // если прислан provider_id — это профиль провайдера; иначе пробуем профиль клиента
                          const profileUrl = c.provider_id
                            ? `/profile/provider/${c.provider_id}`
                            : (c.id ? `/profile/client/${c.id}` : null);
                      
                          const typeLabel = {
                            client: t("labels.client",   { defaultValue: "Клиент" }),
                            agent:  t("labels.agent",    { defaultValue: "Турагент" }),
                            guide:  t("labels.guide",    { defaultValue: "Гид" }),
                            transport: t("labels.transport", { defaultValue: "Транспорт" }),
                            hotel:  t("labels.hotel",    { defaultValue: "Отель" }),
                          }[(c.type || "").toLowerCase()] || c.type;
                      
                          return (
                            <div className="font-medium flex items-center gap-2 min-w-0">
                              {profileUrl ? (
                                <Link
                                  to={profileUrl}
                                  className="underline hover:no-underline truncate block max-w-full"
                                  title={c.name || "—"}
                                >
                                  {c.name || "—"}
                                </Link>
                              ) : (
                                <span className="truncate" title={c.name || "—"}>
                                  {c.name || "—"}
                                </span>
                              )}
                      
                              {!!c.type && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 border border-orange-200 text-orange-700">
                                  {typeLabel}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-700">
                  {phoneHref ? (
                        <a href={phoneHref} className="underline hover:no-underline">
                          {rawPhone}
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    
                      {tgHref ? (
                        <a
                          href={tgHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:no-underline"
                          title="Telegram"
                        >
                          {tgLabel}
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                </div>
              </div>

              {/* Комментарий, если есть */}
              {!!r.note && (
                <div className="mt-3">
                  <div className="text-sm text-gray-600">
                    {t("comment", { defaultValue: "Комментарий" })}:
                  </div>
                  <div className="text-sm bg-gray-50 border rounded px-3 py-2">{r.note}</div>
                </div>
              )}

              {/* Кнопки действий */}
              <div className="mt-4 flex items-center gap-2">
                {!isProcessed && (
                  <button
                    onClick={() => handleMarkProcessed(r.id)}
                    disabled={!!busy[r.id]}
                    className={`px-3 py-1 rounded text-sm text-white ${
                      busy[r.id] ? "bg-green-300 cursor-wait" : "bg-green-600 hover:bg-green-700"
                    }`}
                  >
                    {t("provider.inbox.mark_processed", { defaultValue: "Обработано" })}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(r.id)}
                  disabled={!!busyDel[r.id]}
                  className={`px-3 py-1 rounded text-sm text-white ${
                    busyDel[r.id] ? "bg-red-300 cursor-wait" : "bg-red-600 hover:bg-red-700"
                  }`}
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
