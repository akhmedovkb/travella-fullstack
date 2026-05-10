// frontend/src/components/ProviderTelegramLoginButton.jsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import axios from "axios";

function getApiBase() {
  return (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
}

function getBotUsername() {
  return (
    import.meta.env.VITE_TG_BOT_USERNAME ||
    import.meta.env.VITE_TELEGRAM_BOT_USERNAME ||
    import.meta.env.VITE_TELEGRAM_CLIENT_BOT_USERNAME ||
    ""
  ).replace(/^@/, "");
}

export default function ProviderTelegramLoginButton({ className = "", compact = false }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hostRef = useRef(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const botUsername = getBotUsername();
  const botLink = botUsername ? `https://t.me/${botUsername}?start=provider` : "";

  useEffect(() => {
    if (!hostRef.current || !botUsername) return;

    const callbackName = `__travellaProviderTelegramLogin_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;

    window[callbackName] = async (telegramUser) => {
      try {
        setLoading(true);
        setError("");
        const { data } = await axios.post(
          `${getApiBase()}/api/providers/telegram-login`,
          telegramUser,
          { headers: { "Content-Type": "application/json" } }
        );

        if (!data?.success || !data?.token) {
          throw new Error(data?.message || "Telegram login failed");
        }

        localStorage.setItem("token", data.token);
        localStorage.setItem("providerToken", data.token);
        localStorage.setItem("provider", JSON.stringify(data.provider || {}));
        if (data.provider?.id) localStorage.setItem("provider_id", String(data.provider.id));

        navigate("/dashboard", { replace: true });
      } catch (e) {
        const code = e?.response?.data?.code;
        const needsBotLink = e?.response?.data?.needs_bot_link;
        if (needsBotLink || code === "PROVIDER_TELEGRAM_NOT_LINKED") {
          setError(
            t("login.telegram_provider_not_linked", {
              defaultValue:
                "Telegram is not linked to an approved provider profile yet. Open the bot and share the phone number used for moderation.",
            })
          );
          return;
        }
        setError(
          e?.response?.data?.message ||
            t("login.telegram_error", { defaultValue: "Telegram login failed" })
        );
      } finally {
        setLoading(false);
      }
    };

    hostRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", compact ? "medium" : "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", `${callbackName}(user)`);
    hostRef.current.appendChild(script);

    return () => {
      try {
        delete window[callbackName];
      } catch (_) {}
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, [botUsername, compact, navigate, t]);

  if (!botUsername) {
    return (
      <div className={`rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 ${className}`}>
        {t("login.telegram_bot_not_configured", {
          defaultValue: "Telegram bot username is not configured.",
        })}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex flex-col items-center gap-2">
        <div ref={hostRef} className="min-h-[42px]" />
        {loading ? (
          <div className="text-xs font-semibold text-slate-500">
            {t("login.telegram_loading", { defaultValue: "Logging in via Telegram…" })}
          </div>
        ) : null}
        {error ? (
          <div className="w-full rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold leading-5 text-orange-800">
            <div>{error}</div>
            {botLink ? (
              <a className="mt-1 inline-block font-black underline" href={botLink} target="_blank" rel="noreferrer">
                {t("login.telegram_open_bot", { defaultValue: "Open Telegram bot" })}
              </a>
            ) : null}
          </div>
        ) : (
          <div className="text-center text-xs font-medium leading-5 text-slate-500">
            {t("login.telegram_provider_hint", {
              defaultValue:
                "For approved providers already linked in the bot. New providers should open the bot and pass moderation first.",
            })}
          </div>
        )}
      </div>
    </div>
  );
}
