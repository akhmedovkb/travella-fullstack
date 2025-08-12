// src/pages/Marketplace.jsx
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";

/* ===== helpers ===== */
function normalizeList(res) {
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

/* ===== page ===== */
export default function Marketplace() {
  const { t } = useTranslation();

  // ui
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // filters (минимум — как раньше)
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("newest");

  const payload = useMemo(
    () => ({
      q: q?.trim() || undefined,
      category: category || undefined,
      sort,
      only_active: true,
      limit: 60,
      offset: 0,
    }),
    [q, category, sort]
  );

  async function search(opts = {}) {
    setLoading(true);
    setError(null);
    try {
      const body = opts.all ? {} : payload;

      // основной поиск
      let res = await apiPost("/api/marketplace/search", body);
      let list = normalizeList(res);

      // fallback — публичные услуги
      if (!list.length) {
        const pub = await apiGet("/api/services/public").catch(() => []);
        list = normalizeList(pub);
      }
      setItems(list);
    } catch {
      try {
        const pub = await apiGet("/api/services/public");
        setItems(normalizeList(pub));
      } catch {
        setItems([]);
        setError(t("common.loading_error") || "Ошибка загрузки данных");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // автоподгрузка всего (как раньше)
    search({ all: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleQuickRequest(serviceId) {
    if (!serviceId) return;
    const note =
      window.prompt(
        t("common.note_optional") ||
          "Комментарий к запросу (необязательно):"
      ) || undefined;
    try {
      await apiPost("/api/requests", { service_id: serviceId, note });
      alert(t("messages.request_sent") || "Запрос отправлен");
    } catch {
      alert(t("common.loading_error") || "Не удалось отправить запрос");
    }
  }

  /* ===== Card (как на прежнем UI) ===== */
  function Card({ it }) {
    const svc = it?.service || it;
    const id = svc?.id ?? it?.id;
    const title =
      svc?.title || svc?.name || svc?.service_title || t("title") || "Service";
    const images = Array.isArray(svc?.images) ? svc.images : [];
    const image = images[0] || svc?.cover || svc?.image || null;
    const price = svc?.price ?? svc?.net_price ?? it?.price ?? it?.net_price;
    const prettyPrice = fmtPrice(price);

    return (
      <div className="bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
        <div className="aspect-[16/10] bg-gray-100">
          {image ? (
            <img src={image} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              {t("favorites.no_image") || "Нет изображения"}
            </div>
          )}
        </div>
        <div className="p-3 flex-1 flex flex-col">
          <div className="font-semibold line-clamp-2">{title}</div>
          {prettyPrice && (
            <div className="mt-1 text-xs text-gray-600">
              {t("marketplace.price") || "Цена"}:{" "}
              <span className="font-semibold">{prettyPrice}</span>
            </div>
          )}
          <div className="mt-auto pt-3">
            <button
              onClick={() => handleQuickRequest(id)}
              className="w-full bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
            >
              {t("actions.quick_request") || "Быстрый запрос"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ===== UI ===== */
  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* верхняя панель — компактная */}
      <div className="bg-white rounded-xl shadow p-3 border mb-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("marketplace.location_placeholder") || "Введите локацию ..."}
            className="md:col-span-6 border rounded-lg px-3 py-2"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="md:col-span-3 border rounded-lg px-3 py-2"
          >
            <option value="">{t("marketplace.select_category") || "Выберите категорию"}</option>
            <option value="guide">{t("category.guide") || "Гид"}</option>
            <option value="transport">{t("category.transport") || "Транспорт"}</option>
            <option value="refused_tour">{t("category.refused_tour") || "Отказной тур"}</option>
            <option value="refused_hotel">{t("category.refused_hotel") || "Отказной отель"}</option>
            <option value="refused_flight">{t("category.refused_flight") || "Отказной авиабилет"}</option>
            <option value="refused_event_ticket">{t("category.refused_event_ticket") || "Отказной ивент"}</option>
            <option value="visa_support">{t("category.visa_support") || "Визовая поддержка"}</option>
            <option value="author_tour">{t("category.author_tour") || "Авторский тур"}</option>
            <option value="hotel_room">{t("category.hotel_room") || "Номер отеля"}</option>
            <option value="hall_rent">{t("category.hall_rent") || "Зал / аренда"}</option>
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="md:col-span-2 border rounded-lg px-3 py-2"
          >
            <option value="newest">{t("marketplace.sort_newest") || "Новые"}</option>
            <option value="price_asc">{t("marketplace.sort_price_asc") || "Цена ↑"}</option>
            <option value="price_desc">{t("marketplace.sort_price_desc") || "Цена ↓"}</option>
          </select>

          <div className="md:col-span-1 flex gap-2">
            <button
              onClick={() => search()}
              className="flex-1 px-4 py-2 rounded-lg bg-gray-900 text-white"
              disabled={loading}
            >
              {t("marketplace.search") || "Найти"}
            </button>
            <button
              onClick={() => {
                setQ("");
                setCategory("");
                setSort("newest");
                search({ all: true });
              }}
              className="px-4 py-2 rounded-lg border"
              disabled={loading}
              title={t("back") || "Назад"}
            >
              ←
            </button>
          </div>
        </div>
      </div>

      {/* контент */}
      <div className="bg-white rounded-xl shadow p-4 border">
        {loading && (
          <div className="text-gray-500">
            {t("common.loading") || "Загрузка..."}
          </div>
        )}

        {!loading && error && (
          <div className="text-red-600">{error}</div>
        )}

        {!loading && !error && !items.length && (
          <div className="text-gray-500">
            {t("client.dashboard.noResults") || "Нет данных"}
          </div>
        )}

        {!loading && !error && !!items.length && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it) => (
              <Card key={it.id || it.service?.id || JSON.stringify(it)} it={it} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
