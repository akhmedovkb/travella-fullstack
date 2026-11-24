// frontend/src/i18n.js
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import ru from "./locales/ru.json";
import uz from "./locales/uz.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next) // 💥 обязательно
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
      uz: { translation: uz },
    },
    fallbackLng: "ru",
    supportedLngs: ["ru", "uz", "en"],
    load: "languageOnly",
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: "i18nextLng",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

const updateDocumentLanguage = (language) => {
  if (typeof document !== 'undefined') document.documentElement.lang = String(i18n.resolvedLanguage || language || 'ru').split('-')[0];
};
i18n.on('languageChanged', updateDocumentLanguage);
updateDocumentLanguage(i18n.language);

export default i18n;
