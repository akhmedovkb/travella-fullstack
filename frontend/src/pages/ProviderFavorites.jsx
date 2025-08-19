//frontend/src/pages/ProviderFavorites.jsx

import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { apiProviderFavorites, apiRemoveProviderFavorite } from "../api/providerFavorites";

function firstImageFrom(val) {
  if (!val) return null;
  if (Array.isArray(val)) return firstImageFrom(val[0]);
  if (typeof val === "string") return val;
  if (typeof val === "object") return val.cover || val.url || val.src || null;
  return null;
}

export default function ProviderFavorites() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiProviderFavorites();
      setItems(Array.isArray(list) ? list : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const removeFav = async (id) => {
    const ok = await apiRemoveProviderFavorite(id);
    if (ok) {
      setItems((prev) => prev.filter((x) => (x.id ?? x.service_id) !== id));
      // чтобы бейдж в шапке обновился:
      window.dispatchEvent(new Event("provider:favorites:changed"));
    }
  };

  if (loading) return <div className="text-sm text-gray-500">{t("loading", "Загрузка…")}</div>;

  if (!items.length) {
    return <div className="text-sm text-gray-500">{t("provider.favorites.empty", "Избранного пока нет.")}</div>;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">{t("nav.favorites", "Избранное")}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((svc) => {
          const id = svc.id ?? svc.service_id;
          const title = svc.title || svc.details?.title || "Без названия";
          const category = svc.category || svc.details?.category || "—";
          const gross = svc.gross_price ?? svc.grossPrice ?? svc.details?.grossPrice ?? svc.details?.brutto;
          const net = svc.price ?? svc.details?.netPrice ?? svc.details?.price;
          const img = firstImageFrom(svc.images || svc.cover);

          return (
            <div key={id} className="border rounded-lg p-3 bg-white flex flex-col">
              {img ? <img src={img} alt="" className="w-full h-32 object-cover rounded mb-2" /> : null}
              <div className="font-medium">{title}</div>
              <div className="text-xs text-gray-500">{category}</div>
              <div className="text-sm mt-1">
                <span className="mr-2">Net: {net ?? "—"}</span>
                <span>Gross: {gross ?? "—"}</span>
              </div>
              <div className="mt-2">
                <button
                  className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
                  onClick={() => removeFav(id)}
                >
                  {t("remove", "Удалить")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
