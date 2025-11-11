// frontend/src/pages/landing/IndiaInside.jsx
import React from "react";
import { useTranslation } from "react-i18next";

function GuruBlock({ onOpenLead }) {
  return (
    <section id="guru" className="mt-12 overflow-hidden rounded-3xl bg-black text-white">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-br from-black via-black/80 to-zinc-900" />
        <img
          src="https://images.unsplash.com/photo-1549880338-65ddcdfd017b?q=80&w=2000&auto=format&fit=crop"
          alt=""
          className="h-full w-full object-cover opacity-30"
        />
        <div className="relative z-10 p-8 sm:p-12 lg:p-16">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs tracking-wider">
            <span>TRAVELLA • INDIA</span>
            <span className="h-1 w-1 rounded-full bg-amber-500" />
            <span>INSIDE</span>
          </div>

          <h2 className="mt-4 text-3xl font-semibold sm:text-4xl">
            Программа <span className="text-amber-400">Guru по Индии</span>
          </h2>
          <p className="mt-3 max-w-2xl text-white/80">
            Пройди 4 главы India Inside — королевская Индия, Путь Тишины, современная Индия и Южная перезагрузка —
            и получи персональный статус <span className="text-amber-400">India Inside: Guru</span> с сертификатом и доступом в закрытый клуб.
          </p>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <ul className="space-y-3 text-sm text-zinc-200">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 rounded-full bg-amber-500" />
                Индивидуальные маршруты и личный куратор
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 rounded-full bg-amber-500" />
                Приватные церемонии и недоступные локации
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 rounded-full bg-amber-500" />
                Сертификат «Guru по Индии» и клуб Travella
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 rounded-full bg-amber-500" />
                Доступно только по заявке
              </li>
            </ul>

            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="rounded-xl bg-white p-4 text-zinc-900 shadow">
                <div className="text-xs uppercase tracking-wider text-zinc-500">Сертификат</div>
                <div className="mt-1 text-lg font-semibold">India Inside: Guru</div>
                <div className="mt-2 text-xs text-zinc-600">
                  Имя владельца • Дата • Идентификатор программы
                </div>
                <div className="mt-4 h-20 rounded-lg bg-gradient-to-r from-amber-200 via-amber-100 to-amber-200" />
                <div className="mt-3 text-right text-[10px] text-zinc-500">Travella • India Inside</div>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={() => onOpenLead?.()}
              className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-medium text-black"
            >
              Запросить участие
            </button>
            <a
              href="#chapters"
              className="rounded-xl border border-white/20 px-5 py-3 text-sm font-medium text-white hover:bg-white/10"
            >
              Посмотреть главы программы
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function IndiaInside({ onOpenLead }) {
  const { t } = useTranslation(["landing"]); // ns: landing

  const chapters = [
    {
      key: "royal",
      title: t("inside.chapters.royal.title", "Королевские главы"),
      desc: t("inside.chapters.royal.desc", "Дворцы Удайпура и Джайпура, закрытые церемонии."),
      days: "8–9 дней",
      from: "от $8 900",
      image:
        "https://images.unsplash.com/photo-1564501049412-61c2a3083791?q=80&w=1600&auto=format&fit=crop",
    },
    {
      key: "silence",
      title: t("inside.chapters.silence.title", "Путь Тишины"),
      desc: t("inside.chapters.silence.desc", "Гималаи, аюрведа, монахи, чайные холмы."),
      days: "7–8 дней",
      from: "от $6 200",
      image:
        "https://images.unsplash.com/photo-1544735716-392fe2489ffa?q=80&w=1600&auto=format&fit=crop",
    },
    {
      key: "modern",
      title: t("inside.chapters.modern.title", "Современная Индия"),
      desc: t("inside.chapters.modern.desc", "Мумбаи, стиль, киностудия, яхта, гала-ужин."),
      days: "7 дней",
      from: "от $7 400",
      image:
        "https://images.unsplash.com/photo-1508009603885-50cf7c579365?q=80&w=1600&auto=format&fit=crop",
    },
    {
      key: "kerala",
      title: t("inside.chapters.kerala.title", "Керала: перезагрузка"),
      desc: t("inside.chapters.kerala.desc", "Бэквотеры, чай, wellness, частный хаусбоат."),
      days: "8–9 дней",
      from: "от $6 900",
      image:
        "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=1600&auto=format&fit=crop",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl bg-black text-white">
        <img
          src="https://images.unsplash.com/photo-1519125263344-35456d2937b4?q=80&w=2000&auto=format&fit=crop"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="relative z-10 p-10 sm:p-16 lg:p-24">
          <div className="mb-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs tracking-wider">
            TRAVELLA • INDIA
          </div>
          <h1 className="text-3xl font-semibold sm:text-5xl">
            {t("inside.title", "India Inside — роскошное путешествие")}
          </h1>
          <p className="mt-4 max-w-2xl text-white/80">
            {t(
              "inside.sub",
              "Частные программы, дворцы махараджей, закрытые ритуалы и тишина Гималаев."
            )}
          </p>
          <div className="mt-8 flex gap-3">
            <button
              className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-black"
              onClick={() => {
                // при желании можно открывать трейлер-модал
                const el = document.getElementById("chapters");
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {t("inside.cta_trailer", "Смотреть трейлер")}
            </button>
            <a
              href="#guru"
              className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-medium"
              onClick={(e) => {
                // плавный скролл к блоку Guru
                e.preventDefault();
                const el = document.getElementById("guru");
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {t("inside.cta_join", "Запросить программу")}
            </a>
          </div>
        </div>
      </section>

      {/* Заголовок раздела */}
      <div id="chapters" className="mt-10">
        <h2 className="text-2xl font-semibold">
          {t("inside.steps_title", "Главы India Inside")}
        </h2>
        <p className="mt-1 text-gray-600">
          {t(
            "inside.steps_sub",
            "Выберите свою главу — мы соберём частный маршрут."
          )}
        </p>
      </div>

      {/* Карточки глав */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {chapters.map((c) => (
          <article
            key={c.key}
            className="overflow-hidden rounded-2xl bg-white shadow"
          >
            <div className="h-40 w-full overflow-hidden">
              <img src={c.image} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="p-4">
              <div className="mb-1 text-xs text-amber-600">India Inside</div>
              <h3 className="text-lg font-semibold">{c.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-gray-600">{c.desc}</p>
              <div className="mt-3 text-sm text-gray-500">
                {c.days} · {c.from}
              </div>
              <button
                className="mt-4 w-full rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white"
                onClick={() => onOpenLead?.()}
              >
                {t("inside.view", "Запросить программу")}
              </button>
            </div>
          </article>
        ))}
      </div>

      {/* Программа GURU */}
      <GuruBlock onOpenLead={onOpenLead} />
    </div>
  );
}
