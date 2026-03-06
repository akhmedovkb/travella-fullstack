// frontend/src/components/TelegramLoginButton.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../api";

export default function TelegramLoginButton({
  role = "client",
  redirectTo,
  className = "",
}) {
  const nav = useNavigate();
  const hostRef = useRef(null);
  const [err, setErr] = useState("");

  const botUsername =
    (import.meta.env.VITE_TG_BOT_USERNAME ||
      import.meta.env.VITE_TELEGRAM_BOT_USERNAME ||
      "").replace(/^@/, "");

  const callbackName = useMemo(
    () => `TravellaTelegramLogin_${role}_${Math.random().toString(36).slice(2)}`,
    [role]
  );

  useEffect(() => {
    if (!botUsername || !hostRef.current) return;

    window[callbackName] = async function onTelegramAuth(user) {
      try {
        setErr("");

        const data = await apiPost(
          "/api/auth/telegram-web-login",
          { ...user, role },
          false
        );

        if (!data?.token) {
          throw new Error("No token returned");
        }

        if (role === "provider") {
          localStorage.setItem("token", data.token);
          localStorage.setItem("providerToken", data.token);

          const providerId = data?.provider?.id;
          if (providerId) {
            localStorage.setItem("provider_id", String(providerId));
            localStorage.setItem("id", String(providerId));
          }

          nav(redirectTo || "/dashboard", { replace: true });
          return;
        }

        localStorage.setItem("clientToken", data.token);
        nav(redirectTo || "/client/dashboard", { replace: true });
      } catch (e) {
        console.error("Telegram login error:", e);
        setErr(
          e?.message ||
            "Не удалось войти через Telegram. Проверь модерацию и привязку аккаунта."
        );
      }
    };

    hostRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "10");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", `${callbackName}(user)`);

    hostRef.current.appendChild(script);

    return () => {
      try {
        delete window[callbackName];
      } catch {}
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, [botUsername, callbackName, nav, redirectTo, role]);

  if (!botUsername) return null;

  return (
    <div className={className}>
      <div ref={hostRef} />
      {err ? (
        <div className="mt-2 text-sm text-red-600">{err}</div>
      ) : null}
    </div>
  );
}
