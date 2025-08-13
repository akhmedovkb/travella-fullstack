// components/ServiceReviewsBadge.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import RatingStars from "./RatingStars";

export default function ServiceReviewsBadge({ serviceId, t }) {
  const [data, setData] = useState({ avg: 0, count: 0, items: [] });
  const API_BASE = import.meta.env.VITE_API_BASE_URL;

  useEffect(() => {
    if (!serviceId) return;
    axios
      .get(`${API_BASE}/api/reviews/service/${serviceId}?limit=3`)
      .then((r) => setData(r.data || { avg: 0, count: 0, items: [] }))
      .catch(() => setData({ avg: 0, count: 0, items: [] }));
  }, [serviceId]);

  return (
    <div className="relative group inline-flex items-center gap-1">
      <RatingStars value={data.avg} size={14} />
      <span className="text-xs text-gray-600">({data.count})</span>

      {/* Hover tooltip */}
      <div className="pointer-events-none absolute z-50 hidden group-hover:block top-[120%] right-0 w-72 p-3 rounded-xl shadow-xl border bg-white">
        <div className="flex items-center justify-between mb-2">
          <div className="font-medium">{t("reviews.title_service")}</div>
          <div className="flex items-center gap-1">
            <RatingStars value={data.avg} size={14} />
            <span className="text-xs text-gray-600">
              {data.avg?.toFixed(1)} · {data.count}
            </span>
          </div>
        </div>
        {data.items.length === 0 ? (
          <div className="text-xs text-gray-500">{t("reviews.empty")}</div>
        ) : (
          <ul className="space-y-2">
            {data.items.map((it) => (
              <li key={it.id} className="text-xs">
                <div className="flex items-center gap-1">
                  <RatingStars value={it.rating} size={12} />
                  <span className="text-[10px] text-gray-400">
                    {new Date(it.created_at).toLocaleDateString()}
                  </span>
                </div>
                {it.text && <div className="mt-0.5 line-clamp-2">{it.text}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
