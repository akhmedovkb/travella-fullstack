import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { toast } from "react-toastify";

/**
 * Список входящих запросов провайдера (read-only)
 * - Показывает: id, название услуги, статус, дату, комментарий клиента
 * - В правом верхнем углу — кнопка «Обновить»
 *
 * Props:
 *  - showHeader?: boolean (по умолчанию true)
 *  - compact?: boolean (чуть меньшие отступы карточек)
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
          {items.map((r) => (
            <div
              key={r.id}
              className={`rounded-2xl border shadow-sm ${
                compact ? "p-3" : "p-4"
              }`}
            >
              <div className="rounded-xl border bg-white/70 p-3">
                <div className="text-sm text-gray-800 flex flex-wrap gap-x-3 gap-y-1">
                  <span className="font-mono">#{r.id}</span>
                  <span>• service:</span>
                  <span className="font-medium">
                    {r.service?.title || "Service"}
                  </span>
                  <span>• requests.status:</span>
                  <span className="text-gray-700">{r.status || "new"}</span>
                  {r.created_at && (
                    <>
                      <span>•</span>
                      <span className="text-gray-500">
                        {formatDateTime(r.created_at)}
                      </span>
                    </>
                  )}
                </div>

                {r.note && (
                  <div className="mt-2 text-sm">
                    <span className="text-gray-500 mr-1">Комментарий:</span>
                    <span className="text-gray-800 break-words">{r.note}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
