// frontend/src/pages/ClientRegister.jsx
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import LanguageSelector from "../components/LanguageSelector";
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

  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(""); // оставил, но тосты уже покрывают ошибки

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

      nav("/client/login");
    } catch (e2) {
      // на всякий — продублируем в баннер локализованное сообщение
      const msg = parseErrorMessage(e2, t);
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white p-6 rounded-xl shadow">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t("client.register.title")}</h1>
      </div>

      {err && (
        <div className="mb-3 bg-orange-500 text-white text-sm px-3 py-2 rounded">
          {err}
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        <input
          className="w-full border rounded px-3 py-2"
          placeholder={t("client.register.name")}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
          title={requiredTitle}
          lang={i18n.language}
        />

        <input
          type="email"
          className="w-full border rounded px-3 py-2"
          placeholder="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
          title={requiredTitle}
          lang={i18n.language}
        />

        <input
          className="w-full border rounded px-3 py-2"
          placeholder={t("client.register.phone")}
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          required
          title={t("register.phone_hint")}
          lang={i18n.language}
        />
        <p className="text-xs text-gray-500 -mt-2">
          {t("register.phone_hint")}
        </p>

        <input
          type="password"
          className="w-full border rounded px-3 py-2"
          placeholder={t("client.register.password")}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
          title={requiredTitle}
          lang={i18n.language}
        />

        <button
          type="submit"
          disabled={loading}
          className={`w-full text-white font-semibold py-2 rounded transition ${
            loading ? "bg-orange-400 cursor-not-allowed" : "bg-orange-500 hover:bg-orange-600"
          }`}
        >
          {loading
            ? t("client.register.loading", { defaultValue: t("common.loading") })
            : t("client.register.registerBtn")}
        </button>
      </form>

      <div className="mt-3 text-sm text-gray-600">
        {t("client.register.haveAccount")}{" "}
        <Link to="/client/login" className="text-orange-600 font-semibold hover:underline">
          {t("client.register.loginLink")}
        </Link>
      </div>
    </div>
  );
}
