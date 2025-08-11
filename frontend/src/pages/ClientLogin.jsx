import { useState } from "react";
import { useTranslation } from "react-i18next";
import { apiPost } from "../api";
import LanguageSelector from "../components/LanguageSelector";

export default function ClientLogin() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const { token, client } = await apiPost("/api/clients/login", { email, password }, false);
      localStorage.setItem("clientToken", token);
      localStorage.setItem("client", JSON.stringify(client));
      window.location.href = "/client/dashboard";
    } catch (error) {
      setErr(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-6 rounded-xl shadow">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">{t("client.login") || "Client Login"}</h1>
          <LanguageSelector />
        </div>

        {err && <div className="mb-3 text-red-600 text-sm">{err}</div>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            className="w-full border px-3 py-2 rounded"
            placeholder={t("email") || "Email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
          />
          <input
            className="w-full border px-3 py-2 rounded"
            placeholder={t("password") || "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
          />

          <button
            className="w-full bg-orange-500 text-white py-2 rounded font-bold disabled:opacity-60"
            disabled={loading}
            type="submit"
          >
            {loading ? (t("loading") || "Loading...") : (t("login") || "Login")}
          </button>
        </form>

        <div className="mt-4 text-sm text-center">
          {t("no_account") || "No account?"}{" "}
          <a className="text-orange-600 underline" href="/client/register">
            {t("register") || "Register"}
          </a>
        </div>
      </div>
    </div>
  );
}
