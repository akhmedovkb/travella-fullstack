import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiPost } from "../api";
import LanguageSelector from "../components/LanguageSelector";
import { useTranslation } from "react-i18next";

export default function ClientRegister() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await apiPost("/api/clients/register", form, false); // без токена
      nav("/client/login");
    } catch (e2) {
      setErr(e2.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white p-6 rounded-xl shadow">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t("client.register.title")}</h1>
        <div className="scale-90"><LanguageSelector /></div>
      </div>

      {err && (
        <div className="mb-3 bg-orange-500 text-white text-sm px-3 py-2 rounded">{err}</div>
      )}

      <form onSubmit={submit} className="space-y-3">
        <input
          className="w-full border rounded px-3 py-2"
          placeholder={t("client.register.name")}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          type="email"
          className="w-full border rounded px-3 py-2"
          placeholder="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <input
          className="w-full border rounded px-3 py-2"
          placeholder={t("client.register.phone")}
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          required
        />
        <input
          type="password"
          className="w-full border rounded px-3 py-2"
          placeholder={t("client.register.password")}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded transition"
        >
          {loading ? t("common.loading") : t("client.register.registerBtn")}
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
