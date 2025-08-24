// frontend/src/pages/ClientProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { getClientReviews, addClientReview } from "../api/reviews";
import { toast } from "react-hot-toast";

const Stars = ({ value = 0, onChange, size = "text-xl", readonly = false }) => {
  const [hover, setHover] = useState(0);
  const curr = hover || value;
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readonly}
          onMouseEnter={() => !readonly && setHover(n)}
          onMouseLeave={() => !readonly && setHover(0)}
          onClick={() => !readonly && onChange?.(n)}
          className={`leading-none ${size} ${readonly ? "cursor-default" : "cursor-pointer"}`}
          aria-label={`${n} star`}
        >
          <span className={n <= curr ? "text-yellow-500" : "text-gray-300"}>★</span>
        </button>
      ))}
    </div>
  );
};

export default function ClientProfile() {
  const { t } = useTranslation();
  const { id } = useParams();

  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const token = localStorage.getItem("token") || localStorage.getItem("providerToken"); // провайдер
  const isProvider = !!token;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  // reviews
  const [revLoading, setRevLoading] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);

  // my review form
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const auth = useMemo(
    () => (token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    [token]
  );

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

  // ✅ берём существующий эндпоинт: GET /api/reviews/client/:id
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


  // ✅ отправляем в: POST /api/reviews/client/:id
  // загрузка отзывов — важно НЕ деструктурировать { data }:
const loadReviews = async () => {
  try {
    setRevLoading(true);
    const data = await getClientReviews(id);
    setReviews(Array.isArray(data?.items) ? data.items : []);
    setAvg(Number(data?.stats?.avg ?? data?.avg ?? 0));
    setCount(Number(data?.stats?.count ?? data?.count ?? 0));
  } finally {
    setRevLoading(false);
  }
};

// отправка
const submitReview = async () => {
  if (!isProvider) {
    toast.error(t("auth.provider_login_required", { defaultValue: "Войдите как поставщик" }));
    return;
  }
  if (!rating) {
    toast.error(t("errors.rating_required", { defaultValue: "Укажите оценку" }));
    return;
  }

  try {
    setSending(true);
    const res = await addClientReview(id, { rating: Number(rating), text: text?.trim() || null });

    // 200 с {error:"review_already_exists"}
    if (res?.error === "review_already_exists") {
      toast.info(t("reviews.already_left", { defaultValue: "Вы уже оставили отзыв" }));
      return;
    }

    setText("");
    setRating(5);
    await loadReviews();
  } catch (e) {
    const already =
      e?.code === "review_already_exists" ||
      e?.response?.status === 409 ||
      e?.response?.data?.error === "review_already_exists" ||
      String(e?.message || "").includes("review_already_exists");

    if (already) {
      toast.info(t("reviews.already_left", { defaultValue: "Вы уже оставили отзыв" }));
    } else {
      console.error("review submit failed:", e);
      toast.error(t("reviews.save_error", { defaultValue: "Не удалось сохранить отзыв" }));
    }
  } finally {
    setSending(false);
  }
};


  useEffect(() => {
    loadProfile();
    loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">{t("common.loading", { defaultValue: "Загрузка…" })}</div>;
  }
  if (error) {
    return <div className="p-4 text-sm text-red-600">{error}</div>;
  }
  if (!profile) return null;

  const avatar =
    profile.avatar_url ||
    "data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'>\
<rect width='100%' height='100%' fill='#f3f4f6'/>\
<text x='50%' y='54%' text-anchor='middle' fill='#9ca3af' font-family='Arial' font-size='16'>Нет фото</text>\
</svg>";

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header card */}
      <div className="bg-white border rounded-2xl p-5 flex items-start gap-4">
        <img src={avatar} alt="avatar" className="w-20 h-20 rounded-full object-cover border" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold truncate">
              {t("client.profile.title", { defaultValue: "Клиент" })}: {profile.name || "—"}
            </h1>
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Stars value={avg} readonly size="text-base" />
              <span>{(avg || 0).toFixed(1)} / 5</span>
              <span>•</span>
              {/* плюрализация i18n */}
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

      {/* Reviews list */}
      <div className="bg-white border rounded-2xl p-5 mt-5">
        <div className="text-lg font-semibold mb-2">
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
            {reviews.map((rv) => (
              <div key={rv.id} className="border rounded-xl p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={rv.author?.avatar_url || avatar}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover border"
                    />
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {rv.author?.name || t("common.anonymous", { defaultValue: "Аноним" })}
                      </div>
                      <div className="text-xs text-gray-400">
                        {rv.created_at ? new Date(rv.created_at).toLocaleString() : ""}
                      </div>
                    </div>
                  </div>
                  <Stars value={rv.rating || 0} readonly size="text-base" />
                </div>
                {rv.text ? (
                  <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{rv.text}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Leave a review (только провайдер может оставить отзыв о клиенте) */}
      <div className="bg-white border rounded-2xl p-5 mt-5">
        <div className="text-lg font-semibold mb-3">
          {t("reviews.leave", { defaultValue: "Оставить отзыв" })}
        </div>

        {!isProvider ? (
          <div className="text-sm text-gray-500">
            {t("auth.provider_login_required", { defaultValue: "Войдите как поставщик, чтобы оставить отзыв." })}
          </div>
        ) : (
          <>
            <div className="text-sm text-gray-700 mb-2">
              {t("reviews.your_rating", { defaultValue: "Ваша оценка" })}
            </div>
            <Stars value={rating} onChange={setRating} size="text-2xl" />
            <textarea
              className="mt-3 w-full border rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-200"
              rows={4}
              placeholder={t("reviews.placeholder", { defaultValue: "Коротко опишите опыт" })}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="mt-3">
              <button
                type="button"
                onClick={submitReview}
                disabled={sending}
                className="px-4 py-2 rounded-xl bg-gray-900 text-white hover:bg-black disabled:opacity-60"
              >
                {sending
                  ? t("common.sending", { defaultValue: "Отправка…" })
                  : t("actions.send", { defaultValue: "Отправить" })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
