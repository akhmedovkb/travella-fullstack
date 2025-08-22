// frontend/src/pages/ProviderProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";
import RatingStars from "../components/RatingStars";
import ReviewForm from "../components/ReviewForm";
import { getProviderReviews, addProviderReview } from "../api/reviews";

/* ───────── helpers ───────── */
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
    for (const v of val) {
      const r = firstImageFrom(v);
      if (r) return r;
    }
    return null;
  }
  if (typeof val === "object") {
    return firstImageFrom(val.url ?? val.src ?? val.href ?? val.link ?? val.path ?? val.data ?? val.base64);
  }
  return null;
};

// попытка получить профиль по нескольким эндпоинтам
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
      const obj =
        (res && (res.data || res.item || res.profile || res.provider || res.company)) || res;
      if (obj && (obj.id || obj.name || obj.title)) return obj;
    } catch {}
  }
  return null;
}

/* ───────── page ───────── */
export default function ProviderProfile() {
  const { id } = useParams();          // /profile/provider/:id
  const pid = Number(id);
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
        const p = await fetchProviderProfile(pid);
        if (alive) setProv(p || null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [pid]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getProviderReviews(pid); // { stats, items }
        if (!alive) return;
        setReviewsAgg({
          count: Number(data?.stats?.count || data?.count || 0),
          avg: Number(data?.stats?.avg || data?.avg || 0),
        });
        setReviews(Array.isArray(data?.items) ? data.items : []);
      } catch {
        if (!alive) return;
        setReviewsAgg({ count: 0, avg: 0 });
        setReviews([]);
      }
    })();
    return () => { alive = false; };
  }, [pid]);

  const details = useMemo(() => {
    const d = maybeParse(prov?.details) || prov?.details || {};
    const contacts = prov?.contacts || {};
    const socials  = prov?.socials || {};

    const name = first(
      prov?.display_name, prov?.name, prov?.title, prov?.brand, prov?.company_name
    );

    const about = first(d?.about, d?.description, prov?.about, prov?.description);

    const city    = first(d?.city,    prov?.city,    contacts?.city,    prov?.location?.city);
    const country = first(d?.country, prov?.country, contacts?.country, prov?.location?.country);

    const phone = first(
      prov?.phone, prov?.phone_number, prov?.phoneNumber, contacts?.phone, d?.phone, prov?.whatsapp, prov?.whatsApp
    );
    const email    = first(prov?.email, contacts?.email, d?.email);
    const telegram = first(prov?.telegram, prov?.tg, contacts?.telegram, socials?.telegram, d?.telegram);
    const website  = first(prov?.website, contacts?.website, d?.website, prov?.site, socials?.site);

    const logo  = firstImageFrom(first(prov?.logo, d?.logo, prov?.image, d?.image));
    const cover = firstImageFrom(first(prov?.cover, d?.cover, prov?.banner, d?.banner, prov?.images));

    const type     = first(prov?.type, d?.type, prov?.provider_type, d?.provider_type);
    const region   = first(prov?.region, d?.region, prov?.location, d?.location);
    const address  = first(d?.address, prov?.address, contacts?.address);

    return { name, about, city, country, phone, email, telegram, website, logo, cover, type, region, address };
  }, [prov]);

  // форма доступна клиенту ИЛИ провайдеру, но провайдер не может оценивать сам себя
  const canReview = useMemo(() => {
    const isClient   = !!localStorage.getItem("clientToken");
    const isProvider = !!(localStorage.getItem("token") || localStorage.getItem("providerToken"));
    const myProvId =
      Number(localStorage.getItem("provider_id") || localStorage.getItem("id") || NaN);
    const isSelfProvider = isProvider && myProvId === pid;
    return (isClient || isProvider) && !isSelfProvider;
  }, [pid]);

  const submitReview = async ({ rating, text }) => {
    await addProviderReview(pid, { rating, text });
    const data = await getProviderReviews(pid);
    setReviewsAgg({
      count: Number(data?.stats?.count || data?.count || 0),
      avg: Number(data?.stats?.avg || data?.avg || 0),
    });
    setReviews(Array.isArray(data?.items) ? data.items : []);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      {/* HEADER */}
      <div className="bg-white rounded-xl border shadow overflow-hidden mb-6">
        {details.cover && (
          <div className="h-40 sm:h-56 w-full overflow-hidden">
            <img src={details.cover} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        <div className="p-4 md:p-6 flex items-start gap-4">
          {details.logo && (
            <img
              src={details.logo}
              alt=""
              className="w-16 h-16 rounded-xl object-cover ring-1 ring-black/5"
            />
          )}

          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl md:text-2xl font-semibold">
                {details.name || t("marketplace.supplier") || "Поставщик"}
              </h1>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <RatingStars value={reviewsAgg.avg} size={16} />
                <span className="font-medium">{(reviewsAgg.avg || 0).toFixed(1)} / 5</span>
                <span className="opacity-70">
                  · {reviewsAgg.count || 0} {t("reviews.count") || "отзыв(ов)"}
                </span>
              </div>
            </div>

            <div className="mt-1 text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
              {details.type    && <span>provider.type: <b>{details.type}</b></span>}
              {details.region  && <span>provider.region: <b>{details.region}</b></span>}
              {details.phone   && (
                <span>
                  {t("marketplace.phone") || "Телефон"}:{" "}
                  <a className="underline" href={`tel:${String(details.phone).replace(/\s+/g, "")}`}>
                    {details.phone}
                  </a>
                </span>
              )}
              {details.telegram && (
                <span>
                  {t("marketplace.telegram") || "Телеграм"}:{" "}
                  {String(details.telegram).startsWith("@") ? (
                    <a className="underline" href={`https://t.me/${String(details.telegram).slice(1)}`} target="_blank" rel="noreferrer">
                      {details.telegram}
                    </a>
                  ) : /^https?:\/\//.test(String(details.telegram)) ? (
                    <a className="underline" href={details.telegram} target="_blank" rel="noreferrer">
                      {details.telegram}
                    </a>
                  ) : (
                    <span>{details.telegram}</span>
                  )}
                </span>
              )}
              {details.address && <span>marketplace.address: <b>{details.address}</b></span>}
            </div>

            {details.about && (
              <div className="mt-3">
                <div className="text-gray-500 text-sm mb-1">{t("common.about") || "О компании"}</div>
                <div className="whitespace-pre-line">{details.about}</div>
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
                  <div className="flex items-center gap-2">
                    <RatingStars value={r.rating || 0} size={16} />
                    {r.author?.name && (
                      <span className="text-sm text-gray-600">
                        {r.author.name} ({r.author.role})
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(r.created_at || r.date || Date.now()).toLocaleString()}
                  </div>
                </div>
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
