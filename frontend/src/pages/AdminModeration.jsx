// frontend/src/pages/AdminModeration.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { tSuccess, tError, tInfo } from "../shared/toast";

const fmt = (n) => new Intl.NumberFormat().format(Number(n || 0));
const API_BASE = import.meta.env.VITE_API_BASE_URL;

function providerFrom(svc) {
  const p = svc?.provider || {};
  return {
    id: svc?.provider_id ?? p.id ?? null,
    name: svc?.provider_name ?? p.name ?? "—",
    type: svc?.provider_type ?? p.type ?? "",
  };
}

function Card({ item, tab, onApprove, onReject, onUnpublish, t }) {
  const s = item || {};
  const d = typeof s.details === "object" && s.details !== null ? s.details : {};
  const cover = Array.isArray(s.images) && s.images.length ? s.images[0] : null;
  const prov = providerFrom(s);

  // Локализация типа поставщика по уже существующим ключам provider.types.*
  const providerTypeLabel = (() => {
    const v = prov.type;
    if (!v) return "";
    const arr = Array.isArray(v)
      ? v
      : String(v).split(/[,\s|/]+/).filter(Boolean);
    return arr
      .map((k) => t(`provider.types.${k}`, { defaultValue: k }))
      .join(", ");
  })();

  // Локализация категории: service.categories.* -> service.types.* -> top-level key -> raw
  const categoryLabel = s.category
    ? t(`service.categories.${s.category}`, {
        defaultValue: t(`service.types.${s.category}`, {
          defaultValue: t(s.category, { defaultValue: s.category }),
        }),
      })
    : "";

  const yesLabel = t("common.yes", { defaultValue: "Да" });
  const noLabel = t("common.no", { defaultValue: "Нет" });

  // набор ключей, которые мы выведем "красиво" (чтобы потом не дублировать в «прочих полях»)
  const prettyKeys = new Set([
    "directionCountry",
    "directionFrom",
    "directionTo",
    "startDate",
    "endDate",
    "hotel",
    "accommodation",
    "food",
    "transfer",
    "changeable",
    "visaIncluded",
    "isActive",
    "expiration",
    "expiration_at",
    "departureFlightDate",
    "returnFlightDate",
    "flightDetails",
    "flight_details",
    "flight_info",
  ]);

  // Вспомогательно: есть ли вообще что показывать в подробном блоке
  const hasExtraDetails =
    d.directionCountry ||
    d.directionFrom ||
    d.directionTo ||
    d.startDate ||
    d.endDate ||
    d.hotel ||
    d.accommodation ||
    d.food ||
    d.transfer ||
    typeof d.changeable !== "undefined" ||
    typeof d.visaIncluded !== "undefined" ||
    typeof d.isActive !== "undefined" ||
    d.expiration ||
    d.expiration_at ||
    d.departureFlightDate ||
    d.returnFlightDate ||
    d.flightDetails ||
    d.flight_details ||
    d.flight_info;

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm flex flex-col">
      <div className="flex gap-3">
        <div className="w-24 h-16 bg-gray-100 rounded overflow-hidden">
          {cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> : null}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">
            {s.title ||
              t("moderation.no_title", { defaultValue: "(без названия)" })}
          </div>
          <div className="text-xs text-gray-600">{categoryLabel}</div>
          <div className="text-xs text-gray-600 mt-1">
            {t("moderation.supplier", { defaultValue: "Поставщик" })}:{" "}
            {prov.id ? (
              <Link
                to={`/profile/provider/${prov.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {prov.name}
              </Link>
            ) : (
              <span>{prov.name}</span>
            )}
            {providerTypeLabel ? ` (${providerTypeLabel})` : ""}
          </div>
          <div className="text-sm mt-1">
            {d?.netPrice != null || d?.grossPrice != null ? (
              <>
                Netto: {fmt(d?.netPrice)} / Gross: {fmt(d?.grossPrice)}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {s.description && (
        <div className="mt-3 text-sm text-gray-800 whitespace-pre-wrap">
          {s.description}
        </div>
      )}

      {/* Краткая сетка как было */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-700">
        {d.direction && (
          <div>
            {t("moderation.direction", { defaultValue: "Направление" })}:{" "}
            {d.direction}
          </div>
        )}
        {d.startDate && (
          <div>
            {t("moderation.start", { defaultValue: "Старт" })}: {d.startDate}
          </div>
        )}
        {d.endDate && (
          <div>
            {t("moderation.end", { defaultValue: "Конец" })}: {d.endDate}
          </div>
        )}
        {d.location && (
          <div>
            {t("moderation.location", { defaultValue: "Локация" })}:{" "}
            {d.location}
          </div>
        )}
        {d.eventName && (
          <div>
            {t("moderation.event", { defaultValue: "Событие" })}:{" "}
            {d.eventName}
          </div>
        )}
        {d.airline && (
          <div>
            {t("moderation.airline", { defaultValue: "Авиакомпания" })}:{" "}
            {d.airline}
          </div>
        )}
      </div>

      {/* 🔍 Новый подробный блок: все ключевые поля details перед approve */}
      {hasExtraDetails && (
        <div className="mt-3 text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
          <div className="font-semibold mb-1">
            {t("moderation.details_block_title", {
              defaultValue: "Детали услуги",
            })}
          </div>

          {/* Направление и даты */}
          {d.directionCountry && (
            <div>
              <span className="text-gray-500">
                {t("moderation.country", { defaultValue: "Страна" })}:{" "}
              </span>
              <span className="font-medium">{d.directionCountry}</span>
            </div>
          )}
          {(d.directionFrom || d.directionTo) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.route", { defaultValue: "Маршрут" })}:{" "}
              </span>
              <span className="font-medium">
                {d.directionFrom || "—"} → {d.directionTo || "—"}
              </span>
            </div>
          )}
          {(d.startDate || d.endDate) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.dates", { defaultValue: "Даты тура" })}:{" "}
              </span>
              <span className="font-medium">
                {d.startDate || "—"} {d.endDate && "→"} {d.endDate || ""}
              </span>
            </div>
          )}

          {/* Отель / размещение / питание / трансфер */}
          {d.hotel && (
            <div>
              <span className="text-gray-500">
                {t("moderation.hotel", { defaultValue: "Отель" })}:{" "}
              </span>
              <span className="font-medium">{d.hotel}</span>
            </div>
          )}
          {d.accommodation && (
            <div>
              <span className="text-gray-500">
                {t("moderation.accommodation", {
                  defaultValue: "Размещение",
                })}:{" "}
              </span>
              <span className="font-medium">{d.accommodation}</span>
            </div>
          )}
          {d.food && (
            <div>
              <span className="text-gray-500">
                {t("moderation.food", { defaultValue: "Питание" })}:{" "}
              </span>
              <span className="font-medium">{d.food}</span>
            </div>
          )}
          {d.transfer && (
            <div>
              <span className="text-gray-500">
                {t("moderation.transfer", { defaultValue: "Трансфер" })}:{" "}
              </span>
              <span className="font-medium">{d.transfer}</span>
            </div>
          )}

          {/* Флаги */}
          {typeof d.changeable !== "undefined" && (
            <div>
              <span className="text-gray-500">
                {t("moderation.changeable", {
                  defaultValue: "Можно вносить изменения",
                })}:{" "}
              </span>
              <span className="font-medium">
                {d.changeable ? yesLabel : noLabel}
              </span>
            </div>
          )}
          {typeof d.visaIncluded !== "undefined" && (
            <div>
              <span className="text-gray-500">
                {t("moderation.visa_included", {
                  defaultValue: "Виза включена",
                })}:{" "}
              </span>
              <span className="font-medium">
                {d.visaIncluded ? yesLabel : noLabel}
              </span>
            </div>
          )}
          {typeof d.isActive !== "undefined" && (
            <div>
              <span className="text-gray-500">
                {t("moderation.is_active", {
                  defaultValue: "Актуально",
                })}:{" "}
              </span>
              <span className="font-medium">
                {d.isActive ? yesLabel : noLabel}
              </span>
            </div>
          )}
          {(d.expiration || d.expiration_at) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.expiration", {
                  defaultValue: "Таймер актуальности",
                })}:{" "}
              </span>
              <span className="font-medium">
                {d.expiration || d.expiration_at}
              </span>
            </div>
          )}

          {/* Полёт */}
          {(d.departureFlightDate || d.returnFlightDate) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.flight_dates", {
                  defaultValue: "Даты рейса",
                })}:{" "}
              </span>
              <span className="font-medium">
                {d.departureFlightDate || "—"}{" "}
                {d.returnFlightDate && "→"} {d.returnFlightDate || ""}
              </span>
            </div>
          )}

          {/* Детали рейса отдельным блоком */}
          {(d.flightDetails || d.flight_details || d.flight_info) && (
            <div className="mt-1 rounded-md bg-white border border-gray-200 px-2 py-1.5 text-[11px] whitespace-pre-wrap leading-snug">
              <div className="font-semibold mb-1">
                {t("moderation.flight_details_title", {
                  defaultValue: "Детали рейса",
                })}
              </div>
              {String(
                d.flightDetails || d.flight_details || d.flight_info || ""
              ).replace(/\r\n/g, "\n")}
            </div>
          )}

          {/* Прочие поля details (чтобы модератор видел вообще всё) */}
          {Object.keys(d).some((k) => !prettyKeys.has(k)) && (
            <div className="mt-2 border-t border-gray-200 pt-1">
              <div className="text-[11px] font-semibold text-gray-500 mb-1">
                {t("moderation.other_fields", {
                  defaultValue: "Прочие поля",
                })}
              </div>
              <div className="space-y-0.5 text-[11px]">
                {Object.entries(d)
                  .filter(([key]) => !prettyKeys.has(key))
                  .map(([key, value]) => (
                    <div key={key} className="flex gap-1">
                      <div className="text-gray-500 min-w-[90px] break-all">
                        {key}:
                      </div>
                      <div className="break-all">
                        {typeof value === "boolean"
                          ? value
                            ? yesLabel
                            : noLabel
                          : Array.isArray(value)
                          ? value.join(", ")
                          : String(value)}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {s.rejected_reason && tab === "rejected" && (
        <div className="mt-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
          {t("moderation.rejected_reason", { defaultValue: "Причина" })}:{" "}
          {s.rejected_reason}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {/* В rejected показываем «Подтвердить» (approve), в pending — обычный approve/reject */}
        <button
          onClick={() => onApprove(s.id)}
          className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700"
        >
          {tab === "rejected"
            ? t("moderation.confirm", { defaultValue: "Подтвердить" })
            : t("moderation.approve", { defaultValue: "Approve" })}
        </button>

        {tab === "pending" && (
          <button
            onClick={() => {
              const reason = prompt(
                t("moderation.enter_reason", {
                  defaultValue: "Причина отклонения:",
                })
              );
              if (reason != null) onReject(s.id, reason);
            }}
            className="px-3 py-1.5 rounded bg-rose-600 text-white text-sm hover:bg-rose-700"
          >
            {t("moderation.reject", { defaultValue: "Reject" })}
          </button>
        )}

        {/* Unpublish уместен только для опубликованных (оставим как раньше) */}
        {item.status === "published" && (
          <button
            onClick={() => onUnpublish(s.id)}
            className="px-3 py-1.5 rounded bg-gray-200 text-gray-800 text-sm hover:bg-gray-300"
          >
            {t("moderation.unpublish", { defaultValue: "Unpublish" })}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AdminModeration() {
  const { t } = useTranslation();

  const [tab, setTab] = useState("pending"); // 'pending' | 'rejected'
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ pending: 0, rejected: 0 });

  const token = localStorage.getItem("token");
  const cfg = { headers: { Authorization: `Bearer ${token}` } };

  const isAdmin = (() => {
    try {
      const tkn = localStorage.getItem("token");
      if (!tkn) return false;
      const base64 = tkn.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(
        atob(base64)
          .split("")
          .map(
            (c) =>
              "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)
          )
          .join("")
      );
      const claims = JSON.parse(json);
      return (
        claims.role === "admin" ||
        claims.is_admin === true ||
        claims.moderator === true
      );
    } catch {
      return false;
    }
  })();

  async function fetchList(which) {
    const url =
      which === "pending"
        ? `${API_BASE}/api/admin/services/pending`
        : `${API_BASE}/api/admin/services/rejected`;
    const res = await axios.get(url, cfg);
    return Array.isArray(res.data) ? res.data : res.data?.items || [];
  }

  const load = async (which = tab) => {
    setLoading(true);
    try {
      const data = await fetchList(which);
      setItems(data);
    } catch (e) {
      tError(
        t("moderation.load_error", {
          defaultValue: "Не удалось загрузить список",
        })
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const refreshCounts = async () => {
    try {
      const [p, r] = await Promise.all([
        axios.get(`${API_BASE}/api/admin/services/pending`, cfg),
        axios.get(`${API_BASE}/api/admin/services/rejected`, cfg),
      ]);
      const pending = (Array.isArray(p.data) ? p.data : p.data?.items || [])
        .length;
      const rejected = (Array.isArray(r.data) ? r.data : r.data?.items || [])
        .length;
      setCounts({ pending, rejected });
    } catch {}
  };

  useEffect(() => {
    load("pending");
    refreshCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(tab);
  }, [tab]);

  const approve = async (id) => {
    try {
      await axios.post(
        `${API_BASE}/api/admin/services/${id}/approve`,
        {},
        cfg
      );
      tSuccess(
        t("moderation.approved", { defaultValue: "Опубликовано" })
      );
      setItems((prev) => prev.filter((x) => x.id !== id));
      setCounts((c) => ({
        ...c,
        [tab]: Math.max(0, (c[tab] || 0) - 1),
      }));
    } catch {
      tError(
        t("moderation.approve_error", { defaultValue: "Ошибка approve" })
      );
    }
  };

  const reject = async (id, reason) => {
    if (!reason || !reason.trim())
      return tInfo(
        t("moderation.enter_reason_short", {
          defaultValue: "Укажите причину",
        })
      );
    try {
      await axios.post(
        `${API_BASE}/api/admin/services/${id}/reject`,
        { reason },
        cfg
      );
      tSuccess(
        t("moderation.rejected", { defaultValue: "Отклонено" })
      );
      setItems((prev) => prev.filter((x) => x.id !== id));
      setCounts((c) => ({
        ...c,
        pending: Math.max(0, (c.pending || 0) - 1),
        rejected: (c.rejected || 0) + 1,
      }));
    } catch {
      tError(
        t("moderation.reject_error", { defaultValue: "Ошибка reject" })
      );
    }
  };

  const unpublish = async (id) => {
    try {
      await axios.post(
        `${API_BASE}/api/admin/services/${id}/unpublish`,
        {},
        cfg
      );
      tSuccess(
        t("moderation.unpublished", {
          defaultValue: "Снято с публикации",
        })
      );
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      tError(
        t("moderation.unpublish_error", {
          defaultValue: "Ошибка unpublish",
        })
      );
    }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <div className="bg-white border rounded-lg p-6">
          <div className="text-xl font-semibold mb-2">403</div>
          <div>
            {t("moderation.forbidden", {
              defaultValue: "Доступ только для администратора",
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {t("moderation.title", { defaultValue: "Модерация услуг" })}
        </h1>
        <button
          onClick={() => {
            load(tab);
            refreshCounts();
          }}
          className="px-3 py-1.5 rounded bg-gray-900 text-white text-sm"
        >
          {t("common.refresh", { defaultValue: "Обновить" })}
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-5 inline-flex rounded-full bg-white shadow-sm overflow-hidden">
        <button
          className={`px-4 py-1.5 text-sm font-medium ${
            tab === "pending"
              ? "bg-gray-900 text-white"
              : "text-gray-700 hover:bg-gray-100"
          }`}
          onClick={() => setTab("pending")}
        >
          {t("moderation.tabs.pending", { defaultValue: "Ожидают" })}
          <span className="ml-2 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 text-xs rounded-full bg-gray-200 text-gray-700">
            {counts.pending || 0}
          </span>
        </button>
        <button
          className={`px-4 py-1.5 text-sm font-medium ${
            tab === "rejected"
              ? "bg-gray-900 text-white"
              : "text-gray-700 hover:bg-gray-100"
          }`}
          onClick={() => setTab("rejected")}
        >
          {t("moderation.tabs.rejected", { defaultValue: "Отклонённые" })}
          <span className="ml-2 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 text-xs rounded-full bg-gray-200 text-gray-700">
            {counts.rejected || 0}
          </span>
        </button>
      </div>

      {loading ? (
        <div className="text-gray-600">
          {t("common.loading", { defaultValue: "Загрузка…" })}
        </div>
      ) : items.length === 0 ? (
        <div className="text-gray-600">
          {t("moderation.empty", { defaultValue: "Нет элементов" })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => (
            <Card
              key={it.id}
              item={it}
              tab={tab}
              onApprove={approve}
              onReject={reject}
              onUnpublish={unpublish}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}
