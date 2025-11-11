// frontend/src/components/FloatingLeadButton.jsx

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import LeadModal from "./LeadModal";

function mapService(pathname = "/") {
  if (pathname.includes("/ayurveda")) return "ayurveda";
  if (pathname.includes("/checkup")) return "checkup";
  if (pathname.includes("/treatment")) return "treatment";
  if (pathname.includes("/b2b")) return "b2b";
  return "tour"; // по умолчанию
}

export default function FloatingLeadButton() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const [leadSent, setLeadSent] = useState(false);

  // слушаем кастомное событие "travella:lead-submitted"
  useEffect(() => {
    let timer;
    const onSubmit = () => {
      setLeadSent(true);
      timer = setTimeout(() => setLeadSent(false), 6000);
    };

    window.addEventListener("travella:lead-submitted", onSubmit);
    return () => {
      window.removeEventListener("travella:lead-submitted", onSubmit);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const defaults = useMemo(
    () => ({
      service: mapService(pathname),
      page: pathname || "/",
    }),
    [pathname]
  );

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50">
        {/* Бейдж подтверждения */}
        {leadSent && (
          <div
            className="absolute -top-3 right-0 translate-y-[-100%] mb-2 px-3 py-1 rounded-full bg-emerald-600 text-white text-xs shadow-xl whitespace-nowrap animate-[pop_.2s_ease-out]"
            style={{ fontWeight: 500 }}
          >
            ✓ Заявка отправлена
          </div>
        )}

        {/* Плавающая кнопка */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-5 py-3 rounded-full shadow-xl bg-[#FF5722] text-white hover:opacity-95 active:scale-[0.97] transition"
        >
          Получить подбор
        </button>
      </div>

      <LeadModal
        open={open}
        onClose={() => setOpen(false)}
        defaultService={defaults.service}
        defaultPage={defaults.page}
      />
    </>
  );
}
