// src/pages/ProviderFavorites.jsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiPost } from "../api";
import { apiProviderFavorites, apiToggleProviderFavorite } from "../api/providerFavorites";
import ServiceCard from "../components/ServiceCard";
import QuickRequestModal from "../components/QuickRequestModal";
import { tSuccess, tInfo, tError } from "../shared/toast";

// роль здесь всегда провайдер
const __viewerRole = "provider";


/* ========== helpers ========== */
const firstNonEmpty = (...vals) => {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
};

/* ===================== страница ===================== */
export default function ProviderFavorites() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [favIds, setFavIds] = useState(new Set()); // Set<string>
  const [now] = useState(Date.now());

  // quick request modal
  const [qrOpen, setQrOpen] = useState(false);
  const [qrServiceId, setQrServiceId] = useState(null);
  const [qrProviderId, setQrProviderId] = useState(null);
  const [qrServiceTitle, setQrServiceTitle] = useState("");

  const openQuickRequest = (serviceId, providerId, serviceTitle) => {
    setQrServiceId(serviceId);
    setQrProviderId(providerId || null);
    setQrServiceTitle(serviceTitle || "");
    setQrOpen(true);
  };
  const submitQuickRequest = async (note) => {
    try {
      await apiPost("/api/requests", {
        service_id: qrServiceId,
        provider_id: qrProviderId || undefined,
        service_title: qrServiceTitle || undefined,
        note: note || undefined,
      });
      tSuccess(t("messages.request_sent") || "Запрос отправлен", { autoClose: 1800 });
    } catch {
      tError(t("errors.request_send") || "Не удалось отправить запрос", { autoClose: 1800 });
    } finally {
      setQrOpen(false);
      setQrServiceId(null);
      setQrProviderId(null);
      setQrServiceTitle("");
    }
  };

  // load favorites
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const list = await apiProviderFavorites();
        const arr = Array.isArray(list) ? list : [];
        setItems(arr);
        const ids = arr
          .map((x) => x?.service_id ?? x?.service?.id ?? x?.id)
          .filter(Boolean)
          .map(String);
        setFavIds(new Set(ids));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // toggle/remove
  const toggleFavorite = async (serviceId) => {
    const key = String(serviceId);
    // оптимистично перевернём
    const flipTo = !favIds.has(key);
    setFavIds((prev) => {
      const next = new Set(prev);
      if (flipTo) next.add(key);
      else next.delete(key);
      return next;
    });
    if (!flipTo) {
      // если сняли избранное — сразу убираем карточку из списка
      setItems((prev) => prev.filter((x) => String(x?.service_id ?? x?.service?.id ?? x?.id) !== key));
    }

    try {
      const res = await apiToggleProviderFavorite(serviceId);
      // если сервер сказал иначе — синхронизируем
      if (typeof res?.added === "boolean" && res.added !== flipTo) {
        setFavIds((prev) => {
          const next = new Set(prev);
          if (res.added) next.add(key);
          else next.delete(key);
          return next;
        });
        if (!res.added) {
          setItems((prev) => prev.filter((x) => String(x?.service_id ?? x?.service?.id ?? x?.id) !== key));
        }
      }
      // обновим бейдж в Header.jsx
      window.dispatchEvent(new Event("provider:favorites:changed"));
      (res?.added ? tSuccess : tInfo)(
        res?.added
          ? (t("favorites.added_toast") || "Добавлено в избранное")
          : (t("favorites.removed_toast") || "Удалено из избранного"),
        { autoClose: 1800 }
      );
    } catch {
      // откат при ошибке
      setFavIds((prev) => {
        const next = new Set(prev);
        if (flipTo) next.delete(key);
        else next.add(key);
        return next;
      });
      if (!flipTo) {
        // если откатываем снятие — вернём карточку (если удаляли)
        const lost = items.find((x) => String(x?.service_id ?? x?.service?.id ?? x?.id) === key);
        if (!lost) {
          // ничего, список уже без неё; в следующий fetch вернётся
        }
      }
      tError(t("errors.favorite_toggle") || "Не удалось обновить избранное", { autoClose: 1800 });
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      <h2 className="text-xl font-semibold mb-4">{t("provider.favorites.tab") || "Избранное"}</h2>

      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && <div className="text-gray-500">Загрузка…</div>}
        {!loading && !items.length && <div className="text-gray-500">Пусто</div>}
        {!loading && !!items.length && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it) => {
              const id = String(it?.service_id ?? it?.service?.id ?? it?.id);
              return (
                <ServiceCard
                  key={id}
                  item={it}
                  viewerRole={__viewerRole}
                  favoriteIds={favIds}
                  onToggleFavorite={toggleFavorite}
                  onQuickRequest={openQuickRequest}
                  now={now}
                />
              );
            })}
          </div>
        )}
      </div>

      <QuickRequestModal open={qrOpen} onClose={() => setQrOpen(false)} onSubmit={submitQuickRequest} />
    </div>
  );
}
