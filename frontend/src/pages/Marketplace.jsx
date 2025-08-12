import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";

/* ===================== Helpers ===================== */
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

/* ===================== Component ===================== */

export default function Marketplace() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // верхняя панель
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");

  // список категорий (минимально необходимый набор)
  const categoryOptions = useMemo(
    () => [
      { value: "", label: t("marketplace.select_category") || "Выберите категорию" },
      { value: "guide", label: t("guide") || "Гид" },
      { value: "transport", label: t("transport") || "Транспорт" },
      { value: "refused_tour", label: t("refused_tour") || "Отказной тур" },
      { value: "refused_hotel", label: t("refused_hotel") || "Отказной отель" },
      { value: "refused_flight", label: t("refused_flight") || "Отказной авиабилет" },
      { value: "refused_event_ticket", label: t("refused_event_ticket") || "Отказной билет" },
      { value: "visa_support", label: t("visa_support") || "Виза" },
    ],
    [t]
  );

  const search = async (opts = {}) => {
    setLoading(true);
    setError(null);
    try {
      const payload = opts?.all
        ? {}
        : {
            q: q?.trim() || undefined,
            category: category || undefined,
          };

      // Основной путь — маркетплейс
      let res = await apiPost("/api/marketplace/search", payload).catch(() => null);
      let list = normalizeList(res);

      // Фолбэк — публичные услуги (если маркетплейс вернул пусто/ошибку)
      if (!list.length && opts?.fallback !== false) {
        res = await apiGet("/api/services/public").catch(() => null);
        list = normalizeList(res);
      }

      setItems(list);
    } catch (e) {
      console.error(e);
      setError(t("common.loading_error") || "Не удалось загрузить данные");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // при первом заходе — показать всё
    search({ all: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onQuickRequest = async (serviceId) => {
    if (!serviceId) return;
    const note =
      window.prompt(
        t("common.note_optional") || "Комментарий к запросу (необязательно):"
      ) || undefined;
    try {
      await apiPost("/api/requests", { service_id: serviceId, note });
      alert(t("messages.request_sent") || "Запрос отправлен");
    } catch (e) {
      console.error(e);
      alert(t("errors.request_send") || "Не удалось отправить запрос");
    }
  };

  const Card = ({ it }) => {
    // Унификация полей на разных ответах
    const svc = it?.service || it;
    const id = svc?.id ?? it?.id;
    const title =
      svc?.title ||
      svc?.name ||
      svc?.service_title ||
      t("common.service") ||
      "Услуга";
    const images = Array.isArray(svc?.images) ? svc.images : [];
    const image = images[0] || svc?.cover || svc?.image || null;
    const price =
      svc?.details?.netPrice ??
      svc?.netPrice ??
      svc?.price ??
      it?.price ??
      it?.netPrice;
    const prettyPrice = fmtPrice(price);

    return (
      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden flex flex-col">
        <div className="aspect-[16/10] bg-gray-100">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              {t("favorites.no_image") || "Нет изображения"}
            </div>
          )}
        </div>

        <div className="p-3">
          <div className="font-semibold line-clamp-2">{title}</div>
          {prettyPrice && (
            <div className="mt-1 text-sm text-gray-700">
              {t("marketplace.price") || "Цена"}:{" "}
              <span className="font-semibold">{prettyPrice}</span>
            </div>
          )}
        </div>

        <div className="px-3 pb-3 mt-auto">
          <button
            onClick={() => onQuickRequest(id)}
            className="w-full bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
          >
            {t("actions.quick_request") || "Быстрый запрос"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* Верхняя строка поиска — как на скрине */}
      <div className="bg-white rounded-xl shadow p-3 border mb-4">
        <div className="flex flex-col sm:flex-row gap-2 items-stretch">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("marketplace.location_placeholder") || "Внесите локацию ..."}
            className="flex-1 border rounded-lg px-3 py-2"
            onKeyDown={(e) => {
              if (e.key === "Enter") search();
            }}
          />

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full sm:w-60 border rounded-lg px-3 py-2"
          >
            {categoryOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <button
              onClick={() => search()}
              className="px-4 py-2 rounded-lg bg-gray-900 text-white"
              disabled={loading}
            >
              {t("marketplace.search") || "Найти"}
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
              {t("back") || "← Назад"}
            </button>
          </div>
        </div>
      </div>

      {/* Список карточек */}
      <div className="bg-white rounded-xl shadow p-4 border">
        {loading && (
          <div className="text-gray-500">{t("marketplace.searching") || "Поиск..."}</div>
        )}
        {!loading && error && (
          <div className="text-red-600">{error}</div>
        )}
        {!loading && !error && !items.length && (
          <div className="text-gray-500">
            {t("client.dashboard.noResults") || "Ничего не найдено"}
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
