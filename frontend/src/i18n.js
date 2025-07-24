// frontend/src/i18n.js
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import translationRU from './locales/ru.json';
import translationUZ from './locales/uz.json';
import translationEN from './locales/en.json';

const resources = {
  ru: { translation: translationRU },
  uz: { translation: translationUZ },
  en: { translation: translationEN },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'ru', // default language
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
});

export default i18n;
