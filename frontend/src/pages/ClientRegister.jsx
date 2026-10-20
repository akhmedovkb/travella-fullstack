// frontend/src/pages/ClientRegister.jsx
import { useState } from "react";
import { useNavigate, Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { apiPost } from "../api";             // как и было
import { toast } from "../ui/toast";          // реэкспорт react-hot-toast

/** ---------- утилиты (как в Register) ---------- */
const normalizePhone = (raw = "") =>
  raw.toString().replace(/[^\d+]/g, "").replace(/^\+?/, "+");

const isValidE164 = (p) => /^\+\d{7,15}$/.test(p);

/** Преобразуем сырые системные ошибки/сообщения бэкенда в i18n-строки */
const parseErrorMessage = (err, t) => {
  const raw =
    err?.response?.data?.error ??
    err?.response?.data?.message ??
    err?.message ??
    "";

  // Если сервер прислал i18n-ключ — используем его
  if (typeof raw === "string" && (raw.startsWith("register.") || raw.startsWith("client."))) {
    return t(raw);
  }

  const s = String(raw).toLowerCase();

  // Email занят (англ/рус/уз)
  if (/email/.test(s) && /(exist|used|taken|занят|использ|mavjud|ishlatilgan)/.test(s)) {
    return t("register.errors.email_taken");
  }

  // Неверный телефон
  if (/(phone|телефон|raqam)/.test(s) && /(invalid|format|неверн|noto‘g‘ri|noto'g'ri)/.test(s)) {
    return t("register.errors.phone_invalid");
  }

  // Поле обязательно
  if (/(required|must|обязат|требует|пуст|kerak|bo‘sh|bo'sh|empty)/.test(s)) {
    return t("register.errors.required");
  }

  // Фолбэк
  return t("register.error");
};
/** --------------------------------------------- */

export default function ClientRegister() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const location = useLocation();
  const rawRedirect = new URLSearchParams(location.search).get("redirect") || "";
  const safeRedirect = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/client/dashboard";

  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const requiredTitle = t("register.errors.required");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (loading) return;

    // Локальные проверки (как в Register)
    if (!form.name || !form.email || !form.phone || !form.password) {
      toast.error(t("register.errors.required"));
      return;
    }

    const phoneNormalized = normalizePhone(form.phone);
    if (!isValidE164(phoneNormalized)) {
      toast.error(t("register.errors.phone_invalid"));
      return;
    }
    if (form.password.length < 8) {
      toast.error(t("register.errors.password_length"));
      return;
    }

    const payload = { ...form, phone: phoneNormalized };

    try {
      setLoading(true);

      await toast.promise(
        apiPost("/api/clients/register", payload, false), // без токена, как у вас
        {
          // используем client.* если есть, иначе common/register
          loading: t("client.register.loading", { defaultValue: t("common.loading") }),
          success: t("client.register.success", { defaultValue: t("register.success") }),
          error: (e2) => parseErrorMessage(e2, t),
        }
      );

      nav(`/client/login?redirect=${encodeURIComponent(safeRedirect)}`);
    } catch (e2) {
      // на всякий — продублируем в баннер локализованное сообщение
      const msg = parseErrorMessage(e2, t);
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6 md:py-12">
      <div className="grid overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid-cols-[0.8fr_1.2fr]">
        <aside className="order-2 bg-slate-950 p-7 text-white md:p-10 lg:order-1">
          <Link to="/" className="text-sm font-bold text-orange-400 hover:text-orange-300">
            {t("client.register.back_marketplace")}
          </Link>
          <h2 className="mt-8 text-2xl font-black leading-tight md:text-3xl">
            {t("client.register.benefits_title")}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {t("client.register.benefits_subtitle")}
          </p>
          <ul className="mt-8 space-y-5">
            {["booking", "favorites", "history"].map((benefit) => (
              <li key={benefit} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-black" aria-hidden="true">✓</span>
                <div>
                  <div className="text-sm font-bold">{t(`client.register.benefit_${benefit}`)}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-400">{t(`client.register.benefit_${benefit}_hint`)}</div>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <section className="order-1 p-6 md:p-10 lg:order-2">
          <div className="border-b border-slate-200 pb-6">
            <div>
              <p className="text-xs font-black uppercase text-orange-600">{t("client.register.eyebrow")}</p>
              <h1 className="mt-2 text-3xl font-black text-slate-950">{t("client.register.title")}</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{t("client.register.subtitle")}</p>
            </div>
          </div>

          {err && (
            <div role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {err}
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-800">{t("client.register.name_label")}</span>
              <input className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none transition placeholder:text-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-100" placeholder={t("client.register.name_placeholder")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" required title={requiredTitle} lang={i18n.language} />
            </label>

            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-800">{t("client.register.email_label")}</span>
                <input type="email" className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none transition placeholder:text-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-100" placeholder={t("client.register.email_placeholder")} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required title={requiredTitle} lang={i18n.language} />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-800">{t("client.register.phone_label")}</span>
                <input type="tel" className="h-12 w-full rounded-lg border border-slate-300 px-4 outline-none transition placeholder:text-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-100" placeholder={t("client.register.phone_placeholder")} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" required title={t("register.phone_hint")} lang={i18n.language} />
                <span className="mt-1.5 block text-xs text-slate-500">{t("register.phone_hint")}</span>
              </label>
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-800">{t("client.register.password_label")}</span>
              <div className="relative">
                <input type={showPassword ? "text" : "password"} minLength={8} className="h-12 w-full rounded-lg border border-slate-300 px-4 pr-28 outline-none transition placeholder:text-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-100" placeholder={t("client.register.password_placeholder")} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" required title={requiredTitle} lang={i18n.language} />
                <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 px-4 text-xs font-bold text-slate-600 hover:text-slate-950" aria-label={showPassword ? t("client.register.hide_password") : t("client.register.show_password")}>
                  {showPassword ? t("client.register.hide") : t("client.register.show")}
                </button>
              </div>
              <span className="mt-1.5 block text-xs text-slate-500">{t("client.register.password_hint")}</span>
            </label>

            <button type="submit" disabled={loading} className={`h-12 w-full rounded-lg text-sm font-black text-white transition ${loading ? "cursor-not-allowed bg-orange-300" : "bg-orange-600 hover:bg-orange-700"}`}>
              {loading ? t("client.register.loading", { defaultValue: t("common.loading") }) : t("client.register.registerBtn")}
            </button>
            <p className="text-xs leading-5 text-slate-500">{t("client.register.terms")}</p>
          </form>

          <div className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
            {t("client.register.haveAccount")}{" "}
            <Link to={`/client/login?redirect=${encodeURIComponent(safeRedirect)}`} className="font-bold text-orange-600 hover:underline">{t("client.register.loginLink")}</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
