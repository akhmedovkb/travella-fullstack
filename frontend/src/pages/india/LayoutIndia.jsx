import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LeadModal from "../../components/LeadModal";

export default function LayoutIndia() {
  const { t } = useTranslation();
  const [openLead, setOpenLead] = useState(false);
  const loc = useLocation();

  // определяем тип сервиса по текущему маршруту
  const service =
    loc.pathname.includes("/ayurveda") ? "ayurveda" :
    loc.pathname.includes("/checkup")  ? "checkup"  :
    loc.pathname.includes("/treatment")? "treatment":
    loc.pathname.includes("/clinics")  ? "treatment":
    loc.pathname.includes("/b2b")      ? "b2b"      :
    loc.pathname.includes("/tours")    ? "tour"     : "consult";

  return (
    <>
      {/* Контент страницы */}
      <Outlet />

      {/* Глобальный CTA для India-раздела (фиксированный внизу справа) */}
      <button
        type="button"
        onClick={() => setOpenLead(true)}
        className="fixed bottom-5 right-5 z-[60] px-5 py-3 rounded-2xl shadow-lg bg-[#FF5722] text-white hover:bg-[#e34c1d] active:scale-95"
      >
        {t("landing.home.cta")}
      </button>

      {/* Одна модалка на все дочерние страницы India */}
      <LeadModal
        open={openLead}
        onClose={() => setOpenLead(false)}
        defaultService={service}
        defaultPage={loc.pathname}
      />
    </>
  );
}
