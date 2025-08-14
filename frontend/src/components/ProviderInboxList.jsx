// frontend/src/pages/ProviderInboxList.jsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiPut, apiDelete } from "../api";

export default function ProviderInboxList() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ total: 0, new: 0, processed: 0 });
  const [loading, setLoading] = useState(false);

  async function fetchData() {
    setLoading(true);
    try {
      // Сначала ручной триггер авто-очистки
      await apiPost("/api/requests/cleanup-expired", {});
      // Затем получаем список и статистику
      const [listRes, statsRes] = await Promise.all([
        apiGet("/api/requests/provider"),
        apiGet("/api/requests/provider/stats"),
      ]);
      setItems(listRes.items || []);
      setStats(statsRes || { total: 0, new: 0, processed: 0 });
    } catch (err) {
      console.error("fetchData error", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function handleMarkProcessed(id) {
    try {
      await apiPut(`/api/requests/${id}/status`, { status: "processed" });
      fetchData();
    } catch (err) {
      console.error("mark processed error", err);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm(t("provider.inbox.confirm_delete") || "Удалить заявку?")) return;
    try {
      await apiDelete(`/api/requests/${id}`);
      fetchData();
    } catch (err) {
      console.error("delete request error", err);
    }
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">
          {t("provider.inbox.title") || "Входящие заявки"}
        </h2>
        <button
          onClick={fetchData}
          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          {t("refresh") || "Обновить"}
        </button>
      </div>

      <div className="mb-4 flex gap-4 text-sm">
        <span>{t("provider.inbox.total") || "Всего"}: {stats.total}</span>
        <span>{t("provider.inbox.new") || "Новые"}: {stats.new}</span>
        <span>{t("provider.inbox.processed") || "Обработанные"}: {stats.processed}</span>
      </div>

      {loading ? (
        <div>{t("loading") || "Загрузка..."}</div>
      ) : items.length === 0 ? (
        <div>{t("provider.inbox.empty") || "Нет заявок"}</div>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id} className="border p-3 rounded shadow-sm bg-white">
              <div className="font-medium">{r.service?.title}</div>
              <div className="text-sm text-gray-600">
                {t("provider.inbox.from") || "От"}: {r.client?.name || "—"}
                {r.client?.phone && `, ${r.client.phone}`}
              </div>
              <div className="text-xs text-gray-500">
                {new Date(r.created_at).toLocaleString()}
              </div>
              <div className="mt-2 flex gap-2">
                {r.status === "new" && (
                  <button
                    onClick={() => handleMarkProcessed(r.id)}
                    className="px-2 py-1 bg-green-500 text-white text-xs rounded"
                  >
                    {t("provider.inbox.mark_processed") || "Обработано"}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(r.id)}
                  className="px-2 py-1 bg-red-500 text-white text-xs rounded"
                >
                  {t("delete") || "Удалить"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
