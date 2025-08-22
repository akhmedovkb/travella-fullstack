// components/ProviderReviews.jsx
import React, { useEffect, useState } from "react";
import RatingStars from "./RatingStars";
import { getProviderReviews } from "../api/reviews";
import { useTranslation } from "react-i18next";

export default function ProviderReviews({ providerId, className = "", t }) {
  // если t не передали пропом — возьмём из i18n
  const { t: ti18n } = useTranslation();
  const T = t || ti18n;

  const [loading, setLoading] = useState(true);
  const [agg, setAgg] = useState({ avg: 0, count: 0 });
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!providerId) return;
    setLoading(true);
    getProviderReviews(providerId, { limit: 10, offset: 0 })
      .then((res) => {
        const avg = Number(res?.stats?.avg ?? res?.avg ?? 0);
        const count = Number(res?.stats?.count ?? res?.count ?? 0);
        setAgg({ avg, count });
        setItems(Array.isArray(res?.items) ? res.items : []);
      })
      .catch(() => {
        setAgg({ avg: 0, count: 0 });
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [providerId]);

  const roleLabel = (role) => T(`roles.${role}`, role);

  return (
    <div className={`bg-white rounded-xl border shadow p-4 md:p-6 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">{T("reviews.list", "Отзывы")}</div>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <RatingStars value={agg.avg} size={16} />
          <span className="font-medium">{(agg.avg || 0).toFixed(1)} / 5</span>
          <span className="opacity-70">· {agg.count} {T("reviews.count", "отзыв(ов)")}</span>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 mt-2">
          {T("common.loading", "Загрузка...")}
        </div>
      ) : !items.length ? (
        <div className="text-sm text-gray-500 mt-2">{T("reviews.empty", "Пока нет отзывов.")}</div>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((it) => (
            <li key={it.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <RatingStars value={it.rating || 0} size={16} />
                  {it.author?.name && (
                    <span className="text-sm text-gray-600">
                      {it.author.name} ({roleLabel(it.author.role)})
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(it.created_at || it.date || Date.now()).toLocaleString()}
                </div>
              </div>
              {it.text && <div className="mt-2 text-sm whitespace-pre-line">{it.text}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
