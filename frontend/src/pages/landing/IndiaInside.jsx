// frontend/src/pages/landing/IndiaInside.jsx
import React from "react";
import { useTranslation } from "react-i18next";
import IndiaCurator from "./IndiaCurator";

function GuruBlock({ onOpenLead }) {
  const { t } = useTranslation();
  return (
    <section
      id="guru"
      className="mt-10 overflow-hidden rounded-3xl bg-black text-white"
    >
      <div className="relative min-h-[480px] sm:min-h-[430px] lg:min-h-[480px]">
        {/* фон + градиент */}
        <img
          src="/indiainside_guru.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/20 to-black/10" />

        {/* Контент */}
        <div className="relative z-10 flex h-full items-start p-6 sm:p-10 lg:p-12">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs tracking-wider">
              <span>{t("landing.inside.badge")}</span>
              <span className="h-1 w-1 rounded-full bg-amber-500" />
              <span>INSIDE</span>
            </div>

            <h2 className="mt-4 text-3xl font-semibold sm:text-4xl">
              {t("landing.inside.guru.title")}
            </h2>
            <p className="mt-3 max-w-2xl text-white/80">
              {t("landing.inside.guru.lead")}
            </p>

            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <ul className="space-y-3 text-sm text-zinc-200">
                <li>
                  <span className="dot" />
                  {t("landing.inside.guru.bullets.one")}
                </li>
                <li>
                  <span className="dot" />
                  {t("landing.inside.guru.bullets.two")}
                </li>
                <li>
                  <span className="dot" />
                  {t("landing.inside.guru.bullets.three")}
                </li>
                <li>
                  <span className="dot" />
                  {t("landing.inside.guru.bullets.four")}
                </li>
              </ul>

              {/* Сертификат */}
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4 flex justify-center">
                <div className="relative w-[340px] min-h-[230px] rounded-2xl bg-white/95 p-4 text-zinc-900 shadow-lg shadow-amber-500/10 border border-amber-100 overflow-hidden">
                  {/* Орнамент по краю */}
                  <div className="pointer-events-none absolute inset-0 rounded-2xl border border-amber-100/70" />
                  <div className="pointer-events-none absolute inset-3 rounded-2xl border border-amber-50/60" />

                  {/* Заголовок-лейбл */}
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
                    {t("landing.inside.guru.certificate_label")}
                  </div>

                  {/* Логотип LL вместо текста India Inside: Guru */}
                  <div className="mt-2 mb-1 flex justify-start">
                    <div className="inline-flex items-center justify-center rounded-full bg-amber-50/90 px-3 py-2 shadow-[0_0_16px_rgba(248,197,120,0.85)]">
                      <img
                        src="/ll_logo.png"
                        alt="LL logo"
                        className="h-7 w-auto"
                      />
                    </div>
                  </div>

                  {/* Декоративная линия-узор */}
                  <div className="mt-3 flex items-center text-[9px] tracking-[0.3em] text-amber-700/70 uppercase">
                    <span className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-200 to-transparent" />
                    <span className="px-2">India • Inside • Guru</span>
                    <span className="h-px flex-1 bg-gradient-to-l from-transparent via-amber-200 to-transparent" />
                  </div>

                  {/* Золотая плашка */}
                  <div className="mt-4 h-20 w-full rounded-xl bg-gradient-to-r from-amber-200 via-amber-100 to-amber-200 flex flex-col justify-center px-4 text-[11px] font-medium text-amber-900/90 shadow-inner">
                    <span>Komil Akhmedov</span>
                    <span className="mt-1 text-[10px] opacity-85">
                      12.11.2025 • ID: IN-GURU-78211
                    </span>
                  </div>

                  {/* Штамп + подпись */}
                  <div className="mt-5 flex items-center justify-between text-[9px] text-zinc-500">
                    <img
                      src="/ll_logo.png" // маленький «золотой» знак как печать
                      alt="LL stamp"
                      className="h-7 w-7 rounded-full object-cover shadow-[0_0_6px_rgba(0,0,0,0.35)] border border-amber-200"
                    />
                    <span className="tracking-wide text-zinc-500">
                      India Inside
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => window.dispatchEvent(new Event("openStepsApply"))}
                className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-medium text-black"
              >
                {t("landing.inside.guru.cta_apply")}
              </button>
              <a
                href="#chapters"
                className="rounded-xl border border-white/20 px-5 py-3 text-sm font-medium text-white hover:bg-white/10"
              >
                {t("landing.inside.guru.cta_chapters")}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// -------- модалки (без изменений) --------
// (оставляю как есть из твоего файла)

function InsideProgramModal() {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const handler = () => setOpen(true);
    document.addEventListener("openInsideModal", handler);
    return () => document.removeEventListener("openInsideModal", handler);
  }, []);

  if (!open) return null;

  const days = [
    t("landing.inside.modal.d1"),
    t("landing.inside.modal.d2"),
    t("landing.inside.modal.d3"),
    t("landing.inside.modal.d4"),
    t("landing.inside.modal.d5"),
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[2000] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl p-6 max-w-lg w-full">
        <h3 className="text-xl font-semibold mb-4">
          {t("landing.inside.modal.title")}
        </h3>
        <ul className="space-y-3 text-sm text-gray-700">
          {days.map((d, i) => (
            <li key={i}>• {d}</li>
          ))}
        </ul>
        <button
          onClick={() => setOpen(false)}
          className="mt-6 w-full rounded-xl bg-black text-white py-3 text-sm font-medium"
        >
          {t("landing.inside.modal.close")}
        </button>
      </div>
    </div>
  );
}

function ChapterProgramModal({ open, chapter, onClose, onOpenLead }) {
  if (!open || !chapter) return null;
  const days = Array.isArray(chapter.program) ? chapter.program : [];

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-amber-600">
              India Inside
            </div>
            <h3 className="mt-1 text-xl font-semibold">{chapter.title}</h3>
            <div className="mt-1 text-sm text-gray-500">
              {chapter.desc} • {chapter.days} • {chapter.from}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
          >
            ✕
          </button>
        </div>

        <ol className="space-y-3 text-sm text-gray-800">
          {days.length === 0 ? (
            <li>Программа обновляется…</li>
          ) : (
            days.map((d, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-1 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-semibold text-white">
                  {i + 1}
                </span>
                <span>{d}</span>
              </li>
            ))
          )}
        </ol>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            onClick={onClose}
            className="w-full rounded-xl border border-gray-200 px-5 py-3 text-sm hover:bg-gray-50 sm:w-auto"
          >
            Закрыть
          </button>
          <button
            onClick={() => {
              onOpenLead?.({
                chapterKey: chapter.key,
                chapterTitle: chapter.title,
              });
              onClose();
            }}
            className="w-full rounded-xl bg-amber-500 px-5 py-3 text-sm font-medium text-white sm:w-auto"
          >
            Запросить программу
          </button>
        </div>
      </div>
    </div>
  );
}

function StepsApplyModal({ onOpenLead }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("openStepsApply", handler);
    return () => window.removeEventListener("openStepsApply", handler);
  }, []);

  if (!open) return null;

  const steps = [
    { k: "apply", n: 1 },
    { k: "call", n: 2 },
    { k: "chapter", n: 3 },
    { k: "certificate", n: 4 },
  ];

  return (
    <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-6">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6">
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-xl font-semibold">
            {t("landing.inside.steps_title", "Как стать участником")}
          </h3>
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
          >
            ✕
          </button>
        </div>

        <ol className="grid gap-4 sm:grid-cols-2">
          {steps.map((s) => (
            <li
              key={s.k}
              className="rounded-2xl border border-gray-200 bg-white p-4"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black text-white text-sm font-semibold">
                  {s.n}
                </span>
                <h4 className="text-sm font-semibold">
                  {t(`landing.inside.steps.${s.k}.title`, {
                    defaultValue:
                      s.k === "apply"
                        ? "Оставьте заявку"
                        : s.k === "call"
                        ? "Созвон с куратором"
                        : s.k === "chapter"
                        ? "Поездка — выбранная глава"
                        : "Сертификат и статус Guru",
                  })}
                </h4>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                {t(`landing.inside.steps.${s.k}.desc`, {
                  defaultValue:
                    s.k === "apply"
                      ? "Укажите контакты и желаемые даты. Свяжемся в WhatsApp/Telegram."
                      : s.k === "call"
                      ? "Поймём цели и подберём главу/маршрут под вас."
                      : s.k === "chapter"
                      ? "Индивидуально или в малой группе, поддержка 24/7."
                      : "После 4 глав — цифровой сертификат и клуб Travella.",
                })}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            onClick={() => setOpen(false)}
            className="w-full rounded-xl border border-gray-200 px-5 py-3 text-sm hover:bg-gray-50 sm:w-auto"
          >
            {t("landing.inside.modal.close", "Закрыть")}
          </button>
          <button
            onClick={() => {
              onOpenLead?.();
              setOpen(false);
            }}
            className="w-full rounded-xl bg-black px-5 py-3 text-sm font-medium text-white sm:w-auto"
          >
            {t("landing.inside.guru.cta_apply", "Перейти к заявке")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IndiaInside({ onOpenLead }) {
  const { t } = useTranslation();
  const [programOpen, setProgramOpen] = React.useState(false);
  const [chapterForProgram, setChapterForProgram] = React.useState(null);

  const openProgram = (c) => {
    setChapterForProgram(c);
    setProgramOpen(true);
  };

  // --- главы: ставим локальные картинки ---
  const chapters = [
    {
      key: "royal",
      title: t(
        "landing.inside.chapters.royal.title",
        "Золотой Треугольник"
      ),
      desc: t(
        "landing.inside.chapters.royal.desc",
        "Дели — Агра — Джайпур"
      ),
      days: t("landing.inside.chapters.royal.days", "7–8 дней"),
      from: t("landing.inside.chapters.royal.from", "от $699"),
      image: "/goldtri.jpg",
      program: [
        t(
          "landing.inside.program.royal.d1",
          "Дели: прилёт, трансфер, вечерний брифинг"
        ),
        t(
          "landing.inside.program.royal.d2",
          "Агра: Тадж-Махал на рассвете, форт Агры"
        ),
        t(
          "landing.inside.program.royal.d3",
          "Джайпур: Амбер-форт, Дворец ветров"
        ),
        t(
          "landing.inside.program.royal.d4",
          "Джайпур: городской тур, ремёсла, шопинг"
        ),
        t(
          "landing.inside.program.royal.d5",
          "Дели: современная Индия — арт/мода/гастро"
        ),
        t(
          "landing.inside.program.royal.d6",
          "Свободный день / дополнительные опции"
        ),
        t("landing.inside.program.royal.d7", "Вылет"),
      ],
    },
    {
      key: "silence",
      title: t(
        "landing.inside.chapters.silence.title",
        "Приключения в Раджастане"
      ),
      desc: t(
        "landing.inside.chapters.silence.desc",
        "Удайпур — Джодпур — Джайсалмер"
      ),
      days: t("landing.inside.chapters.silence.days", "8–9 дней"),
      from: t("landing.inside.chapters.silence.from", "от $890"),
      image: "/indiainside_2.jpg",
      program: [
        t(
          "landing.inside.program.silence.d1",
          "Удайпур: прилёт, озеро Пичола, City Palace"
        ),
        t(
          "landing.inside.program.silence.d2",
          "Удайпур: храмы Джагдиш/Эклингджи, ремёсла, вечерний круиз"
        ),
        t(
          "landing.inside.program.silence.d3",
          "Переезд в Джодпур, прогулка по «синему» старому городу"
        ),
        t(
          "landing.inside.program.silence.d4",
          "Джодпур: форт Мехрангарх, башни, закат на крыше"
        ),
        t(
          "landing.inside.program.silence.d5",
          "Переезд в Джайсалмер, Золотой форт, хавели"
        ),
        t(
          "landing.inside.program.silence.d6",
          "Пустыня Тар: сафари на дюнах, ужин у костра"
        ),
        t(
          "landing.inside.program.silence.d7",
          "Резерв/отдых или мастер-класс"
        ),
        t("landing.inside.program.silence.d8", "Вылет"),
      ],
    },
    {
      key: "modern",
      title: t(
        "landing.inside.chapters.modern.title",
        "Мумбаи + Гоа — лучшие воспоминания"
      ),
      desc: t(
        "landing.inside.chapters.modern.desc",
        "Город & океан"
      ),
      days: t("landing.inside.chapters.modern.days", "7 дней"),
      from: t("landing.inside.chapters.modern.from", "от $490"),
      image: "/indiainside_3.jpg",
      program: [
        t(
          "landing.inside.program.modern.d1",
          "Мумбаи: полудневной тур, вечер на набережной"
        ),
        t(
          "landing.inside.program.modern.d2",
          "Студии Болливуда/арт-кварталы"
        ),
        t(
          "landing.inside.program.modern.d3",
          "Перелёт в Гоа, океан"
        ),
        t(
          "landing.inside.program.modern.d4",
          "Пляжи, старый Гоа, португальское наследие"
        ),
        t(
          "landing.inside.program.modern.d5",
          "Яхта/закат, гастрономический вечер"
        ),
        t(
          "landing.inside.program.modern.d6",
          "Свободный день / wellness"
        ),
        t("landing.inside.program.modern.d7", "Вылет"),
      ],
    },
    {
      key: "kerala",
      title: t(
        "landing.inside.chapters.kerala.title",
        "Керала: Рай на Земле"
      ),
      desc: t(
        "landing.inside.chapters.kerala.desc",
        "Аюрведа, чайные холмы, хаусбоат"
      ),
      days: t("landing.inside.chapters.kerala.days", "8–9 дней"),
      from: t("landing.inside.chapters.kerala.from", "от $790"),
      image: "/kerala_01.jpg",
      program: [
        t(
          "landing.inside.program.kerala.d1",
          "Кочи: город, китайские сети, колониальная часть"
        ),
        t(
          "landing.inside.program.kerala.d2",
          "Муннар: чайные плантации, viewpoints"
        ),
        t(
          "landing.inside.program.kerala.d3",
          "Муннар: треккинг / фотодень"
        ),
        t(
          "landing.inside.program.kerala.d4",
          "Аллеппи: заселение на хаусбоат"
        ),
        t(
          "landing.inside.program.kerala.d5",
          "Backwaters, деревни, локальная кухня"
        ),
        t(
          "landing.inside.program.kerala.d6",
          "Аюрведический центр, индивидуальная программа"
        ),
        t(
          "landing.inside.program.kerala.d7",
          "Свободный день / море"
        ),
        t("landing.inside.program.kerala.d8", "Вылет"),
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-black text-white">
        <img
          src="/indiainside_1.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-40"
        />
        <div className="relative z-10 p-10 sm:p-16 lg:p-24">
          <div className="mb-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs tracking-wider">
            {t("landing.inside.badge")}
          </div>
          <h1 className="text-3xl font-semibold sm:text-5xl">
            {t("landing.inside.title")}
          </h1>
          <p className="mt-4 max-w-2xl text-white/80">
            {t("landing.inside.sub")}
          </p>

          <div className="mt-8 flex gap-3">
            <button
              className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-black"
              onClick={() =>
                document
                  .getElementById("chapters")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              {t("landing.inside.cta_trailer")}
            </button>
            <a
              href="#guru"
              className="rounded-xl bg-amber-500 px-5 py-3 text-sm font-medium"
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById("guru")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              {t("landing.inside.cta_join")}
            </a>
          </div>
        </div>
      </section>

      {/* Программа Guru */}
      <GuruBlock onOpenLead={onOpenLead} />

      {/* Главы */}
      <div id="chapters" className="mt-10">
        <h2 className="text-2xl font-semibold">
          {t("landing.inside.chapters_title", "Главы India Inside")}
        </h2>
        <p className="mt-1 text-gray-600">
          {t("landing.inside.steps_sub")}
        </p>
      </div>

      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {chapters.map((c) => (
          <article
            key={c.key}
            className="overflow-hidden rounded-2xl bg-white shadow flex flex-col"
          >
            <div className="h-40 w-full overflow-hidden">
              <img
                src={c.image}
                alt={c.title}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="p-4 flex flex-col grow">
              <div className="mb-1 text-xs text-amber-600">India Inside</div>
              <h3 className="text-lg font-semibold">{c.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-gray-600">
                {c.desc}
              </p>
              <div className="mt-3 text-sm text-gray-500">
                {c.days} · {c.from}
              </div>
              <button
                className="mt-auto w-full rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white"
                onClick={() => openProgram(c)}
              >
                {t("landing.inside.view")}
              </button>
            </div>
          </article>
        ))}
      </div>

      {/* остальное — опыт, куратор, модалки */}
      {/* ... ниже твой существующий код без изменений ... */}

      <section id="experience" className="mt-24">
        {/* как в твоём исходнике */}
      </section>

      <IndiaCurator photo="/komil.jpg" onOpenLead={onOpenLead} />

      <InsideProgramModal />
      <ChapterProgramModal
        open={programOpen}
        chapter={chapterForProgram}
        onClose={() => setProgramOpen(false)}
        onOpenLead={onOpenLead}
      />
      <StepsApplyModal onOpenLead={onOpenLead} />
    </div>
  );
}
