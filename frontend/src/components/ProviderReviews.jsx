import React, { useEffect, useMemo, useState } from "react";
import { MessageSquareText, Star } from "lucide-react";
import RatingStars from "./RatingStars";
import { getProviderReviews } from "../api/reviews";
import { useTranslation } from "react-i18next";

function initials(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export default function ProviderReviews({ providerId, className = "", t }) {
  const { t: ti18n, i18n } = useTranslation();
  const T = t || ti18n;
  const [loading, setLoading] = useState(true);
  const [agg, setAgg] = useState({ avg: 0, count: 0 });
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!providerId) return;
    setLoading(true);
    getProviderReviews(providerId, { limit: 10, offset: 0 })
      .then((res) => {
        setAgg({
          avg: Number(res?.stats?.avg ?? res?.avg ?? 0),
          count: Number(res?.stats?.count ?? res?.count ?? 0),
        });
        setItems(Array.isArray(res?.items) ? res.items : []);
      })
      .catch(() => {
        setAgg({ avg: 0, count: 0 });
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [providerId]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language || "ru", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    [i18n.language]
  );

  const roleLabel = (role) => T(`roles.${role}`, role);
  const reviewCount = T("reviews.count", { count: agg.count, defaultValue: `${agg.count} отзывов` });

  return (
    <section className={`min-w-0 ${className}`} aria-labelledby="provider-reviews-title">
      <div className="grid gap-5 border-b border-slate-200 pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600 ring-1 ring-orange-100">
            <MessageSquareText aria-hidden="true" className="h-5 w-5" />
          </div>
          <h2 id="provider-reviews-title" className="text-xl font-black text-slate-950">
            {T("reviews.title_provider", "Отзывы клиентов")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm font-medium text-slate-500">
            {T("reviews.provider_subtitle", "Мнения клиентов о работе поставщика.")}
          </p>
        </div>

        <div className="flex items-center gap-4 rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
          <div className="text-3xl font-black tabular-nums text-slate-950">{agg.avg.toFixed(1)}</div>
          <div>
            <RatingStars value={agg.avg} size={18} />
            <div className="mt-1 text-xs font-semibold text-slate-500">{reviewCount}</div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 py-5" aria-label={T("common.loading", "Загрузка...")}>
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : !items.length ? (
        <div className="flex min-h-56 flex-col items-center justify-center px-4 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Star aria-hidden="true" className="h-5 w-5" />
          </div>
          <h3 className="mt-4 font-black text-slate-900">{T("reviews.empty", "Пока нет отзывов.")}</h3>
          <p className="mt-1 max-w-md text-sm font-medium text-slate-500">
            {T("reviews.empty_hint", "Отзывы появятся здесь после того, как клиенты поделятся впечатлениями.")}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200" aria-label={T("reviews.list", "Отзывы")}>
          {items.map((item) => {
            const authorName = item.author?.name || T("reviews.anonymous", "Клиент Travella");
            const createdAt = item.created_at || item.date;
            return (
              <li key={item.id} className="grid gap-3 py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
                {item.author?.avatar_url ? (
                  <img src={item.author.avatar_url} alt="" className="h-11 w-11 rounded-full border border-slate-200 object-cover" />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-950 text-sm font-black text-white">
                    {initials(authorName)}
                  </div>
                )}

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-black text-slate-950">{authorName}</span>
                    {item.author?.role ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                        {roleLabel(item.author.role)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5"><RatingStars value={item.rating || 0} size={16} /></div>
                  {item.text ? (
                    <p className="mt-3 whitespace-pre-line text-sm font-medium leading-6 text-slate-700">{item.text}</p>
                  ) : null}
                </div>

                {createdAt ? (
                  <time dateTime={new Date(createdAt).toISOString()} className="text-xs font-semibold text-slate-400 sm:pt-1">
                    {dateFormatter.format(new Date(createdAt))}
                  </time>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
