import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";

// нормализуем Telegram: "@name", "t.me/name", "https://t.me/name" → "name"
function normalizeTg(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const m = s.match(/(?:https?:\/\/)?t(?:elegram)?\.me\/([A-Za-z0-9_]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@+/, "");
  return s || null;
}

export default function ProviderOutboxList({ showHeader = false }) {
  const { t } = useTranslation();
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const res = await apiGet("/api/requests/provider/outgoing");
        if (mounted) setItems(Array.isArray(res?.items) ? res.items : []);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (loading) return <div className="text-gray-500">{t("common.loading", { defaultValue: "Загрузка..." })}</div>;
  if (!items?.length) return <div className="text-gray-500">{t("empty.no_requests", { defaultValue: "Пока нет заявок." })}</div>;

  return (
    <div>
      {showHeader && (
        <div className="text-lg font-semibold mb-3">{t("provider.outgoing", { defaultValue: "Исходящие заявки" })}</div>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((r) => {
          const title = r?.service?.title || t("common.request", { defaultValue: "Запрос" });
          const when  = r?.created_at ? new Date(r.created_at).toLocaleString() : "";
          const prov  = r?.provider || {};
          const tg    = normalizeTg(prov.telegram);
          return (
            <div key={r.id} className="bg-white border rounded-xl p-4 overflow-hidden">
              <div className="font-semibold leading-tight break-words line-clamp-2">{title}</div>

              <div className="mt-2 text-sm text-gray-700 min-w-0">
                <div className="flex items-center gap-2">
                  {/* провайдер-владелец услуги (получатель) */}
                  {prov.id ? (
                    <Link to={`/profile/provider/${prov.id}`} className="underline hover:no-underline truncate block max-w-full">
                      {prov.name || "—"}
                    </Link>
                  ) : (
                    <span className="truncate block max-w-full">{prov.name || "—"}</span>
                  )}
                  {prov.type && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
                      {{
                        agent: "Турагент",
                        guide: "Гид",
                        transport: "Транспорт",
                        hotel: "Отель",
                      }[String(prov.type).toLowerCase()] || "Провайдер"}
                    </span>
                  )}
                </div>

                <div className="flex gap-4 mt-1">
                  {prov.phone && (
                    <a className="hover:underline break-all" href={`tel:${String(prov.phone).replace(/[^+\d]/g, "")}`}>
                      {prov.phone}
                    </a>
                  )}
                  {tg && (
                    <a className="hover:underline break-all" href={`https://t.me/${tg}`} target="_blank" rel="noreferrer">
                      @{tg}
                    </a>
                  )}
                </div>
              </div>

              <div className="text-sm text-gray-500 mt-2">
                {t("common.status", { defaultValue: "Статус" })}: {r?.status || "new"}
              </div>
              {when && (
                <div className="text-xs text-gray-400 mt-1">
                  {t("common.created", { defaultValue: "Создан" })}: {when}
                </div>
              )}
              {r?.note && (
                <div className="text-sm text-gray-600 mt-2 whitespace-pre-wrap break-words">
                  {t("common.comment", { defaultValue: "Комментарий" })}: {r.note}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
