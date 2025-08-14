// frontend/src/pages/Dashboard.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, apiDelete } from "../api";

/* ============ tiny utils ============ */
const firstNonEmpty = (...args) => {
  for (const v of args) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
};
const normalizeList = (res) => {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data)) return res.data;
  return [];
};
const formatDateTime = (iso) => {
  try {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  } catch {
    return String(iso);
  }
};

/* ============ client profile fetch (cache + fallbacks) ============ */
const clientCache = new Map();
/** Возвращает { id, name, ... } или null */
async function fetchClientProfile(clientId) {
  if (!clientId) return null;
  if (clientCache.has(clientId)) return clientCache.get(clientId);

  const endpoints = [
    `/api/clients/${clientId}`,
    `/api/client/${clientId}`,
    `/api/users/${clientId}`,
    `/api/user/${clientId}`,
    `/api/customers/${clientId}`,
    `/api/customer/${clientId}`,
  ];

  let profile = null;
  for (const url of endpoints) {
    try {
      const res = await apiGet(url);
      // попытки извлечь сущность из разных форматов ответа
      const obj =
        (res &&
          (res.data ||
            res.item ||
            res.profile ||
            res.client ||
            res.user ||
            res.customer)) ||
        res;
      if (obj && (obj.id || obj.name || obj.title || obj.display_name)) {
        profile = obj;
        break;
      }
    } catch {
      /* noop — идём к следующему эндпоинту */
    }
  }
  clientCache.set(clientId, profile || null);
  return profile;
}

/* ============ main ============ */
export default function Dashboard() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [inbox, setInbox] = useState([]);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  // мапа clientId -> {name, ...} для уже подгруженных профилей
  const [clients, setClients] = useState({});

  // ---- загрузка входящих с запасными маршрутами
  const loadInbox = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    const endpoints = [
      "/api/requests/provider/inbox",
      "/api/requests/inbox?scope=provider",
      "/api/requests/provider", // некоторые бэки так называют
      "/api/requests?inbox=1&role=provider",
    ];

    let list = [];
    for (const url of endpoints) {
      try {
        const res = await apiGet(url);
        list = normalizeList(res);
        if (list.length) break;
      } catch {
        /* try next */
      }
    }

    setInbox(Array.isArray(list) ? list : []);
    setLoading(false);
  };

  // ---- мягкая очистка просроченных заявок (не критично, просто best-effort)
  const cleanupExpired = async () => {
    const urls = [
      "/api/requests/provider/cleanup-expired",
      "/api/requests/cleanup-expired?scope=provider",
      "/api/requests/provider/cleanup",
      "/api/requests/cleanup?role=provider",
    ];
    for (const url of urls) {
      try {
        const res = await apiPost(url, {});
        if (res) break;
      } catch {
        /* ignore */
      }
    }
  };

  useEffect(() => {
    (async () => {
      await cleanupExpired(); // не блокируем UI — но тут оно и так быстро
      await loadInbox();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- подгрузить имена клиентов, если их нет в самом запросе
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const promises = [];
      const nextMap = {};

      for (const r of inbox) {
        // 1) инлайновые объекты, если вдруг сервер их прислал
        const inlineClient =
          r?.client || r?.customer || r?.buyer || r?.author || r?.user || null;

        const clientId = firstNonEmpty(
          r?.client_id,
          r?.clientId,
          r?.customer_id,
          r?.buyer_id,
          r?.user_id,
          inlineClient?.id,
          inlineClient?._id
        );

        const clientNameInline = firstNonEmpty(
          r?.client_name,
          r?.customer_name,
          r?.buyer_name,
          r?.user_name,
          inlineClient?.name,
          inlineClient?.title,
          inlineClient?.display_name
        );

        if (!clientId || clientNameInline) {
          if (clientId && clientNameInline) {
            nextMap[clientId] = { id: clientId, name: clientNameInline };
          }
          continue;
        }

        if (!clientCache.has(clientId)) {
          promises.push(
            fetchClientProfile(clientId).then((p) => {
              if (p && !cancelled) {
                nextMap[clientId] = {
                  id: p.id ?? clientId,
                  name:
                    p.name || p.title || p.display_name || p.company_name || "",
                };
              }
            })
          );
        } else {
          const p = clientCache.get(clientId);
          if (p) {
            nextMap[clientId] = {
              id: p.id ?? clientId,
              name:
                p.name || p.title || p.display_name || p.company_name || "",
            };
          }
        }
      }

      if (promises.length) {
        try {
          await Promise.allSettled(promises);
        } catch {
          /* ignore */
        }
      }
      if (!cancelled && Object.keys(nextMap).length) {
        setClients((prev) => ({ ...prev, ...nextMap }));
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [inbox]);

  const refresh = async () => {
    await loadInbox();
  };

  const deriveServiceTitle = (r) =>
    firstNonEmpty(
      r?.service?.title,
      r?.service?.name,
      r?.service_title,
      r?.title,
      r?.name
    ) || t("common.request", { defaultValue: "Запрос" });

  const deriveClientName = (r) => {
    const inlineClient =
      r?.client || r?.customer || r?.buyer || r?.author || r?.user || null;

    const clientNameInline = firstNonEmpty(
      r?.client_name,
      r?.customer_name,
      r?.buyer_name,
      r?.user_name,
      inlineClient?.name,
      inlineClient?.title,
      inlineClient?.display_name
    );
    if (clientNameInline) return clientNameInline;

    const clientId = firstNonEmpty(
      r?.client_id,
      r?.clientId,
      r?.customer_id,
      r?.buyer_id,
      r?.user_id,
      inlineClient?.id,
      inlineClient?._id
    );
    if (!clientId) return null;

    const cached = clients[clientId];
    return cached?.name || null;
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl md:text-2xl font-semibold">
          {t("dashboard.incoming", { defaultValue: "Входящие запросы" })}
        </h1>
        <div className="ml-auto">
          <button
            onClick={refresh}
            className="text-orange-600 hover:underline text-sm"
          >
            {t("dashboard.refresh", { defaultValue: "Обновить" })}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4 md:p-5 border">
        {loading && (
          <div className="text-gray-500">
            {t("common.loading", { defaultValue: "Загрузка..." })}
          </div>
        )}
        {!loading && error && (
          <div className="text-red-600">{String(error)}</div>
        )}
        {!loading && !error && inbox.length === 0 && (
          <div className="text-gray-500">
            {t("dashboard.empty", { defaultValue: "Пока нет входящих." })}
          </div>
        )}

        {!loading && !error && inbox.length > 0 && (
          <div className="space-y-3">
            {inbox.map((r) => {
              const serviceTitle = deriveServiceTitle(r);
              const clientName = deriveClientName(r);
              const created = formatDateTime(r?.created_at || r?.createdAt);
              const status = r?.status || "new";
              const note = r?.note || r?.comment || r?.message || "";

              return (
                <div
                  key={r.id}
                  className="bg-white border rounded-xl p-4 hover:shadow-sm transition-shadow"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <div className="font-mono text-gray-600">#{r.id}</div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
                      {status}
                    </span>
                    {created && (
                      <>
                        <span className="text-gray-300">•</span>
                        <div className="text-gray-500">{created}</div>
                      </>
                    )}
                  </div>

                  <div className="mt-2">
                    <div className="text-sm text-gray-600">
                      {t("dashboard.service", { defaultValue: "Услуга" })}:
                    </div>
                    <div className="font-medium">{serviceTitle}</div>
                  </div>

                  <div className="mt-1">
                    <div className="text-sm text-gray-600">
                      {t("dashboard.from", { defaultValue: "От кого" })}:
                    </div>
                    <div className="font-medium">{clientName || "—"}</div>
                  </div>

                  {note && (
                    <div className="mt-3">
                      <div className="text-sm text-gray-600">
                        {t("common.comment", { defaultValue: "Комментарий" })}:
                      </div>
                      <div className="mt-1 text-[13px] leading-relaxed bg-gray-50 border rounded-lg px-3 py-2">
                        {note}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {message && (
        <div className="mt-4 text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm">
          {message}
        </div>
      )}
    </div>
  );
}
