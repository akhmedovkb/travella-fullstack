// frontend/src/pages/landing/Clinics.jsx
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export default function Clinics() {
  const { t } = useTranslation();

  const categories = t("landing.clinics.categories", { returnObjects: true });
  const clinics = t("landing.clinics.items", { returnObjects: true });
  const why = t("landing.clinics.why.items", { returnObjects: true });

  return (
    <main className="max-w-7xl mx-auto px-4 py-10">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-3xl bg-white ring-1 ring-black/5 shadow-sm">
        <div className="grid gap-8 md:grid-cols-2">

          <div className="p-6 sm:p-10 md:p-12">
            <span className="inline-flex items-center rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700 ring-1 ring-purple-100">
              {t("landing.clinics.badge")}
            </span>

            <h1 className="mt-4 text-3xl md:text-5xl font-bold leading-tight">
              {t("landing.clinics.h1")}
            </h1>

            <p className="mt-4 text-lg text-gray-700">
              {t("landing.clinics.sub")}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/india/contacts"
                className="rounded-full bg-black px-6 py-3 text-white text-sm font-semibold hover:bg-black/90 transition"
              >
                {t("landing.clinics.cta_primary")}
              </Link>
            </div>
          </div>

          <div className="relative min-h-[280px] md:min-h-[420px]">
            <img
              https://images.unsplash.com/photo-1581094794329-41fe0ebd7d87?q=80
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-black/40 via-black/10 to-transparent" />
          </div>

        </div>
      </section>

      {/* Categories */}
      <section className="mt-14">
        <h2 className="text-2xl md:text-3xl font-semibold">
          {t("landing.clinics.categories_title")}
        </h2>
        <p className="mt-2 text-gray-600">
          {t("landing.clinics.categories_sub")}
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {categories.map((c, idx) => (
            <div
              key={idx}
              className="rounded-2xl bg-white p-5 ring-1 ring-black/5 shadow-sm"
            >
              <div className="text-lg font-semibold">{c.title}</div>
              <div className="mt-1 text-sm text-gray-600">{c.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Clinics list */}
      <section className="mt-14">
        <h2 className="text-2xl md:text-3xl font-semibold">
          {t("landing.clinics.list_title")}
        </h2>
        <p className="mt-2 text-gray-600">
          {t("landing.clinics.list_sub")}
        </p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {clinics.map((c, idx) => (
            <div
              key={idx}
              className="rounded-3xl bg-white ring-1 ring-black/5 shadow-sm overflow-hidden"
            >
              <div className="h-40 relative">
                <img
                  src={c.img}
                  alt={c.name}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
              <div className="p-5">
                <div className="text-lg font-semibold">{c.name}</div>
                <div className="text-sm text-gray-600">{c.city}</div>
                <div className="mt-2 text-sm text-gray-700">{c.specialization}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* WHY */}
      <section className="mt-14 rounded-3xl bg-black text-white p-7 sm:p-10">
        <h2 className="text-2xl md:text-3xl font-semibold">
          {t("landing.clinics.why_title")}
        </h2>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {why.map((w, idx) => (
            <div key={idx} className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
              <div className="font-semibold">{w.title}</div>
              <div className="mt-1 text-sm text-gray-200">{w.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mt-14 mb-6">
        <div className="rounded-3xl bg-purple-50 p-7 sm:p-10 ring-1 ring-purple-100 flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div>
            <h3 className="text-xl md:text-2xl font-semibold">
              {t("landing.clinics.final_title")}
            </h3>
            <p className="mt-1 text-gray-700">{t("landing.clinics.final_sub")}</p>
          </div>
          <Link
            to="/india/contacts"
            className="rounded-full bg-black px-7 py-3 text-white text-sm font-semibold hover:bg-black/90 transition text-center"
          >
            {t("landing.clinics.final_btn")}
          </Link>
        </div>
      </section>
    </main>
  );
}
