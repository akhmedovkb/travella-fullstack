//frontend/src/components/LeadModal.jsx

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import useLockBodyScroll from "../hooks/useLockBodyScroll";
import { createLead } from "../api/leads";

export default function LeadModal({
  open,
  onClose,
  defaultService = "tour",          // 'tour' | 'checkup' | 'ayurveda' | 'treatment' | 'b2b'
  defaultPage = window.location.pathname,
  preset = {},                      // { name, phone, city, pax, comment }
  onSuccess,                        // (lead) => void
}) {
  const { t, i18n } = useTranslation();
  useLockBodyScroll(open);

  const [name, setName] = useState(preset.name || "");
  const [phone, setPhone] = useState(preset.phone || "");
  const [city, setCity] = useState(preset.city || "");
  const [pax, setPax] = useState(preset.pax || "");
  const [comment, setComment] = useState(preset.comment || "");
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef(null);

  // сброс при открытии
  useEffect(() => {
    if (open) {
      setName(preset.name || "");
      setPhone(preset.phone || "");
      setCity(preset.city || "");
      setPax(preset.pax || "");
      setComment(preset.comment || "");
      setTimeout(() => dialogRef.current?.focus(), 0);
    }
  }, [open]);

  // esc закрытие
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && open) onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const lang = i18n.language || "ru";
      const lead = await createLead({
        name, phone,
        city: city || null,
        pax: pax ? Number(pax) : null,
        comment: comment || null,
        page: defaultPage || "/",
        lang,
        service: defaultService,
      });
      onSuccess?.(lead);
      // базовый UX
      alert(t("landing.form.sent"));
      onClose?.();
    } catch (err) {
      console.error(err);
      alert(t("landing.form.error"));
    } finally {
      setLoading(false);
    }
  }

  // backdrop клик
  function onBackdrop(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4"
      onMouseDown={onBackdrop}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">
            {t("landing.home.cta")}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-gray-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="input"
              placeholder={t("landing.form.name")}
              value={name} onChange={(e)=>setName(e.target.value)}
            />
            <input
              className="input"
              placeholder={t("landing.form.phone")}
              required
              value={phone} onChange={(e)=>setPhone(e.target.value)}
            />
          </div>

          {/* Для туров удобно спросить город/даты и pax */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="input"
              placeholder={t("landing.form.destination")}
              value={city} onChange={(e)=>setCity(e.target.value)}
            />
            <input
              className="input"
              placeholder={t("landing.form.pax")}
              inputMode="numeric"
              value={pax} onChange={(e)=>setPax(e.target.value)}
            />
          </div>

          <textarea
            className="input min-h-[100px]"
            placeholder={t("landing.form.comment")}
            value={comment} onChange={(e)=>setComment(e.target.value)}
          />

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border">
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-[#FF5722] text-white disabled:opacity-60"
            >
              {loading ? "…" : t("landing.form.send")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
