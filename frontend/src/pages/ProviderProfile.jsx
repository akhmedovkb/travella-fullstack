//  frontend/src/pages/ProviderProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";
import RatingStars from "../components/RatingStars";
import ReviewForm from "../components/ReviewForm";
import { getProviderReviews, addProviderReview } from "../api/reviews";
import { tInfo, tError } from "../shared/toast";

/* --------- helpers (общие с ClientProfile) --------- */
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
      val.url, val.src, val.image, val.photo, val.logo,
      Array.isArray(val.images) ? val.images[0] : val.images,
      Array.isArray(val.photos) ? val.photos[0] : val.photos,
      Array.isArray(val.gallery) ? val.gallery[0] : val.gallery
    );
    return firstImageFrom(hit);
  }
  return null;
};

/* --------- профиль провайдера (с фолбэками по API) --------- */
async function fetchProviderProfile(providerId) {
  const endpoints = [
    `/api/providers/${providerId}`, `/api/provider/${providerId}`,
    `/api/companies/${providerId}`, `/api/company/${providerId}`,
    `/api/agencies/${providerId}`,  `/api/agency/${providerId}`,
    `/api/users/${providerId}`,     `/api/user/${providerId}`,
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

/* --------- тип поставщика (строки/коды) --------- */
function providerTypeKey(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  const byCode = { "1":"agent","2":"guide","3":"transport","4":"hotel" };
  if (byCode[s]) return byCode[s];
  const direct = {
    agent:"agent","travel_agent":"agent","travelagent":"agent","тур агент":"agent","турагент":"agent","tour_agent":"agent",
    guide:"guide","tour_guide":"guide","tourguide":"guide","гид":"guide","экскурсовод":"guide",
    transport:"transport","transfer":"transport","car":"transport","driver":"transport","taxi":"transport","авто":"transport","транспорт":"transport","трансфер":"transport",
    hotel:"hotel","guesthouse":"hotel","accommodation":"hotel","otel":"hotel","отель":"hotel",
  };
  if (direct[s]) return direct[s];
  if (/guide|гид|экскур/.test(s)) return "guide";
  if (/hotel|guest|accom|otel|отел/.test(s)) return "hotel";
  if (/trans|taxi|driver|car|bus|авто|трансфер|транспорт/.test(s)) return "transport";
  if (/agent|agency|travel|тур|агент/.test(s)) return "agent";
  return null;
}
const providerTypeLabel = (raw, t) => {
  const map = { agent:"Турагент", guide:"Гид", transport:"Транспорт", hotel:"Отель" };
  const key = providerTypeKey(raw);
  return key ? t(`provider.types.${key}`, { defaultValue: map[key] }) : (raw || "");
};

export default function ProviderProfile() {
  const { id } = useParams();
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
        const data = await getProviderReviews(pid);
        if (!alive) return;
        setReviewsAgg({
          count: Number(data?.stats?.count || data?.count || 0),
          avg: Number(data?.stats?.avg || data?.avg || 0)
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
    const socials  = prov?.socials  || {};

    const name     = first(prov?.display_name, prov?.name, prov?.title, prov?.brand, prov?.company_name);
    const about    = first(d?.about, d?.description, prov?.about, prov?.description);
    const city     = first(d?.city, prov?.city, contacts?.city, prov?.location?.city);
    const country  = first(d?.country, prov?.country, contacts?.country, prov?.location?.country);
    const phone    = first(prov?.phone, prov?.phone_number, prov?.phoneNumber, contacts?.phone, d?.phone, prov?.whatsapp, prov?.whatsApp);
    const email    = first(prov?.email, contacts?.email, d?.email);
    const telegram = first(prov?.telegram, prov?.tg, contacts?.telegram, socials?.telegram, d?.telegram, prov?.social);
    const website  = first(prov?.website, contacts?.website, d?.website, prov?.site, socials?.site);

    const logo     = firstImageFrom(first(
      prov?.logo, d?.logo, prov?.photo, d?.photo, prov?.image, d?.image, prov?.avatar, d?.avatar, prov?.images, d?.images
    ));
    const cover    = firstImageFrom(first(prov?.cover, d?.cover, prov?.banner, d?.banner, prov?.images, d?.images));

    const type     = first(
      prov?.type, d?.type, prov?.provider_type, d?.provider_type,
      prov?.type_name, d?.type_name, prov?.category, d?.category,
      prov?.role, d?.role, prov?.kind, d?.kind, prov?.providerType
    );
    const region   = first(prov?.region, d?.region, prov?.location, d?.location);
    const address  = first(d?.address, prov?.address, contacts?.address);

    return { name, about, city, country, phone, email, telegram, website, logo, cover, type, region, address };
  }, [prov]);

  const canReview = useMemo(() => {
    const isClient = !!localStorage.getItem("clientToken");
    const isProvider = !!(localStorage.getItem("token") || localStorage.getItem("providerToken"));
    const myProvId = Number(localStorage.getItem("provider_id") || localStorage.getItem("id") || NaN);
    return (isClient || isProvider) && !(isProvider && myProvId === pid);
  }, [pid]);

  const submitReview = async ({ rating, text }) => {
    try {
      await addProviderReview(pid, { rating, text });
      const data = await getProviderReviews(pid);
      setReviewsAgg({
        count: Number(data?.stats?.count ?? data?.count ?? 0),
        avg: Number(data?.stats?.avg ?? data?.avg ?? 0),
      });
      setReviews(Array.isArray(data?.items) ? data.items : []);
      return true; // <ReviewForm/> покажет зелёный «сохранён»
    } catch (e) {
      const already =
        e?.code === "review_already_exists" ||
        e?.response?.status === 409 ||
        e?.response?.data?.error === "review_already_exists";
      if (already) {
        tInfo(t("reviews.already_left", { defaultValue: "Вы уже оставляли на него отзыв" }));
        return false; // <ReviewForm/> НЕ будет показывать «сохранён»
      }
      console.error(e);
      tError(t("reviews.save_error", { defaultValue: "Не удалось сохранить отзыв" }));
      throw e;
    }
  };

  if (loading) {
    return <div className="max-w-5xl mx-auto p-4 md:p-6"><div className="animate-pulse h-32 bg-gray-100 rounded-xl" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      {/* header */}
      <div className="bg-white rounded-2xl border shadow overflow-hidden mb-6">
        {details.cover && (
          <div className="h-40 sm:h-56 w-full overflow-hidden">
            <img src={details.cover} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-5 flex items-start gap-4">
          <div className="shrink-0 w-20 h-20 md:w-24 md:h-24 rounded-full bg-gray-100 overflow-hidden border">
            {details.logo ? (
              <img src={details.logo} alt="" className="w-full h-full object-cover" />
            ) : null}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold truncate">
                {t("marketplace.supplier", { defaultValue: "Поставщик" })}: {details.name || "—"}
              </h1>
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <RatingStars value={reviewsAgg.avg} size={16} />
                <span>{(reviewsAgg.avg || 0).toFixed(1)} / 5</span>
                <span>•</span>
                <span>{t("reviews.count", { count: reviewsAgg.count ?? 0 })}</span>
              </div>
            </div>

            <div className="mt-2 text-sm text-gray-700 flex flex-wrap gap-x-6 gap-y-1">
              {details.type   && <div>{t("provider.type", { defaultValue: "Тип поставщика" })}: <b>{providerTypeLabel(details.type, t)}</b></div>}
              {details.region && <div>{t("provider.region", { defaultValue: "Регион поставщика" })}: <b>{details.region}</b></div>}
              {details.phone  && <div>{t("marketplace.phone", { defaultValue: "Телефон" })}: <a className="hover:underline" href={`tel:${String(details.phone).replace(/\s+/g,"")}`}>{details.phone}</a></div>}
              {details.telegram && (
                <div>
                  {t("marketplace.telegram", { defaultValue: "Телеграм" })}:{" "}
                  {String(details.telegram).startsWith("@")
                    ? <a className="hover:underline break-all" href={`https://t.me/${String(details.telegram).slice(1)}`} target="_blank" rel="noreferrer">{details.telegram}</a>
                    : /^https?:\/\//.test(String(details.telegram))
                      ? <a className="hover:underline break-all" href={details.telegram} target="_blank" rel="noreferrer">{details.telegram}</a>
                      : <span>{details.telegram}</span>}
                </div>
              )}
              {details.address && <div>{t("marketplace.address", { defaultValue: "Адрес" })}: <b>{details.address}</b></div>}
            </div>
          </div>
        </div>
      </div>

      {/* reviews */}
      <div className="bg-white rounded-2xl border shadow p-5 mb-6">
        <div className="text-lg font-semibold mb-3">{t("reviews.title", { defaultValue: "Отзывы" })}</div>
        {!reviews.length ? (
          <div className="text-sm text-gray-500">{t("reviews.empty", { defaultValue: "Пока нет отзывов." })}</div>
        ) : (
          <div className="space-y-4">
            {reviews.map((r) => {
              const avatar =
                firstImageFrom(r.author?.avatar_url) ||
                "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><rect width='100%' height='100%' fill='%23f3f4f6'/><text x='50%' y='58%' text-anchor='middle' fill='%239ca3af' font-family='Arial' font-size='10'>Нет фото</text></svg>";
              return (
                <div key={r.id} className="border rounded-xl p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <img src={avatar} alt="" className="w-9 h-9 rounded-full object-cover border" />
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {r.author?.name || t("common.anonymous", { defaultValue: "Аноним" })}{" "}
                          {r.author?.role && (
                            <span className="text-xs text-gray-400">({t(`roles.${r.author.role}`, { defaultValue: r.author.role })})</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400">
                          {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                        </div>
                      </div>
                    </div>
                    <RatingStars value={r.rating || 0} size={16} />
                  </div>
                  {r.text ? <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{r.text}</div> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* leave review */}
      {canReview && (
        <div className="bg-white rounded-2xl border shadow p-5">
          <div className="text-lg font-semibold mb-3">{t("reviews.leave", { defaultValue: "Оставить отзыв" })}</div>
          <ReviewForm
            onSubmit={submitReview}
            submitLabel={t("reviews.send", { defaultValue: "Отправить" })}
          />
        </div>
      )}
    </div>
  );
}
