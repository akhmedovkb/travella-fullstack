// frontend/src/pages/AdminModeration.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { tSuccess, tError, tInfo } from "../shared/toast";

const fmt = (n) => new Intl.NumberFormat().format(Number(n || 0));
const API_BASE = import.meta.env.VITE_API_BASE_URL;

function isRefusedCategory(cat) {
  return String(cat || "").toLowerCase().startsWith("refused_");
}

function formatDt(val) {
  if (!val) return "";
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function providerFrom(svc) {
  const p = svc?.provider || {};
  return {
    id: svc?.provider_id ?? p.id ?? null,
    name: svc?.provider_name ?? p.name ?? "—",
    type: svc?.provider_type ?? p.type ?? "",
  };
}

function parseJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeDetails(details) {
  if (!details) return {};
  if (typeof details === "object" && !Array.isArray(details)) return details;
  if (typeof details === "string") {
    const parsed = parseJsonSafe(details, {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  }
  return {};
}

function normalizeImages(images) {
  if (!images) return [];
  if (Array.isArray(images)) return images.filter(Boolean);

  if (typeof images === "string") {
    const parsed = parseJsonSafe(images, null);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
    if (parsed && typeof parsed === "string") return [parsed];
    return images.trim() ? [images.trim()] : [];
  }

  return [];
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v === 0) return v;
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v !== null && typeof v !== "undefined" && v !== "") return v;
  }
  return null;
}

function ProofLightbox({ image, onClose }) {
  if (!image) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[4000] bg-black/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-[95vw] max-h-[95vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-white text-black shadow-lg text-lg font-semibold"
          aria-label="Close"
        >
          ×
        </button>
        <img
          src={image}
          alt=""
          className="max-w-[95vw] max-h-[95vh] object-contain rounded-2xl shadow-2xl bg-white"
        />
      </div>
    </div>,
    document.body
  );
}

function Card({
  item,
  tab,
  onApprove,
  onReject,
  onUnpublish,
  t,
  onOpenProof,
}) {
  const s = item || {};
  const d = normalizeDetails(s.details);
  const images = normalizeImages(s.images);
  const proofImages = normalizeImages(d.proofImages);
  const hasProof = proofImages.length > 0;

  const cover = pickFirst(
    images[0],
    proofImages[0],
    d.image,
    d.imageUrl,
    d.cover,
    d.coverImage,
    d.photo,
    d.photoUrl
  );

  const prov = providerFrom(s);
  const isRefused = isRefusedCategory(s.category);
  const createdAtLabel = formatDt(
    s.created_at ||
      s.createdAt ||
      s.submitted_at ||
      s.submittedAt ||
      s.updated_at ||
      s.updatedAt
  );

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

  const categoryLabel = s.category
    ? t(`service.categories.${s.category}`, {
        defaultValue: t(`service.types.${s.category}`, {
          defaultValue: t(s.category, { defaultValue: s.category }),
        }),
      })
    : "";

  const yesLabel = t("common.yes", { defaultValue: "Да" });
  const noLabel = t("common.no", { defaultValue: "Нет" });

  const displayTitle = pickFirst(
    s.title,
    d.title,
    d.hotel,
    d.eventName,
    d.ticketTitle,
    d.directionTo,
    t("moderation.no_title", { defaultValue: "(без названия)" })
  );

  const netPrice = pickFirst(d.netPrice, d.net_price, d.priceNet, d.price_net);
  const grossPrice = pickFirst(
    d.grossPrice,
    d.gross_price,
    d.price,
    s.price
  );
  const oldPrice = pickFirst(
    d.previousPrice,
    d.oldPrice,
    d.old_price,
    d.prevPrice
  );

  const dateFrom = pickFirst(
    d.departureFlightDate,
    d.departureDate,
    d.startFlightDate,
    d.startDate,
    d.checkInDate,
    d.eventDate
  );

  const dateTo = pickFirst(
    d.returnFlightDate,
    d.endFlightDate,
    d.endDate,
    d.checkOutDate
  );

  const roomCategory = pickFirst(
    d.roomCategory,
    d.room_category,
    d.accommodationCategory,
    d.accommodation_category,
    d.category
  );

  const flightType = pickFirst(
    d.flightType,
    d.flight_type,
    d.tripType,
    d.trip_type
  );

  const prettyKeys = new Set([
    "title",
    "direction",
    "directionCountry",
    "directionFrom",
    "directionTo",
    "startDate",
    "endDate",
    "checkInDate",
    "checkOutDate",
    "eventDate",
    "hotel",
    "roomCategory",
    "room_category",
    "accommodation",
    "accommodationCategory",
    "accommodation_category",
    "food",
    "transfer",
    "changeable",
    "visaIncluded",
    "isActive",
    "expiration",
    "expiration_at",
    "expiration_ts",
    "departureFlightDate",
    "departureDate",
    "startFlightDate",
    "returnFlightDate",
    "endFlightDate",
    "flightType",
    "flight_type",
    "flightDetails",
    "flight_details",
    "flight_info",
    "netPrice",
    "net_price",
    "grossPrice",
    "gross_price",
    "previousPrice",
    "oldPrice",
    "old_price",
    "price",
    "image",
    "imageUrl",
    "cover",
    "coverImage",
    "photo",
    "photoUrl",
    "proofImages",
  ]);

  const hasExtraDetails =
    proofImages.length > 0 ||
    images.length > 0 ||
    d.directionCountry ||
    d.directionFrom ||
    d.directionTo ||
    dateFrom ||
    dateTo ||
    d.hotel ||
    roomCategory ||
    d.accommodation ||
    d.food ||
    d.transfer ||
    netPrice != null ||
    grossPrice != null ||
    oldPrice != null ||
    typeof d.changeable !== "undefined" ||
    typeof d.visaIncluded !== "undefined" ||
    typeof d.isActive !== "undefined" ||
    d.expiration ||
    d.expiration_at ||
    d.expiration_ts ||
    d.departureFlightDate ||
    d.departureDate ||
    d.startFlightDate ||
    d.returnFlightDate ||
    d.endFlightDate ||
    flightType ||
    d.flightDetails ||
    d.flight_details ||
    d.flight_info;

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm flex flex-col relative">
      <div className="absolute top-3 right-3 z-10">
        {hasProof ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white text-[11px] font-semibold px-2.5 py-1 shadow">
            ✔ {t("moderation.proof_exists", { defaultValue: "Есть proof" })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-300 text-gray-800 text-[11px] font-semibold px-2.5 py-1">
            {t("moderation.proof_missing", { defaultValue: "Нет proof" })}
          </span>
        )}
      </div>

      <div className="flex gap-3 pr-24">
        <div className="w-24 h-16 bg-gray-100 rounded overflow-hidden shrink-0">
          {cover ? (
            <img src={cover} alt="" className="w-full h-full object-cover" />
          ) : null}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">
            {isRefused ? `#${s.id} — ` : ""}
            {displayTitle}
          </div>

          <div className="text-xs text-gray-600">{categoryLabel}</div>

          {isRefused && createdAtLabel && (
            <div className="text-xs text-gray-500 mt-0.5">
              {t("moderation.created_at", { defaultValue: "Создан" })}:{" "}
              {createdAtLabel}
            </div>
          )}

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
            {netPrice != null || grossPrice != null || oldPrice != null ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {netPrice != null && <span>Netto: {fmt(netPrice)}</span>}
                {grossPrice != null && <span>Gross: {fmt(grossPrice)}</span>}
                {oldPrice != null && <span>Old: {fmt(oldPrice)}</span>}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {s.description && (
        <div className="mt-3 text-sm text-gray-800 whitespace-pre-wrap">
          {s.description}
        </div>
      )}

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

      {proofImages.length > 0 && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs font-semibold text-emerald-700">
              {t("moderation.proof_images", {
                defaultValue: "Подтверждение подлинности",
              })}
            </div>
            <div className="text-[11px] text-emerald-700/80">
              {proofImages.length}{" "}
              {t("moderation.proof_count", { defaultValue: "фото" })}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {proofImages.slice(0, 6).map((img, idx) => (
              <button
                key={`${s.id}-proof-${idx}`}
                type="button"
                onClick={() => onOpenProof(img)}
                className="rounded-xl overflow-hidden border border-emerald-200 bg-white hover:opacity-90"
                title={t("moderation.open_proof", {
                  defaultValue: "Открыть подтверждение",
                })}
              >
                <img
                  src={img}
                  alt=""
                  className="w-24 h-20 object-cover bg-white"
                />
              </button>
            ))}

            {proofImages.length > 6 && (
              <div className="w-24 h-20 rounded-xl bg-emerald-700 text-white flex items-center justify-center text-sm font-semibold">
                +{proofImages.length - 6}
              </div>
            )}
          </div>
        </div>
      )}

      {hasExtraDetails && (
        <div className="mt-3 text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
          <div className="font-semibold mb-1">
            {t("moderation.details_block_title", {
              defaultValue: "Детали услуги",
            })}
          </div>

          {images.length > 0 && (
            <div className="mb-2">
              <div className="text-gray-500 mb-1">
                {t("moderation.photos", { defaultValue: "Фото" })}:
              </div>
              <div className="flex gap-2 flex-wrap">
                {images.slice(0, 6).map((img, idx) => (
                  <img
                    key={`${s.id}-img-${idx}`}
                    src={img}
                    alt=""
                    className="w-20 h-16 object-cover rounded border border-gray-200 bg-white"
                  />
                ))}
              </div>
            </div>
          )}

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

          {(dateFrom || dateTo) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.dates", { defaultValue: "Даты" })}:{" "}
              </span>
              <span className="font-medium">
                {dateFrom || "—"} {dateTo && "→"} {dateTo || ""}
              </span>
            </div>
          )}

          {d.hotel && (
            <div>
              <span className="text-gray-500">
                {t("moderation.hotel", { defaultValue: "Отель" })}:{" "}
              </span>
              <span className="font-medium">{d.hotel}</span>
            </div>
          )}

          {roomCategory && (
            <div>
              <span className="text-gray-500">
                {t("moderation.room_category", {
                  defaultValue: "Категория номера",
                })}
                :{" "}
              </span>
              <span className="font-medium">{roomCategory}</span>
            </div>
          )}

          {d.accommodation && (
            <div>
              <span className="text-gray-500">
                {t("moderation.accommodation", {
                  defaultValue: "Размещение",
                })}
                :{" "}
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

          {(netPrice != null || grossPrice != null || oldPrice != null) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.prices", { defaultValue: "Цены" })}:{" "}
              </span>
              <span className="font-medium">
                {netPrice != null ? `Netto ${fmt(netPrice)}` : ""}
                {netPrice != null && grossPrice != null ? " / " : ""}
                {grossPrice != null ? `Gross ${fmt(grossPrice)}` : ""}
                {oldPrice != null ? ` / Old ${fmt(oldPrice)}` : ""}
              </span>
            </div>
          )}

          {typeof d.changeable !== "undefined" && (
            <div>
              <span className="text-gray-500">
                {t("moderation.changeable", {
                  defaultValue: "Можно вносить изменения",
                })}
                :{" "}
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
                })}
                :{" "}
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
                })}
                :{" "}
              </span>
              <span className="font-medium">
                {d.isActive ? yesLabel : noLabel}
              </span>
            </div>
          )}

          {(d.expiration || d.expiration_at || d.expiration_ts) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.expiration", {
                  defaultValue: "Таймер актуальности",
                })}
                :{" "}
              </span>
              <span className="font-medium">
                {pickFirst(d.expiration, d.expiration_at, d.expiration_ts)}
              </span>
            </div>
          )}

          {(d.departureFlightDate ||
            d.departureDate ||
            d.startFlightDate ||
            d.returnFlightDate ||
            d.endFlightDate) && (
            <div>
              <span className="text-gray-500">
                {t("moderation.flight_dates", {
                  defaultValue: "Даты рейса",
                })}
                :{" "}
              </span>
              <span className="font-medium">
                {pickFirst(
                  d.departureFlightDate,
                  d.departureDate,
                  d.startFlightDate
                ) || "—"}{" "}
                {(d.returnFlightDate || d.endFlightDate) && "→"}{" "}
                {pickFirst(d.returnFlightDate, d.endFlightDate) || ""}
              </span>
            </div>
          )}

          {flightType && (
            <div>
              <span className="text-gray-500">
                {t("moderation.flight_type", {
                  defaultValue: "Тип перелёта",
                })}
                :{" "}
              </span>
              <span className="font-medium">{flightType}</span>
            </div>
          )}

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

  const [tab, setTab] = useState("pending");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ pending: 0, rejected: 0 });
  const [proofViewer, setProofViewer] = useState(null);

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
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const approve = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/admin/services/${id}/approve`, {}, cfg);
      tSuccess(t("moderation.approved", { defaultValue: "Опубликовано" }));
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
    if (!reason || !reason.trim()) {
      return tInfo(
        t("moderation.enter_reason_short", {
          defaultValue: "Укажите причину",
        })
      );
    }

    try {
      await axios.post(
        `${API_BASE}/api/admin/services/${id}/reject`,
        { reason },
        cfg
      );
      tSuccess(t("moderation.rejected", { defaultValue: "Отклонено" }));
      setItems((prev) => prev.filter((x) => x.id !== id));
      setCounts((c) => ({
        ...c,
        pending: Math.max(0, (c.pending || 0) - 1),
        rejected: (c.rejected || 0) + 1,
      }));
    } catch {
      tError(t("moderation.reject_error", { defaultValue: "Ошибка reject" }));
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
    <>
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
                onOpenProof={setProofViewer}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      <ProofLightbox
        image={proofViewer}
        onClose={() => setProofViewer(null)}
      />
    </>
  );
}
