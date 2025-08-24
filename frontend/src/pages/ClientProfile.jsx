// frontend/src/pages/ClientProfile.jsx
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { useTranslation } from "react-i18next";

function Stars({ value = 0, size = 14 }) {
  const full = Math.round(value * 2) / 2; // до половинки, если нужно
  const stars = [1, 2, 3, 4, 5].map((i) => (
    <span key={i} style={{ fontSize: size, lineHeight: 1, color: i <= full ? "#f59e0b" : "#d1d5db" }}>
      ★
    </span>
  ));
  return <span className="inline-flex items-center gap-0.5">{stars}</span>;
}

export default function ClientProfile() {
  const { t } = useTranslation();
  const { id } = useParams();
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const token = localStorage.getItem("token");
  const config = token ? { headers: { Authorization: `Bearer ${token}` } } : {};

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        const res = await axios.get(`${API_BASE}/api/profile/client/${id}`, config);
        if (!isMounted) return;
        const row = res.data || {};
        // нормализуем аватар на фронте тоже, на всякий
        row.avatar_url = row.avatar_url || row.avatarUrl || row.avatar || null;
        setData(row);
      } catch (e) {
        console.error("client profile load failed:", e?.response?.data || e?.message);
        setData(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => (isMounted = false);
  }, [id]);

  if (loading) {
    return <div className="text-sm text-gray-500 p-4">{t("common.loading", { defaultValue: "Загрузка…" })}</div>;
  }
  if (!data) {
    return <div className="text-sm text-red-600 p-4">{t("errors.load_failed", { defaultValue: "Не удалось загрузить профиль" })}</div>;
  }

  const avatar = data.avatar_url || null;
  const name = data.name || t("client.title", { defaultValue: "Клиент" });
  const phone = data.phone || "—";
  const telegram = data.telegram || "—";
  const rating = data.rating || { avg: 0, count: 0 };

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 md:py-6">
      {/* Header card */}
      <div className="bg-white rounded-2xl border p-4 md:p-6 flex flex-col md:flex-row md:items-center gap-4">
        <div className="w-24 h-24 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
          {avatar ? (
            <img
              src={avatar}
              alt={name}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span className="text-xs text-gray-500">{t("profile.no_photo", { defaultValue: "Нет фото" })}</span>
          )}
        </div>

        <div className="flex-1">
          <div className="text-xl md:text-2xl font-semibold">
            {t("client.profile_title", { defaultValue: "Клиент" })}: {name}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-700">
            <div className="flex items-center gap-2">
              <Stars value={Number(rating.avg) || 0} />
              <span className="text-sm text-gray-500">
                {(Number(rating.avg) || 0).toFixed(1)} / 5 • {rating.count || 0}{" "}
                {t("reviews.count_suffix", { defaultValue: "отзыв(ов)" })}
              </span>
            </div>
          </div>

          <div className="mt-2 text-sm text-gray-700 flex flex-wrap items-center gap-x-6 gap-y-1">
            <div>
              {t("common.phone", { defaultValue: "Телефон" })}:{" "}
              {phone && phone !== "—" ? (
                <a className="underline hover:no-underline" href={`tel:${String(phone).replace(/[^+\d]/g, "")}`}>
                  {phone}
                </a>
              ) : (
                "—"
              )}
            </div>
            <div>
              Telegram:{" "}
              {telegram && telegram !== "—" ? (
                <a
                  className="underline hover:no-underline"
                  href={
                    /^@/.test(telegram)
                      ? `https://t.me/${telegram.replace(/^@/, "")}`
                      : /^https?:\/\//i.test(telegram)
                      ? telegram
                      : `https://t.me/${telegram}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {/^@/.test(telegram) ? telegram : `@${telegram.replace(/^https?:\/\/t\.me\//i, "")}`}
                </a>
              ) : (
                "—"
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reviews list */}
      <div className="bg-white rounded-2xl border mt-4 md:mt-6 p-4 md:p-6">
        <div className="text-lg font-semibold">{t("reviews.title", { defaultValue: "Отзывы" })}</div>
        {Array.isArray(data.reviews) && data.reviews.length > 0 ? (
          <div className="mt-3 space-y-3">
            {data.reviews.map((rv) => (
              <div key={rv.id} className="border rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{rv.author_name || t("reviews.anonymous", { defaultValue: "Анонимно" })}</div>
                  <Stars value={Number(rv.rating) || 0} />
                </div>
                {!!rv.text && <div className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{rv.text}</div>}
                {!!rv.created_at && (
                  <div className="text-xs text-gray-400 mt-1">
                    {new Date(rv.created_at).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500 mt-2">
            {t("reviews.empty", { defaultValue: "Пока нет отзывов." })}
          </div>
        )}
      </div>

      {/* Review form — оставил заглушку, как договаривались */}
      <div className="bg-white rounded-2xl border mt-4 md:mt-6 p-4 md:p-6">
        <div className="text-lg font-semibold">
          {t("reviews.leave_review", { defaultValue: "Оставить отзыв" })}
        </div>
        <div className="text-sm text-gray-500 mt-2">
          {t("reviews.form_soon", {
            defaultValue: "Форма будет доступна после подключения API отзывов.",
          })}
        </div>
      </div>
    </div>
  );
}
