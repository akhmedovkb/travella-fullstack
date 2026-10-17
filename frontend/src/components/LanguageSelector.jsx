// src/components/LanguageSelector.jsx
import React from "react";
import { useTranslation } from "react-i18next";

const LanguageSelector = () => {
  const { i18n } = useTranslation();
  const activeLanguage = String(i18n.resolvedLanguage || i18n.language || "ru")
    .toLowerCase()
    .split("-")[0];

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem("lng", lng); // сохраняем выбор языка
  };

  return (
    <div className="flex h-9 items-center gap-2" aria-label="Language">
      {["ru", "uz", "en"].map((language) => {
        const isActive = activeLanguage === language;
        return (
          <button
            key={language}
            type="button"
            onClick={() => changeLanguage(language)}
            className={`inline-flex h-8 min-w-10 items-center justify-center rounded-md px-3 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
              isActive
                ? "bg-orange-500 text-white shadow-sm hover:bg-orange-600"
                : "bg-slate-100 text-slate-800 ring-1 ring-inset ring-slate-200 hover:bg-white hover:text-slate-950"
            }`}
            aria-pressed={isActive}
          >
            {language.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
};

export default LanguageSelector;
