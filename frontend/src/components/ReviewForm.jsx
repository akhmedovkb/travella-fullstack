// frontend/src/components/ReviewForm.jsx
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { tSuccess } from "../shared/toast";

export default function ReviewForm({ onSubmit, submitLabel }) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); // не перезагружаем страницу
    if (busy) return;

    setBusy(true);
    try {
      // Родитель должен вернуть true, если отзыв реально сохранён.
      // На 409/ошибках родитель возвращает false (и сам показывает тост).
      const saved = await onSubmit?.({ rating, text });

      if (saved === true) {
        setText("");
        setRating(5);
        tSuccess(t("reviews.saved", { defaultValue: "Отзыв сохранён" }));
      }
      // Если saved === false или промис упал — тосты уже показал родитель.
    } catch {
      // Ошибки (включая review_already_exists) обрабатываются родителем.
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="text-sm text-gray-600">
        {t("reviews.your_rating", { defaultValue: "Ваша оценка" })}
      </div>

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
        placeholder={t("reviews.placeholder", { defaultValue: "Коротко опишите опыт" })}
      />

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded bg-gray-900 text-white disabled:opacity-60"
        >
          {submitLabel || t("actions.save", { defaultValue: "Сохранить" })}
        </button>
      </div>
    </form>
  );
}
