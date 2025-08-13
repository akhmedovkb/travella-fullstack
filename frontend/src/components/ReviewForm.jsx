// components/ReviewForm.jsx
import React, { useState } from "react";
import axios from "axios";

export default function ReviewForm({
  mode = "service",       // 'service' | 'client'
  targetId,               // serviceId (для service) или clientId (для client)
  bookingId = null,       // опционально
  onDone,
  t,
}) {
  const [rating, setRating] = useState(5);
  const [text, setText]     = useState("");
  const [loading, setLoading] = useState(false);
  const API_BASE = import.meta.env.VITE_API_BASE_URL;

  const submit = async () => {
    if (!targetId) return;
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const url =
        mode === "service"
          ? `${API_BASE}/api/reviews/service/${targetId}`
          : `${API_BASE}/api/reviews/client/${targetId}`;
      await axios.post(url, { rating, text, bookingId }, config);
      onDone?.();
    } catch (e) {
      console.error("submit review:", e);
      alert(t("reviews.save_error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border rounded-xl p-4 bg-gray-50">
      <div className="font-semibold mb-2">
        {mode === "service" ? t("reviews.leave_service") : t("reviews.leave_client")}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <label className="text-sm">{t("reviews.rating")}:</label>
        <select
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
          className="border rounded px-2 py-1 bg-white"
        >
          {[5,4,3,2,1].map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full border rounded px-3 py-2 bg-white"
        placeholder={t("reviews.placeholder")}
      />
      <button
        disabled={loading}
        onClick={submit}
        className="mt-3 px-4 py-2 rounded bg-orange-500 text-white font-semibold disabled:opacity-60"
      >
        {t("reviews.send")}
      </button>
    </div>
  );
}
