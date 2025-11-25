import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";
import { Toaster } from "react-hot-toast";
import './ui/theme.css';

/* === mobile 100vh fix === */
function setVh() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty("--vh", `${vh}px`);
}
setVh();
// избегаем дубликатов при HMR
if (!window.__vhListenerAdded) {
  window.__vhListenerAdded = true;
  ["resize", "orientationchange"].forEach((evt) =>
    window.addEventListener(evt, setVh)
  );
  // iOS Safari возвращается из бэкграунда — пересчитать
  window.addEventListener("pageshow", setVh);
}
/* === /mobile 100vh fix === */


ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          className:
            "rounded-2xl shadow-lg ring-1 ring-black/5 bg-white text-gray-800",
          style: { padding: "12px 14px" },
          success: { iconTheme: { primary: "#16a34a", secondary: "#fff" } },
          error: {
            iconTheme: { primary: "#dc2626", secondary: "#fff" },
            duration: 4000,
          },
        }}
      />
    </I18nextProvider>
  </React.StrictMode>
);
