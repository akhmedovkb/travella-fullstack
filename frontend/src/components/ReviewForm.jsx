// frontend/src/components/ReviewForm.jsx
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { tSuccess, tError } from "../shared/toast";

export default function ReviewForm({ onSubmit, submitLabel }) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); // чтобы форма не перезагружала страницу
    if (busy) return;
    try {
      setBusy(true);
      await onSubmit?.({ rating, text });
      setText("");
      setRating(5);
      tSuccess(t("reviews.saved") || "Отзыв отправлен");
    } catch {
      tError(t("reviews.save_error") || "Не удалось сохранить отзыв");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="text-sm text-gray-600">{t("reviews.your_rating") || "Ваша оценка"}</div>
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            className={`px-3 py-1 rounded border ${
              rating === n ? "bg-yellow-100 border-yellow-300" : "bg-white"
            }`}
          >
            {n}★
          </button>
        ))}
      </div>

      <textarea
        className="w-full border rounded p-2 min-h-[96px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("reviews.placeholder") || "Коротко опишите опыт"}
      />

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded bg-gray-900 text-white disabled:opacity-60"
        >
          {submitLabel || t("actions.save") || "Сохранить"}
        </button>
      </div>
    </form>
  );
}
