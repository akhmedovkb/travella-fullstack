//frontend/src/pages/ProviderProfile.jsx

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";
import { getProviderReviews } from "../api/reviews";
import ReviewForm from "../components/ReviewForm";
import RatingStars from "../components/RatingStars";
import { tError } from "../shared/toast";

/** ==========================================
 *  Helpers
 *  - pick the first available value among common API field names
 *  - format phone and telegram links
 * ========================================== */
const firstNonEmpty = (...vals) => {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
};

const pickPhoto = (p = {}) => {
  const d = p.details || {};
  return firstNonEmpty(
    p.logo,
    p.photo,
    p.avatar,
    d.logo,
    d.photo,
    d.avatar,
  );
};

const pickTelegram = (p = {}) => {
  const d = p.details || {};
  let tg = firstNonEmpty(
    p.telegram,
    p.telegram_username,
    p.telegramUsername,
    p.telegram_handle,
    p.tg,
    d.telegram,
    d.telegram_username,
    d.telegramUsername,
    d.telegram_handle,
    d.tg
  );
  if (!tg) return "";
  // strip leading @ if any
  tg = String(tg).trim();
  if (tg.startsWith("http")) return tg; // already a URL
  if (tg[0] === "@") tg = tg.slice(1);
  return `https://t.me/${tg}`;
};

const pickPhone = (p = {}) => {
  const d = p.details || {};
  return firstNonEmpty(p.phone, p.telephone, d.phone, d.telephone);
};

const pickRegion = (p = {}) => {
  const d = p.details || {};
  return firstNonEmpty(p.region, p.country, d.region, d.country);
};

function getRole() {
  const hasClient = !!localStorage.getItem("clientToken");
  const hasProvider = !!localStorage.getItem("token") || !!localStorage.getItem("providerToken");
  return hasClient ? "client" : (hasProvider ? "provider" : null);
}

export default function ProviderProfile() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [provider, setProvider] = useState(null);
  const [loading, setLoading] = useState(true);

  // Reviews
  const [reviews, setReviews] = useState([]);
  const [page, setPage] = useState(Number(searchParams.get("page") || 1));
  const [pages, setPages] = useState(1);

  const role = useMemo(getRole, []);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const data = await apiGet(`/api/providers/${id}`);
        if (mounted) setProvider(data || {});
      } catch (e) {
        console.error("Failed to load provider", e);
        tError(t("errors.load_provider") || "Не удалось загрузить поставщика");
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [id, t]);

  // Reviews loader
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { items = [], page: p = 1, pages: ps = 1 } = await getProviderReviews(id, page);
        if (!mounted) return;
        setReviews(items);
        setPage(p);
        setPages(ps);
        setSearchParams(ps > 1 ? { page: String(p) } : {});
      } catch (e) {
        console.error("Failed to load reviews", e);
      }
    })();
    return () => { mounted = false; };
  }, [id, page, setSearchParams]);

  const photo = pickPhoto(provider);
  const phone = pickPhone(provider);
  const region = pickRegion(provider);
  const tgUrl = pickTelegram(provider);
  const rating = Number(provider?.rating) || 0;
  const reviewsCount = Number(provider?.reviews_count || provider?.reviewsCount) || 0;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="animate-pulse h-32 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10">
        {t("errors.not_found") || "Не найдено"}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* === Header card === */}
      <div className="bg-white border rounded-2xl shadow-sm p-5 md:p-6 flex gap-5 md:gap-6 items-start">
        {/* Big photo/logo */}
        <div className="shrink-0">
          <div className="w-32 h-32 md:w-48 md:h-48 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center">
            {photo ? (
              <img src={photo} alt={provider?.name || ""} className="w-full h-full object-cover" />
            ) : (
              <div className="text-gray-400 text-sm px-3 text-center">
                {t("profile.no_photo") || "Нет фото"}
              </div>
            )}
          </div>
        </div>

        {/* Textual info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-bold truncate">
              {t("provider") || "Поставщик"}: {provider?.name || "-"}
            </h1>
            <div className="flex items-center gap-1 text-yellow-500">
              <RatingStars value={rating} />
            </div>
            <div className="text-gray-500 text-sm">
              {rating.toFixed ? rating.toFixed(1) : rating} / 5 • {reviewsCount || 0} {t("reviews") || "отзыв(ов)"}
            </div>
          </div>

          <div className="mt-2 space-y-1.5 text-[15px] leading-6">
            <div className="text-gray-700">
              <span className="text-gray-500">{t("provider_type") || "Тип поставщика"}: </span>
              <span className="font-medium">{t(provider?.type) || provider?.type || "-"}</span>
              <span className="mx-2">•</span>
              <span className="text-gray-500">{t("provider_region") || "Регион поставщика"}: </span>
              <span className="font-medium">{region || "-"}</span>
            </div>

            <div className="text-gray-700">
              <span className="text-gray-500">{t("phone") || "Телефон"}: </span>
              {phone ? (
                <a className="text-blue-600 hover:underline font-medium" href={`tel:${phone}`}>{phone}</a>
              ) : (
                <span>-</span>
              )}
              {tgUrl ? (
                <>
                  <span className="mx-2">•</span>
                  <span className="text-gray-500">Telegram: </span>
                  <a className="text-blue-600 hover:underline font-medium break-all" href={tgUrl} target="_blank" rel="noreferrer">
                    {tgUrl.replace(/^https?:\/\/t\.me\//, "@")}
                  </a>
                </>
              ) : null}
            </div>

            <div className="text-gray-700">
              <span className="text-gray-500">{t("address") || "Адрес"}: </span>
              <span className="font-medium break-words">{provider?.address || "-"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* === Reviews list === */}
      <div className="mt-6 bg-white border rounded-2xl shadow-sm">
        <div className="px-5 py-4 border-b text-lg font-semibold">{t("reviews") || "Отзывы"}</div>
        <div className="p-5 space-y-4">
          {reviews.length === 0 ? (
            <div className="text-gray-500">{t("no_reviews") || "Пока нет отзывов"}</div>
          ) : (
            reviews.map((r) => (
              <div key={r.id} className="border rounded-xl p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <RatingStars value={Number(r.rating) || 0} />
                    <div className="text-sm text-gray-600">
                      {r.client_name || r.clientName || r.user_name || t("client") || "Клиент"}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    {r.created_at?.replace("T", " ").slice(0, 16) || ""}
                  </div>
                </div>
                {r.comment ? <div className="mt-2 text-sm whitespace-pre-wrap">{r.comment}</div> : null}
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
            <button
              className="px-3 py-1.5 rounded border disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              {t("common.prev") || "Назад"}
            </button>
            <div className="px-3 py-1.5">{page} / {pages}</div>
            <button
              className="px-3 py-1.5 rounded border disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
            >
              {t("common.next") || "Вперёд"}
            </button>
          </div>
        )}
      </div>

      {/* === Leave a review === */}
      <div className="mt-6 bg-white border rounded-2xl shadow-sm">
        <div className="px-5 py-4 border-b text-lg font-semibold">{t("leave_review") || "Оставить отзыв"}</div>
        <div className="p-5">
          {role === "client" ? (
            <ReviewForm providerId={id} onSuccess={() => setPage(1)} />
          ) : (
            <div className="text-sm text-gray-500">
              {t("login_to_review") || "Чтобы оставить отзыв, войдите как клиент."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
