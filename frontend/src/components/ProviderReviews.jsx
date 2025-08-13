// components/ProviderReviews.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import RatingStars from "./RatingStars";

export default function ProviderReviews({ providerId, t }) {
  const [data, setData] = useState({ avg: 0, count: 0, items: [] });
  const API_BASE = import.meta.env.VITE_API_BASE_URL;

  useEffect(() => {
    if (!providerId) return;
    axios
      .get(`${API_BASE}/api/reviews/provider/${providerId}?limit=10`)
      .then((r) => setData(r.data || { avg: 0, count: 0, items: [] }))
      .catch(() => setData({ avg: 0, count: 0, items: [] }));
  }, [providerId]);

  return (
    <div className="mt-6 bg-white rounded-xl shadow-md border p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("reviews.title_provider")}</h3>
        <div className="flex items-center gap-2">
          <RatingStars value={data.avg} />
          <span className="text-sm text-gray-600">
            {data.avg?.toFixed(1)} · {data.count} {t("reviews.count")}
          </span>
        </div>
      </div>

      {data.items.length === 0 ? (
        <div className="text-sm text-gray-500 mt-2">{t("reviews.empty")}</div>
      ) : (
        <ul className="mt-4 space-y-3">
          {data.items.map((it) => (
            <li key={it.id} className="border rounded-lg p-3">
              <div className="flex items-center gap-2">
                <RatingStars value={it.rating} />
                <span className="text-xs text-gray-500">
                  {new Date(it.created_at).toLocaleDateString()}
                </span>
              </div>
              {it.text && <div className="mt-1 text-sm">{it.text}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
