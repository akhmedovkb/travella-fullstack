// frontend/src/pages/landing/IndiaCurator.jsx
import React from "react";
import { useTranslation } from "react-i18next";

/**
 * Props:
 *  - photo (string)    обязательный: путь/URL фото куратора
 *  - onLeadOpen        необязательный: колбэк открыть вашу LeadModal
 *  - className         необязательный: доп. классы контейнера
 */
export default function IndiaCurator({ photo, onLeadOpen, className = "" }) {
  const { i18n } = useTranslation();
  const lang = (i18n?.language || "ru").split("-")[0];

  const copy = {
    ru: {
      title: "Ведущий программы India Inside",
      role: "Основатель Travella, куратор India Inside",
      name: "Комил Ахмедов",
      lead:
        "Более 12 лет изучаю Индию: её культуру, современные города, наследие и wellness-традиции.",
      body:
        "India Inside — авторская программа, собранная на основе личных путешествий, знакомств и погружения в культуру. Мы показываем Индию не как туристическое направление, а как живое пространство людей, идей, вкусов и смыслов.",
      bullets: [
        "12+ лет маршрутов по Индии",
        "Джайпур, Удайпур, Дели, Гоа, Керала",
        "Wellness, ремёсла, культурные практики",
        "Локальные эксперты и мастера",
        "Индивидуальное сопровождение",
      ],
      cta: "Задать вопрос куратору",
      note: "Это не тур. Это культурный проект.",
    },
    en: {
      title: "Curator of India Inside",
      role: "Founder of Travella, Curator of India Inside",
      name: "Komil Akhmedov",
      lead:
        "Over 12 years exploring India — its culture, modern cities, heritage and wellness traditions.",
      body:
        "India Inside is a hand-crafted journey built on personal routes, meaningful encounters and a deep love for India. We show India not as a tourist destination but as a living culture of people, ideas and tastes.",
      bullets: [
        "12+ years of routes across India",
        "Jaipur, Udaipur, Delhi, Goa, Kerala",
        "Wellness & cultural programs",
        "Trusted local experts and artisans",
        "Tailored guidance throughout",
      ],
      cta: "Ask the curator",
      note: "Not a tour. A cultural project.",
    },
    uz: {
      title: "India Inside dasturi kuratori",
      role: "Travella asoschisi, India Inside kuratori",
      name: "Komil Akhmedov",
      lead:
        "12 yildan ortiq Hindistonni o‘rganib kelaman — madaniyat, zamonaviy shaharlar, meros va wellness an’analar.",
      body:
        "India Inside — shaxsiy safarlar va chuqur tajribalarga asoslangan mualliflik yo‘li. Biz Hindistonni oddiy turistik yo‘nalish emas, balki odamlar, g‘oyalar va ta’mlar yashaydigan madaniy makon sifatida ochamiz.",
      bullets: [
        "Hindistonda 12+ yillik tajriba",
        "Jaipur, Udaypur, Dehli, Goa, Kerala",
        "Wellness va madaniy dasturlar",
        "Ishonchli mahalliy ustozlar",
        "Shaxsiy ko‘mak va hamrohlik",
      ],
      cta: "Kuratorga savol berish",
      note: "Bu shunchaki tur emas. Bu madaniy loyiha.",
    },
  }[lang] || copy.ru;

  return (
    <section className={`w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8 mt-8 ${className}`}>
      <div className="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-5 gap-6 items-center">
        {/* Фото */}
        <div className="md:col-span-2">
          <div className="aspect-[4/5] w-full overflow-hidden rounded-2xl ring-1 ring-gray-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo}
              alt={`${copy.name} — ${copy.title}`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        </div>

        {/* Текст */}
        <div className="md:col-span-3">
          <p className="text-sm font-medium text-amber-600 tracking-wide">{copy.title}</p>
          <h3 className="mt-1 text-2xl sm:text-3xl font-semibold text-gray-900">
            {copy.name}
          </h3>
          <p className="text-gray-600">{copy.role}</p>

          <p className="mt-4 text-gray-800 leading-relaxed">{copy.lead}</p>
          <p className="mt-2 text-gray-700 leading-relaxed">{copy.body}</p>

          <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 text-gray-700">
            {copy.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 rounded-full bg-amber-500 flex-shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={onLeadOpen}
              className="px-4 py-2 rounded-xl bg-amber-500 text-white font-medium hover:bg-amber-600 active:bg-amber-700 transition"
              type="button"
            >
              {copy.cta}
            </button>
            <span className="text-sm text-gray-500">{copy.note}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
