// frontend/src/pages/ClientProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { apiGet } from "../api";
import RatingStars from "../components/RatingStars";
import ReviewForm from "../components/ReviewForm";

/* ========= helpers (повторяют логику ProviderProfile) ========= */
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
    const s = x.trim();
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try { return JSON.parse(s); } catch { return null; }
    }
  }
  return null;
};
const makeAbsolute = (u) => {
  if (!u) return null;
  const s = String(u).trim();
  if (/^(data:|https?:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `${window.location.protocol}${s}`;
  const base = (import.meta.env.VITE_API_BASE_URL || window.location.origin || "").replace(/\/+$/,"");
  return `${base}/${s.replace(/^\/+/, "")}`;
};
const firstImageFrom = (val) => {
  if (!val) return null;
  if (typeof val === "string") {
    const s = val.trim();
    const parsed = maybeParse(s);
    if (parsed) return firstImageFrom(parsed);
    if (/^(data:|https?:|blob:)/i.test(s)) return s;
    if (/^\/?(storage|uploads|files|images)\b/i.test(s)) return makeAbsolute(s);
    if (s.includes(",") || s.includes("|")) {
      const candidate = s.split(/[,\|]/).map((x) => x.trim()).find(Boolean);
      return firstImageFrom(candidate);
    }
    return makeAbsolute(s);
  }
  if (Array.isArray(val)) {
    for (const item of val) {
      const found = firstImageFrom(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof val === "object") {
    const hit = first(
      val.url, val.src, val.image, val.photo, val.avatar, val.logo,
      Array.isArray(val.images) ? val.images[0] : val.images,
      Array.isArray(val.photos) ? val.photos[0] : val.photos,
      Array.isArray(val.gallery) ? val.gallery[0] : val.gallery
    );
    return firstImageFrom(hit);
  }
  return null;
};

/* ======== загрузка профиля клиента (пробуем несколько эндпойнтов) ======== */
async function fetchClientProfile(clientId) {
  const candidates = [
    `/api/clients/${clientId}`, `/api/client/${clientId}`,
    `/api/users/${clientId}`,   `/api/user/${clientId}`,
    // на случай, если часть данных лежит рядом с провайдерами
    `/api/providers/${clientId}`,
  ];
  for (const url of candidates) {
    try {
      const res = await apiGet(url);
      const obj = (res && (res.data || res.item || res.profile || res.client || res.user)) || res;
      if (obj && (obj.id || obj.name || obj.title)) return obj;
    } catch {}
  }
  return null;
}

/* ======== отзывы о клиенте — мягкие фолбэки ======== */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

async function getClientReviews(clientId) {
  // 1) если в проекте есть модуль api/reviews с нужной функцией — используем его
  try {
    const mod = await import("../api/reviews");
    if (typeof mod.getClientReviews === "function") {
      return await mod.getClientReviews(clientId);
    }
  } catch {}
  // 2) прямые REST-фолбэки (любой из вариантов, что есть на бэке)
  const urls = [
    `${API_BASE}/api/clients/${clientId}/reviews`,
    `${API_BASE}/api/reviews/client/${clientId}`,
    `${API_BASE}/api/reviews/clients/${clientId}`
  ];
  for (const u of urls) {
    try {
      const { data } = await axios.get(u);
      return data;
    } catch {}
  }
  // ничего нет — вернём пусто
  return { stats: { count: 0, avg: 0 }, items: [] };
}

async function addClientReview(clientId, payload) {
  // 1) пробуем модуль, если он есть
  try {
    const mod = await import("../api/reviews");
    if (typeof mod.addClientReview === "function") {
      return await mod.addClientReview(clientId, payload);
    }
  } catch {}
  // 2) фолбэки POST
  const urls = [
    `${API_BASE}/api/clients/${clientId}/reviews`,
    `${API_BASE}/api/reviews/client/${clientId}`
  ];
  for (const u of urls) {
    try {
      return (await axios.post(u, payload)).data;
    } catch {}
  }
  // если не вышло — кидаем ошибку, чтобы показать пользователю toast/alert
  throw new Error("client_reviews_not_supported");
}

/* ================== Страница профиля клиента ================== */
export default function ClientProfile() {
  const { id } = useParams();
  const cid = Number(id);
  const { t } = useTranslation();
  const tx = (key, fallback) => t(key, { defaultValue: fallback });

  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);

  const [reviewsAgg, setReviewsAgg] = useState({ count: 0, avg: 0 });
  const [reviews, setReviews] = useState([]);
  const [reviewsSupported, setReviewsSupported] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const c = await fetchClientProfile(cid);
        if (alive) setClient(c || null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [cid]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await getClientReviews(cid);
        if (!alive) return;
        setReviewsAgg({
          count: Number(data?.stats?.count || data?.count || 0),
          avg: Number(data?.stats?.avg || data?.avg || 0)
        });
        setReviews(Array.isArray(data?.items) ? data.items : []);
        setReviewsSupported(true);
      } catch {
        if (!alive) return;
        setReviewsAgg({ count: 0, avg: 0 });
        setReviews([]);
        setReviewsSupported(false); // на бэке ещё нет поддержки — просто спрячем блок отправки
      }
    })();
    return () => { alive = false; };
  }, [cid]);

  const details = useMemo(() => {
    const d = maybeParse(client?.details) || client?.details || {};
    const contacts = client?.contacts || {};
    const socials  = client?.socials  || {};

    const name     = first(client?.display_name, client?.name, client?.title, client?.nickname, client?.login);
    const about    = first(d?.about, d?.description, client?.about, client?.description, client?.bio);
    const city     = first(d?.city, client?.city, contacts?.city, client?.location?.city);
    const country  = first(d?.country, client?.country, contacts?.country, client?.location?.country);
    const phone    = first(client?.phone, client?.phone_number, contacts?.phone, d?.phone, client?.whatsapp);
    const email    = first(client?.email, contacts?.email, d?.email);
    const telegram = first(client?.telegram, client?.tg, contacts?.telegram, socials?.telegram, d?.telegram);

    const avatar   = firstImageFrom(first(
      client?.avatar, d?.avatar, client?.photo, d?.photo, client?.image, d?.image, client?.logo, d?.logo, client?.images, d?.images
    ));
    const cover    = firstImageFrom(first(client?.cover, d?.cover, client?.banner, d?.banner, client?.images, d?.images));

    const address  = first(d?.address, client?.address, contacts?.address);

    return { name, about, city, country, phone, email, telegram, avatar, cover, address };
  }, [client]);

  // кто может оставлять отзыв: провайдер (и не о себе) или другой клиент
  const canReview = useMemo(() => {
    const providerLogged = !!(localStorage.getItem("token") || localStorage.getItem("providerToken"));
    const clientLogged   = !!(localStorage.getItem("clientToken"));
    const myClientId     = Number(localStorage.getItem("client_id") || localStorage.getItem("id") || NaN);
    return reviewsSupported && (providerLogged || clientLogged) && myClientId !== cid;
  }, [cid, reviewsSupported]);

  const submitReview = async ({ rating, text }) => {
    await addClientReview(cid, { rating, text });
    const data = await getClientReviews(cid);
    setReviewsAgg({
      count: Number(data?.stats?.count || data?.count || 0),
      avg: Number(data?.stats?.avg || data?.avg || 0)
    });
    setReviews(Array.isArray(data?.items) ? data.items : []);
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-4 md:p-6">
        <div className="animate-pulse h-32 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <div className="bg-white rounded-xl border shadow overflow-hidden mb-6">
        {details.cover && (
          <div className="h-40 sm:h-56 w-full overflow-hidden">
            <img src={details.cover} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        <div className="p-4 md:p-6 flex items-start gap-4">
          {/* AVATAR */}
          <div className="shrink-0">
            <div className="w-32 h-32 md:w-48 md:h-48 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center ring-1 ring-black/5">
              {details.avatar ? (
                <img src={details.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-gray-400 px-2">{tx("common.no_photo","Нет фото")}</span>
              )}
            </div>
          </div>

          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl md:text-2xl font-semibold">
                {tx("marketplace.client","Клиент")}: {details.name || "-"}
              </h1>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <RatingStars value={reviewsAgg.avg} size={16} />
                <span className="font-medium">{(reviewsAgg.avg || 0).toFixed(1)} / 5</span>
                <span className="opacity-70">· {reviewsAgg.count || 0} {tx("reviews.count","отзыв(ов)")} </span>
              </div>
            </div>

            <div className="mt-1 text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
              {details.phone && (
                <span>
                  {tx("marketplace.phone","Телефон")}:{" "}
                  <a className="underline" href={`tel:${String(details.phone).replace(/\s+/g,"")}`}>{details.phone}</a>
                </span>
              )}
              {details.telegram && (
                <span>
                  {tx("marketplace.telegram","Телеграм")}:{" "}
                  {String(details.telegram).startsWith("@")
                    ? <a className="underline break-all" href={`https://t.me/${String(details.telegram).slice(1)}`} target="_blank" rel="noreferrer">{details.telegram}</a>
                    : /^https?:\/\//.test(String(details.telegram))
                      ? <a className="underline break-all" href={details.telegram} target="_blank" rel="noreferrer">{details.telegram}</a>
                      : <span>{details.telegram}</span>}
                </span>
              )}
              {details.email   && <span>E-mail: <a className="underline" href={`mailto:${details.email}`}>{details.email}</a></span>}
              {details.city    && <span>{tx("marketplace.city","Город")}: <b>{details.city}</b></span>}
              {details.country && <span>{tx("marketplace.country","Страна")}: <b>{details.country}</b></span>}
              {details.address && <span>{tx("marketplace.address","Адрес")}: <b>{details.address}</b></span>}
            </div>

            {details.about && (
              <div className="mt-3">
                <div className="text-gray-500 text-sm mb-1">{tx("common.about","О себе")}</div>
                <div className="whitespace-pre-line">{details.about}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* список отзывов */}
      <div className="bg-white rounded-xl border shadow p-4 md:p-6 mb-6">
        <div className="text-lg font-semibold mb-3">{tx("reviews.list","Отзывы")}</div>
        {!reviews.length ? (
          <div className="text-gray-500">{tx("reviews.empty","Пока нет отзывов.")}</div>
        ) : (
          <ul className="space-y-4">
            {reviews.map((r) => (
              <li key={r.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RatingStars value={r.rating || 0} size={16} />
                    {r.author?.name && (
                      <span className="text-sm text-gray-600">{r.author.name}</span>
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

      {/* форма отзыва (покажем только если бэк поддерживает и пользователь не сам о себе) */}
      {canReview && (
        <div className="bg-white rounded-xl border shadow p-4 md:p-6">
          <div className="text-lg font-semibold mb-3">{tx("reviews.leave","Оставить отзыв")}</div>
          <ReviewForm onSubmit={submitReview} submitLabel={tx("reviews.send","Отправить")} />
        </div>
      )}
    </div>
  );
}
