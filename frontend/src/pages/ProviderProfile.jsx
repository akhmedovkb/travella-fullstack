// frontend/src/pages/ProviderProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";
import RatingStars from "../components/RatingStars";
import ReviewForm from "../components/ReviewForm";
import { getProviderReviews, addProviderReview } from "../api/reviews";

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
  if (typeof x === "string") { try { return JSON.parse(x); } catch { return null; } }
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
    if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, "").length > 100)
      return `data:image/jpeg;base64,${s.replace(/\s+/g, "")}`;
    if (/^(https?:|blob:|file:|\/)/i.test(s)) return s;
    return `${window.location.origin}/${s.replace(/^\.?\//, "")}`;
  }
  if (Array.isArray(val)) {
    for (const v of val) { const r = firstImageFrom(v); if (r) return r; }
    return null;
  }
  if (typeof val === "object")
    return firstImageFrom(val.url ?? val.src ?? val.href ?? val.link ?? val.path ?? val.data ?? val.base64);
  return null;
};

async function fetchProviderProfile(id) {
  const endpoints = [
    `/api/providers/${id}`, `/api/provider/${id}`,
    `/api/companies/${id}`, `/api/company/${id}`,
    `/api/agencies/${id}`,  `/api/agency/${id}`,
    `/api/users/${id}`,     `/api/user/${id}`,
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
  const pid = Number(id);
  const { t } = useTranslation();

  const [prov, setProv] = useState(null);
  const [loading, setLoading] = useState(true);

  const [agg, setAgg] = useState({ avg: 0, count: 0 });
  const [items, setItems] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const p = await fetchProviderProfile(pid);
        if (alive) setProv(p || null);
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [pid]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getProviderReviews(pid, { limit: 20, offset: 0 });
        if (!alive) return;
        setAgg(res?.stats || { avg: 0, count: 0 });
        setItems(Array.isArray(res?.items) ? res.items : []);
      } catch {
        if (!alive) return;
        setAgg({ avg: 0, count: 0 });
        setItems([]);
      }
    })();
    return () => { alive = false; };
  }, [pid]);

  const details = useMemo(() => {
    const d = maybeParse(prov?.details) || prov?.details || {};
    const name = first(prov?.display_name, prov?.name, prov?.title, prov?.brand, prov?.company_name);

    const type   = first(prov?.type, d?.type, d?.provider_type, prov?.provider_type);
    const region = first(prov?.region, d?.region, prov?.location, d?.location, prov?.city, d?.city, prov?.country, d?.country);

    const phone = first(prov?.phone, d?.phone, prov?.phone_number, prov?.whatsapp, prov?.whatsApp);
    const email = first(prov?.email, d?.email);
    const telegram = first(prov?.telegram, d?.telegram, prov?.social, d?.social, prov?.social_link);
    const website = first(prov?.website, d?.website, prov?.site);
    const certificate = first(prov?.certificate, d?.certificate);
    const address = first(prov?.address, d?.address);

    const logo  = firstImageFrom(first(prov?.logo, d?.logo, prov?.photo, d?.photo, prov?.image, d?.image));
    const cover = firstImageFrom(first(prov?.cover, d?.cover, prov?.banner, d?.banner, prov?.images));

    return { name, type, region, phone, email, telegram, website, certificate, address, logo, cover };
  }, [prov]);

  const myProviderId = useMemo(() => {
    try {
      const raw = localStorage.getItem("user") || localStorage.getItem("profile") || "{}";
      const u = JSON.parse(raw);
      return Number(u?.provider_id ?? u?.id ?? null) || null;
    } catch { return null; }
  }, []);
  const isClient   = !!localStorage.getItem("clientToken");
  const isProvider = !!(localStorage.getItem("token") || localStorage.getItem("providerToken"));
  const canReview  = (isClient || isProvider) && (!isProvider || myProviderId !== pid);

  const submitReview = async ({ rating, text }) => {
    await addProviderReview(pid, { rating, text });
    const res = await getProviderReviews(pid, { limit: 20, offset: 0 });
    setAgg(res?.stats || { avg: 0, count: 0 });
    setItems(Array.isArray(res?.items) ? res.items : []);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      <div className="bg-white rounded-xl border shadow overflow-hidden mb-6">
        {details.cover && (
          <div className="h-40 sm:h-56 w-full overflow-hidden">
            <img src={details.cover} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-4 md:p-6 flex items-start gap-4">
          {details.logo && (
            <img src={details.logo} alt="" className="w-16 h-16 rounded-xl object-cover ring-1 ring-black/5" />
          )}
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl md:text-2xl font-semibold">
                {details.name || t("marketplace.supplier") || "Поставщик"}
              </h1>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <RatingStars value={agg.avg} size={16} />
                <span className="font-medium">{(agg.avg || 0).toFixed(1)} / 5</span>
                <span className="opacity-70">· {agg.count || 0} {t("reviews.count") || "отзыв(ов)"} </span>
              </div>
            </div>

            <div className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-gray-700">
              {details.type    && <div><span className="text-gray-500">{t("provider.type")    || "Тип"}: </span><b>{details.type}</b></div>}
              {details.region  && <div><span className="text-gray-500">{t("provider.region")  || "Регион/место"}: </span><b>{details.region}</b></div>}
              {details.phone   && <div><span className="text-gray-500">{t("marketplace.phone") || "Телефон"}: </span>
                                     <a className="underline" href={`tel:${String(details.phone).replace(/\s+/g,"")}`}>{details.phone}</a></div>}
              {details.email   && <div><span className="text-gray-500">Email: </span>
                                     <a className="underline" href={`mailto:${details.email}`}>{details.email}</a></div>}
              {details.telegram && (
                <div>
                  <span className="text-gray-500">{t("marketplace.telegram") || "Телеграм"}: </span>
                  {/^https?:\/\//.test(String(details.telegram)) ? (
                    <a className="underline" href={details.telegram} target="_blank" rel="noreferrer">{details.telegram}</a>
                  ) : String(details.telegram).startsWith("@") ? (
                    <a className="underline" href={`https://t.me/${String(details.telegram).slice(1)}`} target="_blank" rel="noreferrer">
                      {details.telegram}
                    </a>
                  ) : (<span>{details.telegram}</span>)}
                </div>
              )}
              {details.website && (
                <div>
                  <span className="text-gray-500">{t("marketplace.website") || "Сайт"}: </span>
                  <a className="underline" href={/^https?:\/\//.test(details.website) ? details.website : `https://${details.website}`} target="_blank" rel="noreferrer">
                    {details.website}
                  </a>
                </div>
              )}
              {details.certificate && (
                <div>
                  <span className="text-gray-500">{t("provider.certificate") || "Сертификат"}: </span>
                  <a className="underline" href={details.certificate} target="_blank" rel="noreferrer">
                    {t("provider.view_certificate") || "Посмотреть сертификат"}
                  </a>
                </div>
              )}
              {details.address && (
                <div>
                  <span className="text-gray-500">{t("marketplace.address") || "Адрес"}: </span>
                  <span>{details.address}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* отзывов список */}
      <div className="bg-white rounded-xl border shadow p-4 md:p-6 mb-6">
        <div className="text-lg font-semibold mb-3">{t("reviews.list") || "Отзывы"}</div>
        {!items.length ? (
          <div className="text-gray-500">{t("reviews.empty") || "Пока нет отзывов."}</div>
        ) : (
          <ul className="space-y-4">
            {items.map(r => (
              <li key={r.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <RatingStars value={r.rating || 0} size={16}/>
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

      {/* форма оставить отзыв */}
      {canReview && (
        <div className="bg-white rounded-xl border shadow p-4 md:p-6">
          <div className="text-lg font-semibold mb-3">{t("reviews.leave") || "Оставить отзыв"}</div>
          <ReviewForm onSubmit={submitReview} submitLabel={t("reviews.send") || "Отправить"} />
        </div>
      )}
    </div>
  );
}
