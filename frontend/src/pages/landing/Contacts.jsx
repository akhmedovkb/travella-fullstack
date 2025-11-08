//frontend/src/pages/landing/Contacts.jsx

import { useTranslation } from "react-i18next";
import { useState } from "react";
import LeadModal from "../../components/LeadModal";

export default function Contacts() {
  const { t } = useTranslation();
  const [openLead, setOpenLead] = useState(false);
  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-5xl font-bold">{t("landing.contacts.h1")}</h1>
      <div className="mt-4 space-y-2">
        <div><b>{t("landing.contacts.phone")}:</b> +998 XX XXX XX XX</div>
        <div><b>WhatsApp:</b> <a className="text-[#FF5722]" href="https://wa.me/XXXXXXXXXXX">wa.me/XXXXXXXXXXX</a></div>
        <div><b>Telegram:</b> <a className="text-[#FF5722]" href="https://t.me/XXXXXXXX">@XXXXXXXX</a></div>
        <div><b>{t("landing.contacts.address")}:</b> Tashkent, ...</div>
      </div>
      <div className="mt-6">
        <button className="btn" onClick={()=>setOpenLead(true)}>
          {t("landing.home.cta")}
        </button>
      </div>
      <LeadModal
        open={openLead}
        onClose={()=>setOpenLead(false)}
        defaultService="consult"
        defaultPage="/contacts"
      />
    </main>
  );
}
