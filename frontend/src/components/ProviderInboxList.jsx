import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";

/**
 * Список входящих запросов провайдера (read-only)
 * Показывает: услуга, от кого, комментарий, дата.
 *
 * Props:
 *  - showHeader?: boolean (заголовок и кнопка "Обновить"), по умолчанию true
 *  - compact?: boolean (уменьшенные отступы), по умолчанию false
 */
export default function ProviderInboxList({ showHeader = true, compact = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const token = useMemo(() => localStorage.getItem("token"), []);
  const config = useMemo(
    () => ({ headers: { Authorization: `Bearer ${token}` } }),
    [token]
  );

  const load = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/api/requests/provider`, config);
      const data = Array.isArray(res.data) ? res.data : (res.data?.items || []);
      setItems(data);
    } catch (e) {
      console.error("Ошибка загрузки входящих", e);
      toast.error(e?.response?.data?.message || "Ошибка загрузки входящих");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const formatDateTime = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div>
      {showHeader && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xl font-semibold">Входящие запросы</h3>
          <button
            onClick={load}
            disabled={loading}
            className="text-sm text-orange-600 underline disabled:opacity-60"
            title="Перезагрузить список"
          >
            {loading ? "Загрузка..." : "Обновить"}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-sm text-gray-500">Запросов нет.</div>
      ) : (
        <div className="space-y-3">
          {items.map((r) => {
            const svcTitle = r?.service?.title || "Service";
            const cli = r?.client;
            const cliName = cli?.name || "Клиент";
            const cliPhone = cli?.phone;
            const cliTg = cli?.telegram;

            return (
              <div
                key={r.id}
                className={`rounded-2xl border shadow-sm bg-white ${compact ? "p-3" : "p-4"}`}
              >
                {/* первая строка: id + дата + статус */}
                <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1 mb-2">
                  <span className="font-mono text-gray-700">#{r.id}</span>
                  {r.status && (
                    <>
                      <span>• статус:</span>
                      <span className="text-gray-700">{r.status}</span>
                    </>
                  )}
                  {r.created_at && (
                    <>
                      <span>•</span>
                      <span>{formatDateTime(r.created_at)}</span>
                    </>
                  )}
                </div>

                {/* услуга */}
                <div className="text-sm">
                  <span className="text-gray-500">Услуга:</span>{" "}
                  <span className="font-medium text-gray-900">{svcTitle}</span>
                </div>

                {/* от кого */}
                <div className="text-sm mt-1">
                  <span className="text-gray-500">От кого:</span>{" "}
                  <span className="text-gray-900">{cliName}</span>
                  {(cliPhone || cliTg) && (
                    <span className="text-gray-500">
                      {" "}
                      •{" "}
                      {cliPhone && (
                        <>
                          <a
                            className="text-blue-600 hover:underline"
                            href={`tel:${cliPhone}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {cliPhone}
                          </a>
                          {cliTg && <span> • </span>}
                        </>
                      )}
                      {cliTg && (
                        <a
                          className="text-blue-600 hover:underline"
                          href={
                            cliTg.startsWith("@")
                              ? `https://t.me/${cliTg.replace("@", "")}`
                              : cliTg.startsWith("http")
                              ? cliTg
                              : `https://t.me/${cliTg}`
                          }
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {cliTg}
                        </a>
                      )}
                    </span>
                  )}
                </div>

                {/* комментарий */}
                {r.note && (
                  <div className="mt-2 text-sm">
                    <span className="text-gray-500 mr-1">Комментарий:</span>
                    <span className="text-gray-900 break-words">{r.note}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
