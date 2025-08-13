import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";

/**
 * Read-only список входящих запросов провайдера.
 * НИЧЕГО не отправляет и не рендерит "оффер".
 *
 * Props:
 *  - showHeader?: boolean  — показать заголовок секции (по умолч. true)
 *  - compact?: boolean     — более компактные карточки (для Dashboard)
 */
export default function ProviderInboxList({ showHeader = true, compact = false }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      // старый Dashboard ждёт массив с /provider;
      // новые страницы — объект { items } с /provider/inbox
      let res = await apiGet("/api/requests/provider");
      let list = Array.isArray(res) ? res : (Array.isArray(res?.items) ? res.items : []);

      if (!list.length) {
        const fallback = await apiGet("/api/requests/provider/inbox");
        list = Array.isArray(fallback?.items) ? fallback.items : [];
      }

      setItems(list);
    } catch {
      setErr(t("errors.data_load") || "Ошибка загрузки входящих");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  return (
    <div className="bg-white rounded-xl border shadow p-4">
      {showHeader && (
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">
            {t("requests.inbox") || "Входящие запросы"}
          </div>
          <button onClick={load} className="text-orange-600 hover:underline">
            {t("common.refresh") || "Обновить"}
          </button>
        </div>
      )}

      {loading && <div className="text-gray-500">{t("common.loading") || "Загрузка…"}</div>}
      {err && <div className="text-red-600">{err}</div>}

      {!loading && !err && (!items || items.length === 0) && (
        <div className="text-gray-500">{t("requests.empty") || "Запросов нет."}</div>
      )}

      <div className="space-y-3">
        {items.map((r) => (
          <div
            key={r.id}
            className={`rounded-xl border p-3 ${compact ? "" : "md:p-4"}`}
          >
            <div className="flex flex-wrap items-center gap-x-3 text-sm text-gray-500">
              <span className="font-mono text-gray-700">#{r.id}</span>
              <span>• service:</span>
              <span className="font-medium text-gray-800">{r.service?.title || "—"}</span>
              <span>• {t("requests.status") || "статус"}:</span>
              <span className="font-medium">{r.status || "new"}</span>
              <span>• {new Date(r.created_at).toLocaleString()}</span>
            </div>

            {r.note && (
              <div className="mt-2 text-sm">
                <span className="text-gray-500">{t("common.comment") || "Заметка"}: </span>
                <span className="font-medium">{r.note}</span>
              </div>
            )}

            {r.client && (
              <div className="mt-1 text-sm text-gray-600">
                <span>{t("client.header.cabinet") || "Клиент"}: </span>
                <span className="font-medium">{r.client.name || "—"}</span>
                {r.client.phone && (
                  <>
                    {" · "}
                    <a className="underline" href={`tel:${r.client.phone}`}>{r.client.phone}</a>
                  </>
                )}
                {r.client.telegram && (
                  <>
                    {" · "}
                    <a
                      className="underline"
                      target="_blank"
                      rel="noopener noreferrer"
                      href={
                        r.client.telegram.startsWith("@")
                          ? `https://t.me/${r.client.telegram.slice(1)}`
                          : /^https?:\/\//i.test(r.client.telegram)
                          ? r.client.telegram
                          : `https://t.me/${r.client.telegram}`
                      }
                    >
                      {r.client.telegram.startsWith("@")
                        ? r.client.telegram
                        : `@${String(r.client.telegram).replace(/^https?:\/\/t\.me\//i, "")}`}
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
