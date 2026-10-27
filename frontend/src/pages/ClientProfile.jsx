// frontend/src/pages/ClientProfile.jsx

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { useTranslation } from "react-i18next";
import RatingStars from "../components/RatingStars";
import ReviewForm from "../components/ReviewForm";
import { getClientReviews, addClientReview } from "../api/reviews";
import { tInfo, tError } from "../shared/toast";

/* -------- те же helpers, что в ProviderProfile -------- */
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

/* -------- helpers для типа поставщика (как в ProviderProfile/ClientDashboard) -------- */
const providerTypeKey = (raw) => {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  const byCode = { "1": "agent", "2": "guide", "3": "transport", "4": "hotel" };
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
};
const providerTypeLabel = (raw, t) => {
  const key = providerTypeKey(raw);
  if (!key) return raw || "";
  const fallback = { agent: "Турагент", guide: "Гид", transport: "Транспорт", hotel: "Отель" }[key];
  return t(`provider.types.${key}`, { defaultValue: fallback });
};

export default function ClientProfile() {
  const { id } = useParams();
  const { t } = useTranslation();

  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const token = localStorage.getItem("token") || localStorage.getItem("providerToken"); // провайдер
  const isProvider = !!token;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  const [reviews, setReviews] = useState([]);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [revLoading, setRevLoading] = useState(false);

  // 🔸 кэш типов поставщиков-авторов отзывов
  const [authorProvTypes, setAuthorProvTypes] = useState({});

  const auth = useMemo(
    () => (token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    [token]
  );

  // профиль клиента
  const loadProfile = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`${API_BASE}/api/profile/client/${id}`, auth);
      setProfile(data || null);
      if (data?.rating) {
        setAvg(Number(data.rating.avg || 0));
        setCount(Number(data.rating.count || 0));
      }
    } catch (e) {
      console.error("client profile load failed:", e?.response?.data || e?.message);
      setError(t("errors.profile_load_failed", { defaultValue: "Не удалось загрузить профиль" }));
    } finally {
      setLoading(false);
    }
  };

  // отзывы о клиенте
  const loadReviews = async () => {
    try {
      setRevLoading(true);
      const data = await getClientReviews(id);
      setReviews(Array.isArray(data?.items) ? data.items : []);
      setAvg(Number(data?.stats?.avg ?? data?.avg ?? 0));
      setCount(Number(data?.stats?.count ?? data?.count ?? 0));
    } catch (e) {
      console.error("reviews load failed:", e?.response?.data || e?.message);
    } finally {
      setRevLoading(false);
    }
  };

  // отправка отзыва (только провайдер)
  const submitReview = async ({ rating, text }) => {
    if (!isProvider) {
      tError(t("auth.provider_login_required", { defaultValue: "Войдите как поставщик" }));
      return false;
    }
    try {
      await addClientReview(id, { rating: Number(rating), text: text?.trim() || null });
      await loadReviews();
      return true; // <ReviewForm/> покажет «сохранён»
    } catch (e) {
      const already =
        e?.code === "review_already_exists" ||
        e?.response?.status === 409 ||
        e?.response?.data?.error === "review_already_exists";
      if (already) {
        tInfo(t("reviews.already_left", { defaultValue: "Вы уже оставляли на него отзыв" }));
        return false; // <ReviewForm/> не будет показывать «сохранён»
      }
      console.error("review submit failed:", e);
      tError(t("reviews.save_error", { defaultValue: "Не удалось сохранить отзыв" }));
      throw e;
    }
  };

  useEffect(() => {
    loadProfile();
    loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  // 🔸 после загрузки отзывов: подтянуть типы поставщиков-авторов
  useEffect(() => {
    const ids = Array.from(
      new Set(
        (reviews || [])
          .map((r) => (r?.author?.role === "provider" ? Number(r?.author?.id || r?.author_id) : null))
          .filter(Boolean)
      )
    );
    if (!ids.length) return;

    let cancelled = false;
    (async () => {
      const map = {};
      for (const pid of ids) {
        try {
          const urls = [
            `/api/providers/${pid}`, `/api/provider/${pid}`,
            `/api/companies/${pid}`, `/api/company/${pid}`,
            `/api/agencies/${pid}`, `/api/agency/${pid}`,
            `/api/users/${pid}`, `/api/user/${pid}`,
          ];
          let prof = null;
          for (const u of urls) {
            try {
              const { data } = await axios.get(`${API_BASE}${u}`, auth);
              if (data) { prof = data; break; }
            } catch {}
          }
          if (!prof) continue;

          const d = typeof prof?.details === "string"
            ? (() => { try { return JSON.parse(prof.details); } catch { return {}; } })()
            : (prof?.details || {});
          const rawType =
            prof?.type ?? prof?.provider_type ?? prof?.category ??
            d?.type ?? d?.provider_type ?? d?.category ?? prof?.role ?? d?.role;

          map[pid] = providerTypeLabel(rawType, t) || t("roles.provider", { defaultValue: "Поставщик" });
        } catch {}
      }
      if (!cancelled) setAuthorProvTypes((prev) => ({ ...prev, ...map }));
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews, t]);

  if (loading) {
    return <div className="max-w-5xl mx-auto p-4 md:p-6"><div className="animate-pulse h-32 bg-gray-100 rounded-xl" /></div>;
  }
  if (error) {
    return <div className="max-w-5xl mx-auto p-4 text-sm text-red-600">{error}</div>;
  }
  if (!profile) return null;

  const avatarHeader =
    profile.avatar_url ||
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='100%' height='100%' fill='%23f3f4f6'/><text x='50%' y='54%' text-anchor='middle' fill='%239ca3af' font-family='Arial' font-size='16'>Нет фото</text></svg>";

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      {/* header (идентичная сетка/размеры) */}
      <div className="bg-white rounded-2xl border shadow p-5 flex items-start gap-4">
        <img src={avatarHeader} alt="avatar" className="w-20 h-20 md:w-24 md:h-24 rounded-full object-cover border" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl md:text-2xl font-semibold truncate">
              {t("client.profile.title", { defaultValue: "Клиент" })}: {profile.name || "—"}
            </h1>
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <RatingStars value={avg} size={16} />
              <span>{(avg || 0).toFixed(1)} / 5</span>
              <span>•</span>
              <span>{t("reviews.count", { count: count ?? 0 })}</span>
            </div>
          </div>

          <div className="mt-2 text-sm text-gray-700 flex flex-wrap gap-x-6 gap-y-1">
            <div>
              {t("common.phone", { defaultValue: "Телефон" })}:{" "}
              {profile.phone ? (
                <a className="hover:underline" href={`tel:${String(profile.phone).replace(/[^+\d]/g, "")}`}>
                  {profile.phone}
                </a>
              ) : "—"}
            </div>
            <div>
              {t("common.telegram", { defaultValue: "Telegram" })}:{" "}
              {profile.telegram ? (
                <a
                  className="hover:underline"
                  href={
                    /^https?:\/\//i.test(profile.telegram)
                      ? profile.telegram
                      : `https://t.me/${String(profile.telegram).replace(/^@/, "")}`
                  }
                  target="_blank" rel="noopener noreferrer"
                >
                  {profile.telegram.startsWith("@") ? profile.telegram : `@${String(profile.telegram).replace(/^@/, "")}`}
                </a>
              ) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* reviews (идентичная верстка) */}
      <div className="bg-white rounded-2xl border shadow p-5 mt-5">
        <div className="text-lg font-semibold mb-3">
          {t("reviews.title", { defaultValue: "Отзывы" })}
        </div>

        {revLoading ? (
          <div className="text-sm text-gray-500">{t("common.loading", { defaultValue: "Загрузка…" })}</div>
        ) : reviews.length === 0 ? (
          <div className="text-sm text-gray-500">
            {t("reviews.empty", { defaultValue: "Пока нет отзывов." })}
          </div>
        ) : (
          <div className="space-y-4">
            {reviews.map((rv) => {
              const avatar =
                firstImageFrom(rv.author?.avatar_url) ||
                "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><rect width='100%' height='100%' fill='%23f3f4f6'/><text x='50%' y='58%' text-anchor='middle' fill='%239ca3af' font-family='Arial' font-size='10'>Нет фото</text></svg>";
              const authorIdNum = Number(rv?.author?.id || rv?.author_id);
              const typeBadge =
                rv?.author?.role === "provider"
                  ? (authorProvTypes[authorIdNum] || t("roles.provider", { defaultValue: "Поставщик" }))
                  : t("roles.client", { defaultValue: "Клиент" });

              return (
                <div key={rv.id} className="border rounded-xl p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <img src={avatar} alt="" className="w-9 h-9 rounded-full object-cover border" />
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {rv.author?.name || t("common.anonymous", { defaultValue: "Аноним" })}{" "}
                          <span className="text-xs text-gray-400">
                            ({typeBadge})
                          </span>
                        </div>
                        <div className="text-xs text-gray-400">
                          {rv.created_at ? new Date(rv.created_at).toLocaleString() : ""}
                        </div>
                        {rv.verified_booking ? (
                          <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            ✓ {t("reviews.verified_booking", { defaultValue: "Подтверждённая поездка" })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <RatingStars value={rv.rating || 0} size={16} />
                  </div>
                  {rv.text ? <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{rv.text}</div> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* leave review — только для провайдера */}
      <div className="bg-white rounded-2xl border shadow p-5 mt-5">
        <div className="text-lg font-semibold mb-3">
          {t("reviews.leave", { defaultValue: "Оставить отзыв" })}
        </div>

        {!isProvider ? (
          <div className="text-sm text-gray-500">
            {t("auth.provider_login_required", { defaultValue: "Войдите как поставщик, чтобы оставить отзыв." })}
          </div>
        ) : (
          <ReviewForm
            onSubmit={submitReview}
            submitLabel={t("actions.send", { defaultValue: "Отправить" })}
          />
        )}
      </div>
    </div>
  );
}
