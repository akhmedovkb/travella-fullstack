// frontend/src/pages/DashboardServices.jsx
import ProviderServicesCard from "../components/ProviderServicesCard";
import { useEffect, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";

export default function DashboardServices() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState(null);
  const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL });

  useEffect(() => {
    api.interceptors.request.use(cfg => {
      const tok = localStorage.getItem("token");
      if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
      return cfg;
    });
    api.get("/api/providers/profile").then(r => setProfile(r.data || {}));
  }, []);

  if (!profile?.id) return null;

  return (
    <div className="bg-white rounded-xl shadow-md p-4 md:p-6">
      <h2 className="text-2xl font-bold mb-4">{t("services")}</h2>

      {/* ваш прайс-лист для TourBuilder */}
      {(profile.type === "guide" || profile.type === "transport" || profile.type === "agent") && (
        <div className="mb-6">
          <ProviderServicesCard
            providerId={profile.id}
            providerType={profile.type}
            currencyDefault={profile.currency || "USD"}
          />
        </div>
      )}

      {/* если нужно — сюда же перенесите ваш большой редактор услуг из Dashboard.jsx */}
      {/* <BigServicesEditor profile={profile} /> */}
    </div>
  );
}
