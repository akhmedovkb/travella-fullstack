// src/components/LanguageSelector.jsx
import React from "react";
import { useTranslation } from "react-i18next";

const LanguageSelector = () => {
  const { i18n } = useTranslation();

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem("lng", lng); // сохраняем выбор языка
  };

  return (
    <div className="mb-4 flex gap-2 justify-center">
      <button
        onClick={() => changeLanguage("ru")}
        className={`px-3 py-1 rounded ${i18n.language === "ru" ? "bg-orange-500 text-white" : "bg-gray-200"}`}
      >
        RU
      </button>
      <button
        onClick={() => changeLanguage("uz")}
        className={`px-3 py-1 rounded ${i18n.language === "uz" ? "bg-orange-500 text-white" : "bg-gray-200"}`}
      >
        UZ
      </button>
      <button
        onClick={() => changeLanguage("en")}
        className={`px-3 py-1 rounded ${i18n.language === "en" ? "bg-orange-500 text-white" : "bg-gray-200"}`}
      >
        EN
      </button>
    </div>
  );
};

export default LanguageSelector;
