import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { apiPost } from "../api";
import LanguageSelector from "../components/LanguageSelector";
import { useTranslation } from "react-i18next";

export default function ClientLogin() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const data = await apiPost("/api/clients/login", form, false); // без токена
      if (!data?.token) throw new Error("No token");
      localStorage.setItem("clientToken", data.token);
      nav("/client/dashboard");
    } catch (e2) {
      setErr(e2.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto bg-white p-6 rounded-xl shadow">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t("client.login.title")}</h1>
        <div className="scale-90"><LanguageSelector /></div>
      </div>

      {err && <div className="mb-3 bg-orange-500 text-white text-sm px-3 py-2 rounded">{err}</div>}

      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          className="w-full border rounded px-3 py-2"
          placeholder="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <input
          type="password"
          className="w-full border rounded px-3 py-2"
          placeholder={t("client.login.password")}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 rounded transition"
        >
          {loading ? t("common.loading") : t("client.login.loginBtn")}
        </button>
      </form>

      <div className="mt-3 text-sm text-gray-600">
        {t("client.login.noAccount")}{" "}
        <Link to="/client/register" className="text-orange-600 font-semibold hover:underline">
          {t("client.login.registerLink")}
        </Link>
      </div>
    </div>
  );
}
