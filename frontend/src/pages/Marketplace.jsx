// src/pages/Marketplace.jsx
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";

// приведи ответ к массиву
function normalizeList(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.data)) return res.data;
  return [];
}
const hasClient = !!localStorage.getItem("clientToken");

function fmtPrice(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n)) return new Intl.NumberFormat().format(n);
  return String(v);
}

export default function Marketplace() {
  const { t, i18n } = useTranslation();

  // UI состояния
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  // фильтры верхней панели
  const [q, setQ] = useState(""); // «Внесите локацию…» -> по прибытиям/локациям
  const [category, setCategory] = useState(""); // ключ селекта

  // лайки
  const [favIds, setFavIds] = useState(new Set());

  // Варианты категорий селекта (ключи совпадают с backend CAT_MAP)
  const categories = useMemo(
    () => [
      { key: "", label: t("marketplace.select_category") || "Выберите категорию" },
      { key: "guide", label: t("guide") || "Гид" },
      { key: "transport", label: t("transport") || "Транспорт" },
      { key: "refused_tour", label: t("marketplace.package") || "Отказной тур" },
      { key: "refused_hotel", label: t("marketplace.hotel") || "Отказной отель" },
      { key: "refused_flight", label: t("marketplace.flight") || "Отказной авиабилет" },
      { key: "refused_event_ticket", label: t("marketplace.refused_event") || "Отказной билет" },
      { key: "visa_support", label: t("visa_support") || "Визовая поддержка" },
    ],
    [i18n.language, t]
  );

  // Загрузка избранного (только ids; без изменения внешнего вида)
  useEffect(() => {
    if (!hasClient) return;
    (async () => {
      try {
        const res = await apiGet("/api/wishlist?idsOnly=1").catch(() => []);
        const arr = Array.isArray(res) ? res : res?.ids || [];
        setFavIds(new Set(arr.map(Number)));
      } catch {}
    })();
  }, []);

  async function search(opts = {}) {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        location: q?.trim() || undefined,
        category: category || undefined,
        ...opts,
      };
      const res = await apiPost("/api/marketplace/search", payload);
      setItems(normalizeList(res));
    } catch (e) {
      setError(t("common.loading_error") || "Не удалось загрузить данные");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  // первый рендер — показать всё
  useEffect(() => {
    search({ only_active: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onReset() {
    setQ("");
    setCategory("");
    search({ only_active: true });
  }

  async function handleQuickRequest(serviceId) {
    if (!serviceId) return;
    if (!hasClient) {
      alert(t("client.login.title") || "Войдите как клиент");
      return;
    }
    const note =
      window.prompt(
        t("requests.note_prompt") ||
          "Комментарий к запросу (необязательно):"
      ) || undefined;

    try {
      await apiPost("/api/requests", { service_id: serviceId, note });
      alert(t("requests.sent") || "Запрос отправлен");
    } catch {
      alert(t("requests.error") || "Не удалось отправить запрос");
    }
  }

  async function toggleFavorite(serviceId) {
    if (!hasClient) {
      alert(t("client.login.title") || "Войдите как клиент");
      return;
    }
    try {
      await apiPost("/api/wishlist/toggle", { service_id: serviceId });
      setFavIds((prev) => {
        const next = new Set(prev);
        if (next.has(serviceId)) next.delete(serviceId);
        else next.add(serviceId);
        return next;
      });
    } catch {
      alert(t("toast.favoriteError") || "Не удалось изменить избранное");
    }
  }

  // ===== Рендер =====

  const Card = ({ it }) => {
    const svc = it?.service || it;
    const id = Number(svc?.id ?? it?.id);
    const title =
      svc?.title ||
      svc?.name ||
      svc?.service_title ||
      t("title") ||
      "Service";
    const images = Array.isArray(svc?.images) ? svc.images : [];
    const image = images[0] || svc?.cover || svc?.image || null;
    const price = svc?.price ?? svc?.net_price ?? svc?.details?.netPrice;
    const prettyPrice = fmtPrice(price);
    const isFav = favIds.has(id);

    return (
      <div className="bg-white rounded-2xl shadow border overflow-hidden">
        <div className="relative aspect-[4/3] bg-gray-100">
          {image ? (
            <img src={image} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              {t("favorites.no_image") || "Нет изображения"}
            </div>
          )}

          {/* сердечко избранного — без изменения компоновки */}
          <button
            onClick={() => toggleFavorite(id)}
            className="absolute top-2 right-2 w-9 h-9 rounded-full bg-white/90 flex items-center justify-center shadow"
            title={isFav ? t("favorites.removed") : t("favorites.added")}
          >
            <span className={`text-lg ${isFav ? "text-red-500" : "text-gray-400"}`}>
              {isFav ? "♥" : "♡"}
            </span>
          </button>
        </div>

        <div className="p-4">
          <div className="uppercase text-sm font-semibold line-clamp-2">
            {title}
          </div>
          {prettyPrice && (
            <div className="mt-2 text-sm">
              {t("marketplace.price") || "Цена"}:{" "}
              <span className="font-semibold">{prettyPrice}</span>
            </div>
          )}

          <button
            onClick={() => handleQuickRequest(id)}
            className="mt-3 w-full bg-orange-500 hover:bg-orange-600 text-white rounded px-3 py-2 text-sm font-semibold"
          >
            {t("actions.quick_request") || "Быстрый запрос"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      {/* Верхняя панель — сохранил визуал */}
      <div className="bg-white rounded-xl shadow p-4 border mb-4 flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("marketplace.location_placeholder") || "Внесите локацию ..."}
          className="flex-1 border rounded-lg px-3 py-2"
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full md:w-64 border rounded-lg px-3 py-2"
        >
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>

        <button
          onClick={() => search()}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white"
          disabled={loading}
        >
          {t("marketplace.search") || "Найти"}
        </button>

        <button onClick={onReset} className="px-4 py-2 rounded-lg border">
          {t("back") || "← Назад"}
        </button>
      </div>

      {/* Список */}
      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && (
          <div className="text-gray-500">
            {t("marketplace.searching") || "Идёт поиск..."}
          </div>
        )}

        {!loading && error && <div className="text-red-600">{error}</div>}

        {!loading && !error && items.length === 0 && (
          <div className="text-gray-500">
            {t("client.dashboard.noResults") || "Нет данных"}
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it) => (
              <Card
                key={it.id || it.service?.id || JSON.stringify(it)}
                it={it}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
