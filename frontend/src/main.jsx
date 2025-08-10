// frontend/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./i18n";

import { I18nextProvider } from "react-i18next";
import i18n from "./i18n";

// 👇 добавь это
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
      {/* единственный контейнер тостов на всём приложении */}
      <ToastContainer position="top-right" autoClose={3000} newestOnTop />
    </I18nextProvider>
  </React.StrictMode>
);
