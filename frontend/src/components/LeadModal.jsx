//frontend/src/components/LeadModal.jsx

import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import useLockBodyScroll from "../hooks/useLockBodyScroll";
import { createLead } from "../api/leads";

export default function LeadModal({
  open,
  onClose,
  defaultService = "tour",          // 'tour' | 'checkup' | 'ayurveda' | 'treatment' | 'b2b'
  defaultPage = (typeof window !== "undefined" ? window.location.pathname : "/"),
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
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState("");
  const dialogRef = useRef(null);
  // UTM из query-параметров – один раз на маунт
  const utm = useMemo(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      return {
        utm_source: sp.get("utm_source") || "",
        utm_medium: sp.get("utm_medium") || "",
        utm_campaign: sp.get("utm_campaign") || "",
        utm_content: sp.get("utm_content") || "",
        utm_term: sp.get("utm_term") || "",
      };
    } catch {
      return {};
    }
  }, []);
  // сброс при открытии
  useEffect(() => {
    if (open) {
      setName(preset.name || "");
      setPhone(preset.phone || "");
      setCity(preset.city || "");
      setPax(preset.pax || "");
      setComment(preset.comment || "");
      setOk(false);
      setErr("");
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
        ...utm,
      });
      onSuccess?.(lead);
      // Сообщаем приложению, что лид успешно отправлен (для бейджа у плавающей кнопки)
      try {
        window.dispatchEvent(new CustomEvent("travella:lead-submitted"));
      } catch {}
      setOk(true);
      setTimeout(() => {
        onClose?.();
        setName(""); setPhone(""); setCity(""); setPax(""); setComment("");
      }, 1200);
   } catch (err) {
      console.error(err);
      setErr(err?.message || "Failed");
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
      className="fixed inset-0 z-[1000] bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4"
      onMouseDown={onBackdrop}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="w-full max-w-xl origin-center animate-[pop_.18s_ease-out] rounded-3xl bg-white/95 shadow-2xl ring-1 ring-black/5 focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#FF5722]/10 text-[#FF5722]">★</span>
            <div>
              <h3 className="text-base md:text-lg font-semibold leading-none">{t("landing.home.cta")}</h3>
              <p className="text-xs text-gray-500 mt-1">{t("landing.form.comment") ? t("landing.form.comment") : "Мы свяжемся в ближайшее время"}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 hover:bg-gray-100 text-gray-500"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {ok ? (
            <div className="p-6 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-emerald-800 flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white">✓</span>
              <span className="font-semibold">{t("landing.form.sent")}</span>
            </div>
          ) : (
            <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-xs text-gray-600">{t("landing.form.name")}</span>
              <input
                className="input !h-11 !rounded-xl !border-gray-200 focus:!ring-2 focus:!ring-[#FF5722]/60"
                placeholder={t("landing.form.name")}
                value={name} onChange={(e)=>setName(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-600">{t("landing.form.phone")}</span>
              <input
                className="input !h-11 !rounded-xl !border-gray-200 focus:!ring-2 focus:!ring-[#FF5722]/60"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t("landing.form.phone")}
                required
                value={phone}
                onChange={(e)=>setPhone(e.target.value)}
              />
            </label>
          </div>
          {/* Для туров удобно спросить город/даты и pax */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-xs text-gray-600">{t("landing.form.destination")}</span>
              <input
                className="input !h-11 !rounded-xl !border-gray-200 focus:!ring-2 focus:!ring-[#FF5722]/60"
                placeholder={t("landing.form.destination")}
                value={city} onChange={(e)=>setCity(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-gray-600">{t("landing.form.pax")}</span>
              <input
                className="input !h-11 !rounded-xl !border-gray-200 focus:!ring-2 focus:!ring-[#FF5722]/60"
                placeholder={t("landing.form.pax")}
                inputMode="numeric"
                value={pax} onChange={(e)=>setPax(e.target.value)}
              />
            </label>
          </div>
          <label className="space-y-1 block">
            <span className="text-xs text-gray-600">{t("landing.form.comment")}</span>
            <textarea
              className="input min-h-[110px] !rounded-xl !border-gray-200 focus:!ring-2 focus:!ring-[#FF5722]/60"
              placeholder={t("landing.form.comment")}
              value={comment} onChange={(e)=>setComment(e.target.value)}
            />
          </label>
             
     {err && <div className="text-sm text-red-600">{t("landing.form.error")}: {err}</div>}
              
          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition"
            >
              {t("landing.form.cancel") ?? "Отмена"}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-xl bg-[#FF5722] text-white shadow-md hover:brightness-95 active:scale-[0.99] disabled:opacity-60 transition"
            >
              {loading ? "…" : t("landing.form.send")}
            </button>
          </div>
          </>
          )}
        </form>
      </div>
    </div>
  );
}
/* tailwind animation keyframes (используются utility-классом animate-[pop_.18s_ease-out]) */
/* Добавьте один раз в ваш globals.css, если ещё нет: 
@keyframes pop { 
  0% { transform: scale(.96); opacity: 0 }
  100% { transform: scale(1); opacity: 1 }
}
*/
