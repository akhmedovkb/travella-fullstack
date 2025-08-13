// frontend/src/pages/ProviderRequests.jsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";

export default function ProviderRequests() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiGet("/api/requests/provider/inbox");
        if (!alive) return;
        setItems(Array.isArray(res?.items) ? res.items : []);
      } catch (e) {
        if (!alive) return;
        setErr(t("errors.data_load") || "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [t]);

  if (loading) return <div className="p-4 text-gray-500">{t("common.loading") || "Loading…"}</div>;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6">
      <div className="bg-white rounded-xl border shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-lg font-semibold">
            {t("requests.inbox") || "Incoming requests"}
          </div>
        </div>

        {err && <div className="text-red-600 mb-3">{err}</div>}

        {!err && (!items || items.length === 0) && (
          <div className="text-gray-500">{t("requests.empty") || "No requests yet."}</div>
        )}

        {items && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500">
                <tr>
                  <th className="py-2 pr-4">{t("requests.created_at") || "Created"}</th>
                  <th className="py-2 pr-4">{t("requests.service") || "Service"}</th>
                  <th className="py-2 pr-4">{t("requests.client") || "Client"}</th>
                  <th className="py-2 pr-4">{t("common.comment") || "Comment"}</th>
                  <th className="py-2">{t("requests.status") || "Status"}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="py-2 pr-4">{r.service?.title || "—"}</td>
                    <td className="py-2 pr-4">
                      {r.client?.name || "—"}
                      {r.client?.phone && (
                        <>
                          {" · "}
                          <a className="underline" href={`tel:${r.client.phone}`}>{r.client.phone}</a>
                        </>
                      )}
                      {r.client?.telegram && (
                        <>
                          {" · "}
                          <a
                            className="underline"
                            href={
                              r.client.telegram.startsWith("@")
                                ? `https://t.me/${r.client.telegram.slice(1)}`
                                : /^https?:\/\//i.test(r.client.telegram)
                                ? r.client.telegram
                                : `https://t.me/${r.client.telegram}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {r.client.telegram.startsWith("@") ? r.client.telegram : `@${r.client.telegram.replace(/^https?:\/\/t\.me\//i,"")}`}
                          </a>
                        </>
                      )}
                    </td>
                    <td className="py-2 pr-4 max-w-[360px]">
                      <span className="line-clamp-2 block" title={r.note || ""}>
                        {r.note || "—"}
                      </span>
                    </td>
                    <td className="py-2">{r.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
