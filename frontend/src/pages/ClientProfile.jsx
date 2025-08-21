import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";
import { getClientReviews } from "../api/reviews";
import ReviewForm from "../components/ReviewForm";
import RatingStars from "../components/RatingStars";
import { tError } from "../shared/toast";

function getRole() {
  const hasClient = !!localStorage.getItem("clientToken");
  const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
  return hasClient ? "client" : (hasProvider ? "provider" : null);
}

export default function ClientProfile() {
  const { t } = useTranslation();
  const { id } = useParams();      // client id из маршрута
  const [sp] = useSearchParams();
  const serviceId = sp.get("service_id") ? Number(sp.get("service_id")) : undefined;
  const requestId = sp.get("request_id") || undefined;

  const [role] = useState(getRole());
  const canReview = role === "provider";   // отзыв клиенту могут оставлять провайдеры

  const [client, setClient] = useState(null);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const load = async (p = 1) => {
    setLoading(true);
    try {
      // профиль клиента
      let profile = null;
      const endpoints = [
        `/api/clients/${id}`,
        `/api/client/${id}`,
        `/api/users/${id}`,
      ];
      for (const url of endpoints) {
        try {
          const res = await apiGet(url);
          const obj = (res && (res.data || res.item || res.client || res.user || res.profile)) || res;
          if (obj && (obj.id || obj.name || obj.title)) { profile = obj; break; }
        } catch {}
      }
      setClient(profile);

      const off = (p - 1) * pageSize;
      const data = await getClientReviews(id, { limit: pageSize, offset: off });
      setAvg(Number(data?.avg || 0));
      setCount(Number(data?.count || 0));
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setItems([]);
      tError(t("reviews.load_error") || "Не удалось загрузить отзывы");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(page); /* eslint-disable-next-line */ }, [page, id]);

  const pages = useMemo(() => Math.max(1, Math.ceil(count / pageSize)), [count]);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      <div className="bg-white rounded-xl border shadow p-5 mb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-semibold">
              {client?.name || client?.title || t("client.profile") || "Профиль клиента"}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <RatingStars value={avg} />
              <span className="text-sm text-gray-600">
                {avg.toFixed(1)} / 5 • {count} {t("reviews.count") || "отзыв(ов)"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {canReview && (
        <div className="mb-5">
          <ReviewForm
            targetType="client"
            targetId={Number(id)}
            targetName={client?.name || client?.title}
            serviceId={serviceId}
            requestId={requestId}
            onCreated={() => load(1)}
          />
        </div>
      )}

      <div className="bg-white rounded-xl border shadow p-5">
        <div className="text-lg font-semibold mb-3">{t("reviews.list") || "Отзывы"}</div>

        {loading && <div className="text-gray-500">{t("common.loading") || "Загрузка…"}.</div>}

        {!loading && !items.length && (
          <div className="text-gray-500">{t("reviews.empty") || "Пока нет отзывов"}</div>
        )}

        {!loading && !!items.length && (
          <div className="space-y-4">
            {items.map((r) => (
              <div key={r.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{r.author?.name || "—"}</div>
                  <div><RatingStars value={r.rating} /></div>
                </div>
                {r.text && <div className="mt-2 text-sm">{r.text}</div>}
                <div className="mt-1 text-xs text-gray-500">
                  {new Date(r.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}

        {pages > 1 && (
          <div className="mt-4 flex justify-center gap-2">
            <button
              className="px-3 py-1.5 rounded border disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              {t("common.prev") || "Назад"}
            </button>
            <div className="px-3 py-1.5">{page} / {pages}</div>
            <button
              className="px-3 py-1.5 rounded border disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
            >
              {t("common.next") || "Вперёд"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
