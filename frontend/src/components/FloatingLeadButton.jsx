//frontend/src/components/FloatingLeadButton.jsx

import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import LeadModal from "./LeadModal";

function mapService(pathname = "/") {
  if (pathname.includes("/ayurveda")) return "ayurveda";
  if (pathname.includes("/checkup"))  return "checkup";
  if (pathname.includes("/treatment"))return "treatment";
  if (pathname.includes("/b2b"))      return "b2b";
  return "tour"; // по умолчанию
}

export default function FloatingLeadButton() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const defaults = useMemo(() => ({
    service: mapService(pathname),
    page: pathname || "/",
  }), [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-full shadow-xl bg-[#FF5722] text-white hover:opacity-95 active:scale-[0.98]"
      >
        Получить подбор
      </button>

      <LeadModal
        open={open}
        onClose={() => setOpen(false)}
        defaultService={defaults.service}
        defaultPage={defaults.page}
      />
    </>
  );
}
