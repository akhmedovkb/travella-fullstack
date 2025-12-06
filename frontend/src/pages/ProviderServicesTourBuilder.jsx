// frontend/src/pages/ProviderServicesTourBuilder.jsx
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet } from "../api";

// Прайс-лист провайдера для Tour Builder
// (тот же компонент, который ты уже используешь в Dashboard.jsx)
import ProviderServicesCard from "../components/ProviderServicesCard";

export default function ProviderServicesTourBuilder() {
  const { t } = useTranslation();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // грузим профиль провайдера (как в Dashboard / Header)
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        setLoading(true);
        const p = await apiGet("/api/providers/profile", "provider");
        if (!alive) return;
        setProfile(p || null);
        setError(null);
      } catch (e) {
        if (!alive) return;
        console.error("ProviderServicesTourBuilder: profile error", e);
        setError(t("errors.profile_load_failed", {
          defaultValue: "Не удалось загрузить профиль провайдера.",
        }));
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [t]);

  if (loading) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="bg-white rounded-xl shadow p-6">
          <p className="text-sm text-gray-600">
            {t("loading", { defaultValue: "Загрузка..." })}
          </p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="bg-white rounded-xl shadow p-6 border border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="bg-white rounded-xl shadow p-6">
          <p className="text-sm text-gray-600">
            {t("errors.profile_not_found", {
              defaultValue: "Профиль провайдера не найден.",
            })}
          </p>
        </div>
      </main>
    );
  }

  const allowedTypes = ["guide", "transport", "agent"];
  const isAllowed = allowedTypes.includes(profile.type);

  return (
    <main className="flex flex-col gap-4 md:gap-6 p-4 md:p-6 bg-gray-50 min-h-[calc(var(--vh,1vh)*100)] pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-6xl mx-auto bg-white p-6 rounded-xl shadow-md">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl md:text-3xl font-bold">
            {t("services_tourbuilder_title", {
              defaultValue: "Услуги для Tour Builder",
            })}
          </h1>
          {profile?.name && (
            <div className="text-sm text-gray-500">
              {profile.name}
              {profile.type && (
                <span className="ml-1 text-gray-400">
                  ({profile.type})
                </span>
              )}
            </div>
          )}
        </div>

        {!isAllowed ? (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
            {t("services_tourbuilder_not_allowed", {
              defaultValue:
                "Редактирование прайс-листа Tour Builder доступно только для гидов, транспорта и турагентов.",
            })}
          </div>
        ) : (
          <div className="mb-2">
            <ProviderServicesCard
              providerId={profile.id}
              providerType={profile.type}
              currencyDefault={profile.currency || "USD"}
            />
          </div>
        )}
      </div>
    </main>
  );
}
