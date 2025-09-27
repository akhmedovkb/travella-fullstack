// src/components/LanguageSelector.jsx
import React from "react";
import { useTranslation } from "react-i18next";

const LanguageSelector = () => {
  const { i18n } = useTranslation();
  const lang = (i18n?.language || "").toLowerCase().split("-")[0]; // 'ru' из 'ru-RU'

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem("lng", lng);
  };

  const btnCls = (active) =>
    `inline-flex h-9 items-center justify-center align-middle px-3 rounded-md text-sm leading-none
     ${active ? "bg-orange-500 text-white" : "bg-gray-200 hover:bg-gray-300"}`;

  return (
    <div className="mb-4 flex items-center gap-2 justify-center">
      <button onClick={() => changeLanguage("ru")} className={btnCls(lang === "ru")} aria-pressed={lang === "ru"}>
        RU
      </button>
      <button onClick={() => changeLanguage("uz")} className={btnCls(lang === "uz")} aria-pressed={lang === "uz"}>
        UZ
      </button>
      <button onClick={() => changeLanguage("en")} className={btnCls(lang === "en")} aria-pressed={lang === "en"}>
        EN
      </button>
    </div>
  );
};

export default LanguageSelector;
