// components/ReviewForm.jsx

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { tSuccess, tError, tInfo } from "../shared/toast";
import { createServiceReview, createClientReview } from "../api/reviews";

export default function ReviewForm({
  targetType,        // 'provider' | 'client'
  targetId,          // number
  targetName,        // string
  serviceId,         // optional
  requestId,         // optional
  onCreated,         // callback
}) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (rating < 1 || rating > 5) {
      tInfo(t("reviews.bad_rating") || "Выберите оценку 1–5");
      return;
    }
    setSaving(true);
    try {
         if (targetType === "provider") {
     // По текущему контракту отзыв провайдеру идёт через конкретную услугу
     if (!serviceId) {
       tInfo(t("reviews.need_service") || "Выберите услугу, чтобы оставить отзыв провайдеру");
       setSaving(false);
       return;
     }
     await createServiceReview(serviceId, {
       rating,
       text: text?.trim() || undefined,
       request_id: requestId || undefined,
     });
   } else if (targetType === "client") {
     await createClientReview(targetId, {
       rating,
       text: text?.trim() || undefined,
       service_id: serviceId || undefined,
       request_id: requestId || undefined,
     });
   } else {
     throw new Error("bad_target_type");
   }
      tSuccess(t("reviews.saved") || "Отзыв сохранён", { autoClose: 1800 });
      setText("");
      setRating(5);
      onCreated?.();
    } catch (err) {
      const code = (err?.response?.data?.error || err?.data?.error || err?.message || "").toString();
      if (code.includes("no_interaction")) {
        tInfo(t("reviews.no_interaction") || "Нельзя оставить отзыв без взаимодействия");
      } else if (code.includes("self_review_forbidden")) {
        tInfo(t("reviews.self_forbidden") || "Нельзя оценивать себя");
      } else {
        tError(t("reviews.save_error") || "Не удалось сохранить отзыв");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border rounded-xl p-4 bg-white shadow-sm">
      <div className="text-sm text-gray-600 mb-1">
        {t("reviews.your_rating") || "Ваша оценка"}
      </div>
      <div className="flex gap-2 mb-3">
        {[1,2,3,4,5].map((n) => (
          <button
            key={n}
            type="button"
            className={`px-3 py-1.5 rounded border ${n <= rating ? "bg-amber-100 border-amber-300" : "bg-white"}`}
            onClick={() => setRating(n)}
          >
            {n}★
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("reviews.placeholder") || "Поделитесь впечатлением…"}
        className="w-full border rounded-lg px-3 py-2 min-h-[96px] mb-3"
      />

      <div className="flex justify-end">
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-gray-900 text-white"
          onClick={submit}
          disabled={saving}
        >
          {t("actions.save") || "Сохранить"}
        </button>
      </div>
    </div>
  );
}
