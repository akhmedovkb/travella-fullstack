// src/pages/Marketplace.jsx
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiPost } from "../api";

// ---- helpers ----------------------------------------------------
function normalizeList(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}
function fmtPrice(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? new Intl.NumberFormat().format(n) : String(v);
}

// канонические ключи — именно их шлём на бэк
const CATEGORY_KEYS = [
  "guide",
  "transport",
  "refused_tour",
  "refused_hotel",
  "refused_flight",
  "refused_event_ticket",
  "visa_support",
];

// берём подписи из твоих локалей с фоллбэками
function labelForCategory(key, t) {
  switch (key) {
    case "guide":
      return (
        t("category.guide", { defaultValue: "" }) ||
        t("marketplace.guide", { defaultValue: "" }) ||
        t("guide", { defaultValue: "Гид" })
      );
    case "transport":
      return (
        t("category.transport", { defaultValue: "" }) ||
        t("marketplace.transport", { defaultValue: "" }) ||
        t("transport", { defaultValue: "Транспорт" })
      );
    case "refused_tour":
      return t("category.refused_tour", { defaultValue: "Отказной тур" });
    case "refused_hotel":
      return t("category.refused_hotel", { defaultValue: "Отказной отель" });
    case "refused_flight":
      // в RU есть и category.refused_flight, и marketplace.flight
      return (
        t("category.refused_flight", { defaultValue: "" }) ||
        t("marketplace.flight", { defaultValue: "Отказной авиабилет" })
      );
    case "refused_event_ticket":
      return (
        t("category.refused_event_ticket", { defaultValue: "" }) ||
        t("marketplace.refused_event", { defaultValue: "Отказной билет на мероприятие" })
      );
    case "visa_support":
      return (
        t("category.visa_support", { defaultValue: "" }) ||
        t("marketplace.visa_support", { defaultValue: "" }) ||
        t("visa_support", { defaultValue: "Визовая поддержка" })
      );
    default:
      return key;
  }
}

function useCategoryOptions(t) {
  return useMemo(() => {
    const base = [
      { value: "", label: t("marketplace.select_category", { defaultValue: "Выберите категорию" }) },
    ];
    const opts = CATEGORY_KEYS.map((k) => ({ value: k, label: labelForCategory(k, t) }));
    return base.concat(opts);
  }, [t]);
}

// ---- page -------------------------------------------------------
export default function Marketplace() {
  const { t } = useTranslation();
  const options = useCategoryOptions(t);

  const [q, setQ] = useState("");
  const [category, setCategory] = useState(""); // храним КЛЮЧ
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  async function search({ all = false } = {}) {
    setLoading(true);
    setError("");
    try {
      const payload = all
        ? {}
        : {
            q: q?.trim() || undefined,
            category: category || undefined, // уходит ключ
          };
      const res = await apiPost("/api/marketplace/search", payload);
      setItems(normalizeList(res));
    } catch (e) {
      console.error(e);
      setError(t("common.loading_error", { defaultValue: "Ошибка загрузки" }));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    search({ all: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const Card = ({ it }) => {
    const svc = it?.service || it;
    const title =
      svc?.title ||
      svc?.name ||
      svc?.service_title ||
      t("title", { defaultValue: "Услуга" });
    const img =
      Array.isArray(svc?.images) && svc.images.length ? svc.images[0] : null;
    const price = svc?.price ?? svc?.net_price ?? it?.price ?? it?.net_price;
    const pretty = fmtPrice(price);

    return (
      <div className="bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
        <div className="aspect-[16/10] bg-gray-100">
          {img ? (
            <img src={img} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              {t("favorites.no_image", { defaultValue: "Нет изображения" })}
            </div>
          )}
        </div>
        <div className="p-3 flex-1 flex flex-col">
          <div className="font-semibold line-clamp-2">{title}</div>
          {pretty && (
            <div className="mt-2 text-sm">
              {t("marketplace.price", { defaultValue: "Цена" })}:{" "}
              <span className="font-semibold">{pretty}</span>
            </div>
          )}
          <div className="mt-auto pt-3">
            <button className="w-full bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600">
              {t("actions.quick_request", { defaultValue: "Быстрый запрос" })}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* верхняя панель — прежний визуал */}
      <div className="bg-white rounded-xl shadow p-4 border mb-4 flex flex-col md:flex-row gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("marketplace.location_placeholder", {
            defaultValue: "Внесите локацию ...",
          })}
          className="flex-1 border rounded-lg px-3 py-2"
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full md:w-56 border rounded-lg px-3 py-2"
        >
          {options.map((o) => (
            <option key={o.value || "_"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <button
          onClick={() => search({ all: false })}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white"
          disabled={loading}
        >
          {t("marketplace.search", { defaultValue: "Найти" })}
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
          {t("back", { defaultValue: "← Назад" })}
        </button>
      </div>

      {/* список */}
      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && (
          <div className="text-gray-500">
            {t("marketplace.searching", { defaultValue: "Поиск..." })}
          </div>
        )}
        {!loading && error && <div className="text-red-600">{error}</div>}
        {!loading && !error && !items.length && (
          <div className="text-gray-500">
            {t("client.dashboard.noResults", { defaultValue: "Нет данных" })}
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
