// frontend/src/pages/ProviderProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";
import RatingStars from "../components/RatingStars";
import ReviewForm from "../components/ReviewForm";
import { getProviderReviews, addProviderReview } from "../api/reviews";
import { tInfo } from "../shared/toast";

/* ---- helpers ---- */
const first = (...vals) => {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim?.() !== "") return v;
  }
  return null;
};
const maybeParse = (x) => {
  if (!x) return null;
  if (typeof x === "object") return x;
  if (typeof x === "string") {
    try { return JSON.parse(x); } catch { return null; }
  }
  return null;
};
const firstImageFrom = (val) => {
  if (!val) return null;
  if (typeof val === "string") {
    let s = val.trim();
    if (!s) return null;
    if (/^data:image\//i.test(s)) {
      s = s.replace(/\s+/g, "");
      if (/;base64(?!,)/i.test(s)) s = s.replace(/;base64/i, ";base64,");
      return s;
    }
    if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, "").length > 100) {
      return `data:image/jpeg;base64,${s.replace(/\s+/g, "")}`;
    }
    if (/^(https?:|blob:|file:|\/)/i.test(s)) return s;
    return `${window.location.origin}/${s.replace(/^\.?\//, "")}`;
  }
  if (Array.isArray(val)) {
    for (const v of val) { const r = firstImageFrom(v); if (r) return r; }
    return null;
  }
  if (typeof val === "object") {
    return firstImageFrom(val.url ?? val.src ?? val.href ?? val.link ?? val.path ?? val.data ?? val.base64);
  }
  return null;
};

// множественные эндпоинты (как в карточке)
async function fetchProviderProfile(providerId) {
  const endpoints = [
    `/api/providers/${providerId}`,
    `/api/provider/${providerId}`,
    `/api/companies/${providerId}`,
    `/api/company/${providerId}`,
    `/api/agencies/${providerId}`,
    `/api/agency/${providerId}`,
    `/api/users/${providerId}`,
    `/api/user/${providerId}`,
  ];
  for (const url of endpoints) {
    try {
      const res = await apiGet(url);
      const obj = (res && (res.data || res.item || res.profile || res.provider || res.company)) || res;
      if (obj && (obj.id || obj.name || obj.title)) return obj;
    } catch {}
  }
  return null;
}

export default function ProviderProfile() {
  const { id } = useParams();
  const providerId = Number(id);
  const { t } = useTranslation();

  const [prov, setProv] = useState(null);
  const [loading, setLoading] = useState(true);

  const [reviewsAgg, setReviewsAgg] = useState({ count: 0, avg: 0 });
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const p = await fetchProviderProfile(providerId);
        if (alive) setProv(p || null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [providerId]);

  const reloadReviews = async () => {
    const data = await getProviderReviews(providerId, { limit: 20, offset: 0 });
    const stats = data?.stats || { count: Number(data?.count) || 0, avg: Number(data?.avg) || 0 };
    setReviewsAgg({ count: Number(stats.count) || 0, avg: Number(stats.avg) || 0 });
    setReviews(Array.isArray(data?.items) ? data.items : []);
  };

  useEffect(() => { reloadReviews(); }, [providerId]);

  const details = useMemo(() => {
    const d = maybeParse(prov?.details) || prov?.details || {};
    const contacts = prov?.contacts || {};
    const socials = prov?.socials || {};
    const name = first(prov?.display_name, prov?.name, prov?.title, prov?.brand, prov?.company_name);

    return {
      name,
      type: first(prov?.type, d?.type),
      region: first(prov?.region, d?.region, prov?.location, d?.location, d?.country),
      address: first(prov?.address, d?.address),
      phone: first(prov?.phone, contacts?.phone, d?.phone, prov?.whatsapp),
      telegram: first(prov?.telegram, contacts?.telegram, socials?.telegram, prov?.social, d?.telegram),
      logo: firstImageFrom(first(prov?.photo, prov?.logo, d?.logo, prov?.image)),
    };
  }, [prov]);

  // Разрешаем оставлять отзыв клиенту ИЛИ провайдеру
  const canReview = !!(localStorage.getItem("clientToken") || localStorage.getItem("token") || localStorage.getItem("providerToken"));

  const submitReview = async ({ rating, text }) => {
    if (!canReview) {
      tInfo(t("auth.login_required") || "Войдите, чтобы оставить отзыв");
      throw new Error("login_required");
    }
    await addProviderReview(providerId, { rating, text });
    await reloadReviews();
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      {/* HEADER */}
      <div className="bg-white rounded-xl border shadow p-4 md:p-6 mb-6">
        <div className="flex items-start gap-4">
          {details.logo && <img src={details.logo} alt="" className="w-16 h-16 rounded-xl object-cover ring-1 ring-black/5" />}
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl md:text-2xl font-semibold">{details.name || "Provider"}</h1>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <RatingStars value={reviewsAgg.avg} size={16} />
                <span className="font-medium">{(reviewsAgg.avg || 0).toFixed(1)} / 5</span>
                <span className="opacity-70">· {reviewsAgg.count || 0} {t("reviews.count") || "отзыв(ов)"} </span>
              </div>
            </div>

            <div className="mt-1 text-gray-700 text-sm space-x-2">
              {details.type && <span>provider.type: <b>{details.type}</b></span>}
              {details.region && <span>provider.region: <b>{details.region}</b></span>}
            </div>

            <div className="mt-1 text-sm text-gray-700">
              {details.phone && (
                <>
                  {t("marketplace.phone") || "Телефон"}:{" "}
                  <a className="underline" href={`tel:${String(details.phone).replace(/\s+/g, "")}`}>{details.phone}</a>
                </>
              )}
            </div>

            <div className="mt-1 text-sm text-gray-700">
              {details.telegram && (
                <>
                  Телеграм:{" "}
                  {String(details.telegram).startsWith("@") ? (
                    <a className="underline" href={`https://t.me/${String(details.telegram).slice(1)}`} target="_blank" rel="noreferrer">
                      {details.telegram}
                    </a>
                  ) : /^https?:\/\//.test(String(details.telegram)) ? (
                    <a className="underline" href={details.telegram} target="_blank" rel="noreferrer">{details.telegram}</a>
                  ) : (
                    <span>{details.telegram}</span>
                  )}
                </>
              )}
            </div>

            {details.address && (
              <div className="mt-1 text-sm text-gray-700">
                marketplace.address: {details.address}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* REVIEWS LIST */}
      <div className="bg-white rounded-xl border shadow p-4 md:p-6 mb-6">
        <div className="text-lg font-semibold mb-3">{t("reviews.list") || "Отзывы"}</div>
        {!reviews.length ? (
          <div className="text-gray-500">{t("reviews.empty") || "Пока нет отзывов."}</div>
        ) : (
          <ul className="space-y-4">
            {reviews.map((r) => (
              <li key={r.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <RatingStars value={r.rating || 0} size={16} />
                  <div className="text-xs text-gray-500">
                    {new Date(r.created_at || Date.now()).toLocaleString()}
                  </div>
                </div>
                {r.author?.name && (
                  <div className="text-xs text-gray-600 mt-1">
                    {r.author.name} ({r.author.role})
                  </div>
                )}
                {r.text && <div className="mt-2 whitespace-pre-line">{r.text}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* LEAVE REVIEW */}
      {canReview && (
        <div className="bg-white rounded-xl border shadow p-4 md:p-6">
          <div className="text-lg font-semibold mb-3">{t("reviews.leave") || "Оставить отзыв"}</div>
          <ReviewForm onSubmit={submitReview} submitLabel={t("reviews.send") || "Отправить"} />
        </div>
      )}
    </div>
  );
}
