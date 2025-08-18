// frontend/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "react-hot-toast";
import App from "./App";
import "./index.css";
import "./i18n";

import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";

// 👇 добавь это

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
      {/* единственный контейнер тостов на всём приложении */}
      <ToastContainer position="top-right" autoClose={3000} newestOnTop />
    </I18nextProvider>
      <Toaster
      position="top-right"
      toastOptions={{
        duration: 3000,
        className: "rounded-2xl shadow-lg ring-1 ring-black/5 bg-white text-gray-800",
        style: { padding: "12px 14px" },
        success: { iconTheme: { primary: "#16a34a", secondary: "#fff" } },
        error: { iconTheme: { primary: "#dc2626", secondary: "#fff" }, duration: 4000 },
      }}
    />
  </React.StrictMode>
);
