import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";

function normalizeList(res) {
  // поддержка форматов: [], {items:[]}, {data:[]}
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}

function fmtPrice(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n)) return new Intl.NumberFormat().format(n);
  return String(v);
}

export default function Marketplace() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // простые фильтры (оставил задел под расширение)
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");

  const filters = useMemo(
    () => ({
      q: q?.trim() || undefined,
      category: category || undefined,
      // при необходимости сюда же date_from/date_to/location/и т.п.
    }),
    [q, category]
  );

  const search = async (opts = {}) => {
    setLoading(true);
    setError(null);
    try {
      // Если нужна загрузка всех услуг, шлём пустые фильтры:
      const payload = opts?.all ? {} : filters;

      // Путь 1: общий поиск по маркетплейсу
      let res = await apiPost("/api/marketplace/search", payload);
      let list = normalizeList(res);

      // Путь 2 (fallback): если эндпоинта нет — попробуем публичный список услуг
      if (!list.length && opts?.fallback !== false) {
        res = await apiGet("/api/services/public");
        list = normalizeList(res);
      }

      setItems(list);
    } catch (e) {
      setError(t("common.loading_error") || "Не удалось загрузить данные");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  // авто-поиск ВСЕГО при первом открытии
  useEffect(() => {
    search({ all: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuickRequest = async (serviceId) => {
    if (!serviceId) return;
    const note = window.prompt(t("client.dashboard.noResults") || "Комментарий (необязательно)") || undefined;
    try {
      await apiPost("/api/requests", { service_id: serviceId, note });
      alert(t("actions.quick_request") + " ✓");
    } catch {
      alert(t("common.loading_error") || "Не удалось отправить запрос");
    }
  };

  const Card = ({ it }) => {
    // Унификация полей
    const svc = it?.service || it; // вдруг приходят элементы в обёртке
    const id = svc.id ?? it.id;
    const title =
      svc.title ||
      svc.name ||
      svc.service_title ||
      t("title") ||
      "Service";
    const images = Array.isArray(svc.images) ? svc.images : [];
    const image = images[0] || svc.cover || svc.image || null;
    const price = svc.price ?? svc.net_price ?? it.price ?? it.net_price;
    const prettyPrice = fmtPrice(price);
    const location =
      svc.location ||
      svc.city ||
      svc.direction_to ||
      svc.direction ||
      null;

    return (
      <div className="bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
        <div className="aspect-[16/10] bg-gray-100">
          {image ? (
            <img src={image} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              {t("favorites_no_image") || "No image"}
            </div>
          )}
        </div>
        <div className="p-3 flex-1 flex flex-col">
          <div className="font-semibold line-clamp-2">{title}</div>
          {location && (
            <div className="mt-1 text-sm text-gray-500">{location}</div>
          )}
          {prettyPrice && (
            <div className="mt-2 text-sm">
              {t("marketplace.price") || "Price"}:{" "}
              <span className="font-semibold">{prettyPrice}</span>
            </div>
          )}
          <div className="mt-auto pt-3 flex gap-2">
            <button
              onClick={() => handleQuickRequest(id)}
              className="flex-1 bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
            >
              {t("actions.quick_request") || "Quick request"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* Поисковая панель (минимальная) */}
      <div className="bg-white rounded-xl shadow p-4 border mb-4 flex flex-col md:flex-row gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("marketplace.location_placeholder") || "Enter query..."}
          className="flex-1 border rounded-lg px-3 py-2"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full md:w-56 border rounded-lg px-3 py-2"
        >
          <option value="">{t("marketplace.select_category") || "Select category"}</option>
          <option value="guide">{t("guide") || "Guide"}</option>
          <option value="transport">{t("transport") || "Transport"}</option>
          <option value="refused_tour">{t("refused_tour") || "Refused tour"}</option>
          <option value="refused_hotel">{t("refused_hotel") || "Refused hotel"}</option>
          <option value="refused_flight">{t("refused_ticket") || "Refused flight"}</option>
          <option value="refused_event_ticket">{t("refused_event") || "Refused event"}</option>
          <option value="visa_support">{t("visa_support") || "Visa support"}</option>
        </select>
        <div className="flex gap-2">
          <button
            onClick={() => search()}
            className="px-4 py-2 rounded-lg bg-gray-900 text-white"
            disabled={loading}
          >
            {t("marketplace.search") || "Search"}
          </button>
          <button
            onClick={() => {
              setQ("");
              setCategory("");
              search({ all: true });
            }}
            className="px-4 py-2 rounded-lg border"
            disabled={loading}
          >
            {t("back") || "Reset"}
          </button>
        </div>
      </div>

      {/* Список */}
      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && <div className="text-gray-500">{t("marketplace.searching") || "Searching..."}</div>}
        {!loading && error && (
          <div className="text-red-600">{error}</div>
        )}
        {!loading && !error && !items.length && (
          <div className="text-gray-500">
            {t("client.dashboard.noResults") || "No results"}
          </div>
        )}
        {!loading && !error && !!items.length && (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {items.map((it) => (
                <Card key={it.id || it.service?.id || JSON.stringify(it)} it={it} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
