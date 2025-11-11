// frontend/src/components/LeadModal.jsx

import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import useLockBodyScroll from "../hooks/useLockBodyScroll";
import { createLead } from "../api/leads";

// === Config: номер WhatsApp получателя (без +). Лучше прокинуть через .env (VITE_WHATSAPP_NUMBER) ===
const WHATSAPP_NUMBER = import.meta?.env?.VITE_WHATSAPP_NUMBER || "998901234567";

// Утилита: оставить только цифры
const onlyDigits = (s = "") => s.replace(/\D/g, "");

export default function LeadModal({
  open,
  onClose,
  defaultService = "tour", // 'tour' | 'checkup' | 'ayurveda' | 'treatment' | 'b2b'
  defaultPage = (typeof window !== "undefined" ? window.location.pathname : "/"),
  preset = {}, // { name, phone, city, pax, comment }
  onSuccess, // (lead) => void
}) {
  const { t, i18n } = useTranslation();
  useLockBodyScroll(open);

  const [name, setName] = useState(preset.name || "");
  const [phone, setPhone] = useState(preset.phone || ""); // маскированное отображение
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
  }, [open, preset]);

  // esc закрытие
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && open) onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ----- Маска телефона Узбекистан: +998 (__) ___-__-__ -----
  function formatUzPhone(view) {
    const d = onlyDigits(view);
    // Всегда приводим к формату с префиксом 998
    const core = d.startsWith("998") ? d.slice(3) : d;
    const p = core.slice(0, 9); // 9 цифр после кода страны
    const a = p.slice(0, 2);
    const b = p.slice(2, 5);
    const c = p.slice(5, 7);
    const e = p.slice(7, 9);
    let out = "+998";
    if (a) out += ` (${a}`;
    if (a && a.length === 2) out += `)`;
    if (b) out += ` ${b}`;
    if (c) out += `-${c}`;
    if (e) out += `-${e}`;
    return out;
  }

  function handlePhoneChange(v) {
    setPhone(formatUzPhone(v));
  }

  // Аналитика (безопасные вызовы)
  function sendAnalytics(payload) {
    try {
      window.gtag && window.gtag("event", "lead_submit", payload);
    } catch {}
    try {
      window.fbq && window.fbq("track", "Lead", { ...payload });
    } catch {}
    try {
      window.ttq && window.ttq.track("SubmitForm", payload);
    } catch {}
  }

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const lang = i18n.language || "ru";

      // Нормализация телефона к формату +998XXXXXXXXX
      let d = onlyDigits(phone);
      if (d.startsWith("998")) d = d.slice(3);
      const phoneNormalized = `+998${d.slice(0, 9)}`;

      const lead = await createLead({
        name,
        phone: phoneNormalized,
        city: city || null,
        pax: pax ? Number(pax) : null,
        comment: comment || null,
        page: defaultPage || "/",
        lang,
        service: defaultService,
        ...utm,
      });

      onSuccess?.(lead);

      // Сообщаем приложению (для бейджа у плавающей кнопки)
      try {
        window.dispatchEvent(new CustomEvent("travella:lead-submitted"));
      } catch {}

      // GA4 / Meta / TikTok
      sendAnalytics({
        service: defaultService,
        page_location: defaultPage || "/",
        lang,
        city,
        pax: pax ? Number(pax) : null,
      });

      setOk(true);

      // Авто-открытие WhatsApp с предзаполненным сообщением
      try {
        const msg = [
          "Здравствуйте! Хочу подбор по Индии",
          `Имя: ${name || "-"}`,
          `Телефон: ${phoneNormalized}`,
          `Услуга: ${defaultService}`,
          city ? `Город/даты: ${city}` : "",
          pax ? `Кол-во человек: ${pax}` : "",
          comment ? `Комментарий: ${comment}` : "",
          `Страница: ${defaultPage}`,
        ]
          .filter(Boolean)
          .join("\n");
        const wa = `https://wa.me/${onlyDigits(WHATSAPP_NUMBER)}?text=${encodeURIComponent(
          msg
        )}`;
        window.open(wa, "_blank", "noopener,noreferrer");
      } catch {}

      setTimeout(() => {
        onClose?.();
        setName("");
        setPhone("");
        setCity("");
        setPax("");
        setComment("");
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
      className="fixed inset-0 z-[1000] bg-black/45 supports-[backdrop-filter]:backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={onBackdrop}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="w-full max-w-xl origin-center animate-[pop_.18s_ease-out] rounded-3xl bg-white/90 supports-[backdrop-filter]:backdrop-blur-md shadow-2xl ring-1 ring-black/5 focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#FF5722]/10 text-[#FF5722]">
              ★
            </span>
            <div>
              <h3 className="text-base md:text-lg font-semibold leading-none">
                {t("landing.home.cta")}
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                {t("landing.form.subtitle", "Мы свяжемся в ближайшее время")}
              </p>
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
        <form
          onSubmit={submit}
          className={`px-6 py-5 space-y-5 ${
            err ? "animate-[shake_.3s_ease-in-out]" : ""
          }`}
        >
          {ok ? (
            <div className="p-6 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-emerald-800 flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white">
                ✓
              </span>
              <span className="font-semibold">{t("landing.form.sent")}</span>
            </div>
          ) : (
            <>
              {/* row 1 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Имя (floating label) */}
                <div className="relative">
                  <span className="absolute left-3 top-3 text-gray-400 pointer-events-none">
                    👤
                  </span>
                  <input
                    className="peer input !h-12 !rounded-xl !border-gray-200 pl-9 focus:!ring-2 focus:!ring-[#FF5722]/60 placeholder-transparent"
                    placeholder=" "
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                  <label
                    className="pointer-events-none absolute left-3 top-3 text-gray-400 text-sm transition-all
                                 peer-focus:-top-2 peer-focus:left-2.5 peer-focus:text-xs peer-focus:text-[#FF5722]
                                 peer-placeholder-shown:top-3 peer-placeholder-shown:text-gray-400
                                 bg-white/90 px-1 rounded"
                  >
                    {t("landing.form.name")}
                  </label>
                </div>

                {/* Телефон (floating label + mask) */}
                <div className="relative">
                  <span className="absolute left-3 top-3 text-gray-400 pointer-events-none">
                    📞
                  </span>
                  <input
                    className="peer input !h-12 !rounded-xl !border-gray-200 pl-9 focus:!ring-2 focus:!ring-[#FF5722]/60 placeholder-transparent"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder=" "
                    required
                    value={phone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                  />
                  <label
                    className="pointer-events-none absolute left-3 top-3 text-gray-400 text-sm transition-all
                                 peer-focus:-top-2 peer-focus:left-2.5 peer-focus:text-xs peer-focus:text-[#FF5722]
                                 peer-placeholder-shown:top-3 peer-placeholder-shown:text-gray-400
                                 bg-white/90 px-1 rounded"
                  >
                    {t("landing.form.phone")}
                  </label>
                </div>
              </div>

              {/* row 2 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Город/даты */}
                <div className="relative">
                  <span className="absolute left-3 top-3 text-gray-400 pointer-events-none">
                    📍
                  </span>
                  <input
                    className="peer input !h-12 !rounded-xl !border-gray-200 pl-9 focus:!ring-2 focus:!ring-[#FF5722]/60 placeholder-transparent"
                    placeholder=" "
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                  <label
                    className="pointer-events-none absolute left-3 top-3 text-gray-400 text-sm transition-all
                                 peer-focus:-top-2 peer-focus:left-2.5 peer-focus:text-xs peer-focus:text-[#FF5722]
                                 peer-placeholder-shown:top-3 peer-placeholder-shown:text-gray-400
                                 bg-white/90 px-1 rounded"
                  >
                    {t("landing.form.destination")}
                  </label>
                </div>

                {/* Кол-во человек */}
                <div className="relative">
                  <span className="absolute left-3 top-3 text-gray-400 pointer-events-none">
                    👥
                  </span>
                  <input
                    className="peer input !h-12 !rounded-xl !border-gray-200 pl-9 focus:!ring-2 focus:!ring-[#FF5722]/60 placeholder-transparent"
                    placeholder=" "
                    inputMode="numeric"
                    value={pax}
                    onChange={(e) => setPax(e.target.value)}
                  />
                  <label
                    className="pointer-events-none absolute left-3 top-3 text-gray-400 text-sm transition-all
                                 peer-focus:-top-2 peer-focus:left-2.5 peer-focus:text-xs peer-focus:text-[#FF5722]
                                 peer-placeholder-shown:top-3 peer-placeholder-shown:text-gray-400
                                 bg-white/90 px-1 rounded"
                  >
                    {t("landing.form.pax")}
                  </label>
                </div>
              </div>

              {/* Комментарий */}
              <div className="relative">
                <span className="absolute left-3 top-3 text-gray-400 pointer-events-none">
                  📝
                </span>
                <textarea
                  className="peer input min-h-[110px] !rounded-xl !border-gray-200 pl-9 focus:!ring-2 focus:!ring-[#FF5722]/60 placeholder-transparent"
                  placeholder=" "
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <label
                  className="pointer-events-none absolute left-3 top-3 text-gray-400 text-sm transition-all
                               peer-focus:-top-2 peer-focus:left-2.5 peer-focus:text-xs peer-focus:text-[#FF5722]
                               peer-placeholder-shown:top-3 peer-placeholder-shown:text-gray-400
                               bg-white/90 px-1 rounded"
                >
                  {t("landing.form.comment")}
                </label>
              </div>

              {err && (
                <div className="text-sm text-red-600">
                  {t("landing.form.error")}: {err}
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-end pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#FF5722] to-[#FF7A45] text-white shadow-md hover:brightness-95 active:scale-[0.99] disabled:opacity-60 transition inline-flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4 animate-spin"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="9"
                          strokeWidth="2"
                          className="opacity-30"
                        ></circle>
                        <path d="M21 12a9 9 0 0 0-9-9" strokeWidth="2"></path>
                      </svg>
                      <span>{t("landing.form.sending", "Отправка…")}</span>
                    </>
                  ) : (
                    t("landing.form.send")
                  )}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

/* tailwind keyframes для появления/ошибки (добавьте в globals/index.css, если ещё нет)
@keyframes pop {
  0% { transform: scale(.96); opacity: 0 }
  100% { transform: scale(1); opacity: 1 }
}
@keyframes shake {
  0%,100% { transform: translateX(0) }
  20% { transform: translateX(-4px) }
  40% { transform: translateX(4px) }
  60% { transform: translateX(-3px) }
  80% { transform: translateX(3px) }
}
*/
