// frontend/src/pages/landing/Treatment.jsx
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export default function Treatment() {
  const { t } = useTranslation();

  const benefits = t("landing.treatment.benefits.items", { returnObjects: true });
  const programs = t("landing.treatment.programs.items", { returnObjects: true });
  const steps = t("landing.treatment.steps.items", { returnObjects: true });
  const faq = t("landing.treatment.faq.items", { returnObjects: true });

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">

      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl bg-white ring-1 ring-black/5 shadow-sm">
        <div className="grid gap-8 md:grid-cols-2">

          <div className="p-6 sm:p-10 md:p-12">
            <span className="inline-flex items-center rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 ring-1 ring-green-100">
              {t("landing.treatment.badge")}
            </span>

            <h1 className="mt-4 text-3xl md:text-5xl font-bold leading-tight">
              {t("landing.treatment.h1")}
            </h1>

            <p className="mt-4 text-lg text-gray-700">
              {t("landing.treatment.sub")}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/india/contacts"
                className="rounded-full bg-black px-6 py-3 text-white text-sm font-semibold hover:bg-black/90 transition"
              >
                {t("landing.treatment.cta_primary")}
              </Link>
              <Link
                to="/india/clinics"
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-gray-900 ring-1 ring-black/10 hover:bg-gray-50 transition"
              >
                {t("landing.treatment.cta_secondary")}
              </Link>
            </div>

            <div className="mt-8 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-2xl bg-gray-50 p-3">
                <div className="text-xl font-bold">15+</div>
                <div className="text-xs text-gray-600">{t("landing.treatment.stats.specialties")}</div>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3">
                <div className="text-xl font-bold">40–70%</div>
                <div className="text-xs text-gray-600">{t("landing.treatment.stats.prices")}</div>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3">
                <div className="text-xl font-bold">JCI</div>
                <div className="text-xs text-gray-600">{t("landing.treatment.stats.jci")}</div>
              </div>
            </div>
          </div>

          <div className="relative min-h-[280px] md:min-h-[420px]">
            <img
              src="https://images.unsplash.com/photo-1586773860418-d37222d8fce3?q=80&w=1400&auto=format&fit=crop"
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-black/40 via-black/10 to-transparent" />
          </div>

        </div>
      </section>

      {/* Benefits */}
      <section className="mt-14">
        <h2 className="text-2xl md:text-3xl font-semibold">
          {t("landing.treatment.benefits.title")}
        </h2>
        <p className="mt-2 text-gray-600">
          {t("landing.treatment.benefits.sub")}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Array.isArray(benefits) ? benefits : []).map((b, idx) => (
            <div key={idx} className="rounded-2xl bg-white p-5 ring-1 ring-black/5 shadow-sm">
              <div className="text-lg font-semibold">{b.title}</div>
              <div className="mt-1 text-sm text-gray-600">{b.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Programs */}
      <section className="mt-14">
        <h2 className="text-2xl md:text-3xl font-semibold">
          {t("landing.treatment.programs.title")}
        </h2>
        <p className="mt-2 text-gray-600">
          {t("landing.treatment.programs.sub")}
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {(Array.isArray(programs) ? programs : []).map((p, idx) => (
            <div
              key={idx}
              className="rounded-3xl bg-white p-6 ring-1 ring-black/5 shadow-sm flex flex-col"
            >
              <div className="text-lg font-semibold">{p.title}</div>
              <div className="mt-2 text-sm text-gray-600 flex-1">{p.text}</div>
              <div className="mt-4 inline-flex items-center gap-2 text-xs text-gray-500">
                <span className="rounded-full bg-gray-100 px-2 py-1">{p.time}</span>
                <span className="rounded-full bg-gray-100 px-2 py-1">{p.level}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Steps */}
      <section className="mt-14 rounded-3xl bg-black text-white p-7 sm:p-10">
        <h2 className="text-2xl md:text-3xl font-semibold">
          {t("landing.treatment.steps.title")}
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {(Array.isArray(steps) ? steps : []).map((s, idx) => (
            <div key={idx} className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
              <div className="text-sm text-green-200 font-bold">
                {t("landing.treatment.steps.step", { num: idx + 1 })}
              </div>
              <div className="mt-1 font-semibold">{s.title}</div>
              <div className="mt-1 text-sm text-gray-200">{s.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mt-14">
        <h2 className="text-2xl md:text-3xl font-semibold">{t("landing.treatment.faq.title")}</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {(Array.isArray(faq) ? faq : []).map((f, idx) => (
            <details key={idx} className="group rounded-2xl bg-white p-5 ring-1 ring-black/5 shadow-sm">
              <summary className="cursor-pointer list-none font-semibold flex items-center justify-between">
                <span>{f.q}</span>
                <span className="ml-3 text-gray-400 group-open:rotate-45 transition">+</span>
              </summary>
              <div className="mt-2 text-sm text-gray-600">{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mt-14 mb-6">
        <div className="rounded-3xl bg-green-50 p-7 sm:p-10 ring-1 ring-green-100 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div>
            <h3 className="text-xl md:text-2xl font-semibold">
              {t("landing.treatment.final.title")}
            </h3>
            <p className="mt-1 text-gray-700">{t("landing.treatment.final.sub")}</p>
          </div>
          <Link
            to="/india/contacts"
            className="rounded-full bg-black px-7 py-3 text-white text-sm font-semibold hover:bg-black/90 transition text-center"
          >
            {t("landing.treatment.final.btn")}
          </Link>
        </div>
      </section>

    </main>
  );
}
