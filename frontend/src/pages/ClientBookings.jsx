// frontend/src/pages/ClientBookings.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { tSuccess, tError, tInfo } from "../shared/toast";

/* ========= helpers ========= */
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const getToken = () =>
  localStorage.getItem("clientToken") ||
  localStorage.getItem("token") ||
  localStorage.getItem("providerToken");
const cfg = () => ({ headers: { Authorization: `Bearer ${getToken()}` } });

const isFiniteNum = (n) => Number.isFinite(n) && !Number.isNaN(n);
const fmt = (n) =>
  isFiniteNum(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";

/** загрузчик */
async function fetchMyBookings() {
  const url = `${API_BASE}/api/bookings/my`;
  const res = await axios.get(url, cfg());
  return Array.isArray(res.data) ? res.data : res.data?.items || [];
}
/** точные вызовы API */
async function confirmBookingByClient(id) {
  await axios.post(`${API_BASE}/api/bookings/${id}/confirm`, {}, cfg());
}
async function cancelBookingByClient(id) {
  await axios.post(`${API_BASE}/api/bookings/${id}/cancel`, {}, cfg());
}

/* ========= форматирование ========= */
const toYMD = (s) => String(s || "").slice(0, 10);
const ymdToDate = (ymd) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};
const formatDate = (ymd) => {
  try {
    const dt = ymdToDate(ymd);
    return dt
      ? dt.toLocaleDateString(undefined, {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : ymd;
  } catch {
    return ymd;
  }
};
const formatDateRange = (dates) => {
  if (!Array.isArray(dates) || !dates.length) return "";
  const a = toYMD(dates[0]);
  const b = toYMD(dates[1] || dates[0]);
  return a === b ? formatDate(a) : `${formatDate(a)}, ${formatDate(b)}`;
};
const maxDateYMD = (dates) => {
  if (!Array.isArray(dates) || !dates.length) return null;
  return [...dates.map(toYMD)].sort().pop() || null;
};
const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const cx = (...arr) => arr.filter(Boolean).join(" ");
const statusKey = (s) => String(s || "").toLowerCase();
/** локализованный label статуса */
const statusLabel = (s, t) =>
  ({
    pending: t("status.pending", { defaultValue: "ожидает" }),
    confirmed: t("status.confirmed", { defaultValue: "подтверждено" }),
    active: t("status.active", { defaultValue: "активно" }),
    rejected: t("status.rejected", { defaultValue: "отклонено" }),
    cancelled: t("status.cancelled", { defaultValue: "отменено" }),
  }[statusKey(s)] || s);

/* ========= иконки ========= */
const Icon = ({ name, className = "w-5 h-5" }) => {
  switch (name) {
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path
            d="M7 2v3M17 2v3M3 9h18M5 5h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      );
    case "phone":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path
            d="M4 5c0-1 1-2 2-2h2l2 4-2 2c1 2 3 4 5 5l2-2 4 2v2c0 1-1 2-2 2 0 0-9 1-15-11Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      );
    case "tg":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor">
          <path d="M9.5 15.3l-.2 3.2c.3 0 .5-.1.6-.3l1.5-1.4 3.1 2.2c.6.3 1 .1 1.1-.6l2-12c.2-.9-.3-1.3-1-1L3.8 9.9c-.9.3-.9.8-.2 1l3.8 1.2 8.8-5.5-6.4 6.5-.3 1.2Z" />
        </svg>
      );
    case "refresh":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path
            d="M20 12a8 8 0 1 1-2.34-5.66L20 8M20 8V3m0 5h-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "compact":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path
            d="M4 6h16M4 12h10M4 18h7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "pdf":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12V8l-4-6Z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M9 15h1.5a2 2 0 1 0 0-4H9v4Zm5-4h2v4h-2Zm5 0h-1.5v4H19"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "search":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M20 20l-3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return null;
  }
};

// бейдж со своим текстом при необходимости
const StatusBadge = ({ status, text: override }) => {
  const { t } = useTranslation();
  const s = statusKey(status);
  const map = {
    pending: {
      text: t("status.pending", { defaultValue: "ожидает" }),
      cls: "bg-amber-50 text-amber-700 ring-amber-200",
    },
    confirmed: {
      text: t("status.confirmed", { defaultValue: "подтверждено" }),
      cls: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    },
    active: {
      text: t("status.active", { defaultValue: "активно" }),
      cls: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    },
    rejected: {
      text: t("status.rejected", { defaultValue: "отклонено" }),
      cls: "bg-rose-50 text-rose-700 ring-rose-200",
    },
    cancelled: {
      text: t("status.cancelled", { defaultValue: "отменено" }),
      cls: "bg-gray-100 text-gray-600 ring-gray-200",
    },
  };
  const { text, cls } =
    map[s] || {
      text: s,
      cls: "bg-gray-100 text-gray-700 ring-gray-200",
    };
  return (
    <span className={cx("inline-flex items-center px-2 py-0.5 rounded-full text-xs ring-1", cls)}>
      {override || text}
    </span>
  );
};

/* ==== тип поставщика: бейдж + нормализация ==== */
const normalizeProviderType = (t) => {
  const s = String(t || "").toLowerCase();
  if (s.includes("guide") || s.includes("гид")) return "guide";
  if (s.includes("transport") || s.includes("driver") || s.includes("транспорт"))
    return "transport";
  if (s.includes("agency") || s.includes("agent") || s.includes("тураг")) return "agency";
  if (s.includes("hotel") || s.includes("отел")) return "hotel";
  return s || "provider";
};

const ProviderTypeBadge = ({ type }) => {
  const { t } = useTranslation();
  const key = normalizeProviderType(type);
  const map = {
    guide: "bg-sky-50 text-sky-700 ring-sky-200",
    transport: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    agency: "bg-violet-50 text-violet-700 ring-violet-200",
    hotel: "bg-teal-50 text-teal-700 ring-teal-200",
    provider: "bg-gray-100 text-gray-700 ring-gray-200",
  };
  const text =
    {
      guide: t("provider.types.guide", { defaultValue: "гид" }),
      transport: t("provider.types.transport", { defaultValue: "транспорт" }),
      agency: t("provider.types.agent", { defaultValue: "турагент" }),
      hotel: t("provider.types.hotel", { defaultValue: "отель" }),
      provider: t("roles.provider", { defaultValue: "поставщик" }),
    }[key] || key;

  return (
    <span className={cx("ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1", map[key])}>
      {text}
    </span>
  );
};

/* ========= основная страница ========= */
export default function ClientBookings() {
  const { t } = useTranslation();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);

  // фильтры/поиск/режим — 5 штук
  const FILTERS = useMemo(
    () => [
      { key: "all", label: t("bookings.filters.all", { defaultValue: "Все" }) },
      { key: "pending", label: t("bookings.filters.pending", { defaultValue: "Ожидают" }) },
      {
        key: "confirmed",
        label: t("bookings.filters.confirmed", { defaultValue: "Подтверждено" }), // confirmed + active
      },
      {
        key: "upcoming",
        label: t("bookings.filters.upcoming", { defaultValue: "Предстоящие" }), // confirmed/active + в будущем
      },
      { key: "rejected", label: t("bookings.filters.rejected", { defaultValue: "Отклонено" }) }, // rejected + cancelled
    ],
    [t]
  );
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const setByMedia = () => setCompact(mq.matches);
    setByMedia();
    mq.addEventListener?.("change", setByMedia);
    return () => mq.removeEventListener?.("change", setByMedia);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await fetchMyBookings();
      setList(rows);
    } catch (e) {
      console.error("load client bookings failed", e);
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener("client:bookings:refresh", onRefresh);
    return () => window.removeEventListener("client:bookings:refresh", onRefresh);
  }, []);

  const confirm = async (b) => {
    setActingId(b.id);
    try {
      await confirmBookingByClient(b.id);
      tSuccess(t("bookings.confirmed", { defaultValue: "Бронирование подтверждено" }));
      await load();
    } catch (e) {
      console.warn("confirm failed:", e);
      tError(
        e?.response?.data?.message ||
          t("bookings.confirm_error", { defaultValue: "Ошибка подтверждения" })
      );
    } finally {
      setActingId(null);
    }
  };

  const reject = async (b) => {
    setActingId(b.id);
    try {
      await cancelBookingByClient(b.id);
      tInfo(t("bookings.rejected", { defaultValue: "Бронирование отклонено" }));
      await load();
    } catch (e) {
      console.warn("reject failed:", e);
      tError(
        e?.response?.data?.message ||
          t("bookings.reject_error", { defaultValue: "Ошибка отклонения" })
      );
    } finally {
      setActingId(null);
    }
  };

  // ===== counters + "upcoming"
  const counts = useMemo(() => {
    const c = { all: list.length, pending: 0, confirmed: 0, upcoming: 0, rejected: 0 };
    const todayYMD = toYMD(new Date().toISOString());
    for (const b of list) {
      const s = statusKey(b.status);
      if (s === "pending") c.pending++;
      if (s === "confirmed" || s === "active") c.confirmed++;
      if (s === "rejected" || s === "cancelled") c.rejected++;
      const last = maxDateYMD(b.dates);
      if ((s === "confirmed" || s === "active") && last && last >= todayYMD) c.upcoming++;
    }
    return c;
  }, [list]);

  const filteredByStatus = useMemo(() => {
    const todayYMD = toYMD(new Date().toISOString());
    return list.filter((b) => {
      const s = statusKey(b.status);
      if (filter === "all") return true;
      if (filter === "pending") return s === "pending";
      if (filter === "confirmed") return s === "confirmed" || s === "active";
      if (filter === "rejected") return s === "rejected" || s === "cancelled";
      if (filter === "upcoming") {
        const last = maxDateYMD(b.dates);
        return (s === "confirmed" || s === "active") && last && last >= todayYMD;
      }
      return true;
    });
  }, [list, filter]);

  const visibleList = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return filteredByStatus;
    return filteredByStatus.filter((b) => {
      const providerName =
        b.provider_name ||
        b.provider?.name ||
        b.service?.provider_name ||
        b.service?.providerTitle ||
        "";
      const serviceTitle = b.service_title || b.service?.title || "";
      const note = b.provider_note || b.client_message || "";
      const s = statusLabel(b.status, t);
      return (
        providerName.toLowerCase().includes(q) ||
        serviceTitle.toLowerCase().includes(q) ||
        note.toLowerCase().includes(q) ||
        String(b.id).includes(q) ||
        s.toLowerCase().includes(q)
      );
    });
  }, [filteredByStatus, query, t]);

  /* ===== экспорт в PDF (печать) ===== */
  const buildPrintHtml = (rows, t) => {
    const now = new Date().toLocaleString();
    const items = rows
      .map((b) => {
        const provider =
          b.provider_name ||
          b.provider?.name ||
          b.service?.provider_name ||
          b.service?.providerTitle ||
          "—";
        const title =
          b.service_title ||
          b.service?.title ||
          t("booking.title", { defaultValue: "Бронирование" });
        const dates = formatDateRange(b.dates);
        const price = b.provider_price
          ? `${fmt(Number(b.provider_price))} ${b.currency || "USD"}`
          : "—";
        const note = b.provider_note ? ` · ${b.provider_note}` : "";
        const pType = {
          guide: t("provider.types.guide", { defaultValue: "гид" }),
          transport: t("provider.types.transport", { defaultValue: "транспорт" }),
          agency: t("provider.types.agent", { defaultValue: "турагент" }),
          hotel: t("provider.types.hotel", { defaultValue: "отель" }),
          provider: t("roles.provider", { defaultValue: "поставщик" }),
        }[normalizeProviderType(b.provider_type)]!;
        const confirmedAt =
          ["confirmed", "active"].includes(statusKey(b.status))
            ? formatDate(toYMD(b.updated_at))
            : "";
        const confirmedLine = confirmedAt
          ? ` · ${t("bookings.pdf.confirmed_at", {
              defaultValue: "подтверждено",
            })} ${confirmedAt}`
          : "";
        return `
          <div class="card">
            <div class="hdr">
              <div class="num">#${b.id}</div>
              <div class="status ${statusKey(b.status)}">${statusLabel(b.status, t)}${confirmedLine}</div>
            </div>
            <div class="line"><span class="lbl">${t("booking.service", { defaultValue: "Услуга:" })}</span> ${title}</div>
            <div class="line"><span class="lbl">${t("booking.provider", { defaultValue: "Поставщик:" })}</span> ${provider} (${pType})</div>
            <div class="line"><span class="lbl">${t("bookings.dates_label", { defaultValue: "Даты забронированы:" })}</span> ${dates || "—"}</div>
            <div class="line"><span class="lbl">${t("booking.offer", { defaultValue: "Предложение:" })}</span> <b>${price}</b>${note}</div>
            ${
              b.client_message
                ? `<div class="line"><span class="lbl">${t("common.comment", { defaultValue: "Комментарий" })}:</span> ${b.client_message}</div>`
                : ""
            }
          </div>`;
      })
      .join("");
    return `<!DOCTYPE html>
<html lang="ru">
<meta charset="utf-8">
<title>${t("tabs.my_bookings", { defaultValue: "Мои бронирования" })} — PDF</title>
<style>
  *{box-sizing:border-box} body{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial;color:#111;margin:24px;background:#fff}
  h1{font-size:20px;margin:0 0 6px} .meta{color:#666;margin-bottom:18px}
  .card{border:1px solid #e5e7eb;border-radius:14px;padding:14px;margin:0 0 12px;background:#fff;break-inside:avoid}
  .hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
  .num{color:#6b7280}
  .status{padding:2px 8px;border-radius:999px;font-size:12px;border:1px solid}
  .status.pending{background:#fff7ed;color:#92400e;border-color:#fed7aa}
  .status.confirmed,.status.active{background:#ecfdf5;color:#065f46;border-color:#a7f3d0}
  .status.rejected{background:#fff1f2;color:#9f1239;border-color:#fecdd3}
  .status.cancelled{background:#f3f4f6;color:#374151;border-color:#e5e7eb}
  .line{margin:4px 0}
  .lbl{color:#6b7280;margin-right:6px}
  @page{margin:16mm}
  @media print {.no-print{display:none}}
</style>
<body>
  <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <h1>${t("tabs.my_bookings", { defaultValue: "Мои бронирования" })}</h1>
    <button onclick="window.print()" style="padding:6px 10px;border:1px solid #ddd;border-radius:10px;background:#fff;cursor:pointer">
      ${t("common.print_pdf", { defaultValue: "Печать / PDF" })}
    </button>
  </div>
  <div class="meta">${t("bookings.pdf.generated_at", { defaultValue: "Сформировано" })}: ${now}. ${t("bookings.pdf.total", { defaultValue: "Всего" })}: ${rows.length}</div>
  ${items || `<div>${t("empty.no_bookings", { defaultValue: "Пусто" })}</div>`}
</body></html>`;
  };

  const exportPdf = () => {
    const html = buildPrintHtml(visibleList, t);
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      alert(
        t("bookings.allow_popups_pdf", {
          defaultValue: "Разрешите всплывающие окна для экспорта в PDF.",
        })
      );
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
  };

  /* ========= UI ========= */

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="animate-pulse border rounded-2xl p-4 bg-white">
              <div className="h-5 w-1/3 bg-gray-200 rounded mb-3" />
              <div className="h-4 w-2/3 bg-gray-200 rounded mb-2" />
              <div className="h-4 w-1/2 bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      );
    }
    if (!visibleList.length) {
      return (
        <div className="text-gray-500">
          {t("bookings.empty", { defaultValue: "Пока нет бронирований." })}
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {visibleList.map((b) => {
          const providerName =
            b.provider_name ||
            b.provider?.name ||
            b.service?.provider_name ||
            b.service?.providerTitle;
          const providerPhone = b.provider_phone || b.provider?.phone;
          const providerTg = b.provider_telegram || b.provider?.telegram || b.provider?.social;
          const status = statusKey(b.status);
          const dateText = formatDateRange(b.dates);
          const hasPrice =
            isFiniteNum(Number(b?.provider_price)) && Number(b.provider_price) > 0;
          const lastOffer = hasPrice
            ? `${fmt(Number(b.provider_price))} ${b.currency || "USD"}`
            : null;

          // URL публичного профиля провайдера
          const profileUrl = `/profile/provider/${b.provider_id}`;

          // фото поставщика — берём первое непустое поле из возможных источников
          const providerPhoto = [
            b.provider_avatar_url,
            b.provider_photo,
            b.provider?.avatar_url,
            b.provider?.photo,
            b.provider?.avatar,
            b.provider?.image_url,
            b.provider?.image,
            b.provider?.photos?.[0],
            b.service?.providerPhoto,
            b.service?.provider_avatar_url,
            b.service?.providerAvatar,
          ].find((x) => x && String(x).trim());

          // дата подтверждения (после бейджа)
          const confirmedAt =
            ["confirmed", "active"].includes(status) && b.updated_at
              ? formatDate(toYMD(b.updated_at))
              : null;

          // кем отменено/отклонено — прямо в верхнем бейдже
          const statusTextOverride =
            status === "cancelled"
              ? t("bookings.cancelled.by_you", { defaultValue: "Отменено: вами" })
              : status === "rejected"
              ? t("bookings.rejected.by_provider", {
                  defaultValue: "Отклонено: поставщиком услуги",
                })
              : null;

          return (
            <div
              key={b.id}
              className={cx("border rounded-2xl bg-white shadow-sm", compact ? "p-3" : "p-4")}
            >
              {/* header */}
              <div className={cx("flex justify-between gap-3", compact ? "items-center" : "items-start")}>
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={
                      (compact ? "w-9 h-9" : "w-10 h-10") +
                      " rounded-full overflow-hidden bg-indigo-600 text-white grid place-items-center shrink-0"
                    }
                  >
                    {providerPhoto ? (
                      <img
                        src={providerPhoto}
                        alt={providerName || "provider"}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <span className="font-semibold">{initials(providerName || "P")}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className={cx("text-gray-500 truncate", compact ? "text-xs" : "text-sm")}>
                      #{b.id} ·{" "}
                      {b.service_title ||
                        b.service?.title ||
                        t("booking.title", { defaultValue: "Бронирование" })}{" "}
                      · <StatusBadge status={status} text={statusTextOverride || undefined} />
                      {confirmedAt ? (
                        <span className="ml-2 text-gray-500">{confirmedAt}</span>
                      ) : null}
                    </div>

                    {/* ИМЯ → кликабельно + тип */}
                    <div className={cx("text-gray-900 font-semibold truncate", compact ? "text-sm" : "")}>
                      <a href={profileUrl} className="hover:underline">
                        {providerName || "—"}
                      </a>
                      <ProviderTypeBadge type={b.provider_type} />
                    </div>

                    <div
                      className={cx(
                        "text-gray-700 flex items-center gap-3",
                        compact ? "text-xs mt-0.5" : "text-sm mt-1"
                      )}
                    >
                      {providerPhone && (
                        <a
                          className="hover:underline inline-flex items-center gap-1"
                          href={`tel:${String(providerPhone).replace(/[^+\d]/g, "")}`}
                        >
                          <Icon name="phone" className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />{" "}
                          {providerPhone}
                        </a>
                      )}
                      {providerTg && (
                        <a
                          className="hover:underline inline-flex items-center gap-1"
                          href={
                            /^https?:\/\//i.test(providerTg)
                              ? providerTg
                              : `https://t.me/${String(providerTg).replace(/^@/, "")}`
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Icon name="tg" className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />{" "}
                          {String(providerTg).startsWith("@")
                            ? providerTg
                            : `@${String(providerTg).replace(/^@/, "")}`}
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* price chip */}
                {lastOffer && (
                  <div className="shrink-0">
                    <div
                      className={cx(
                        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
                        compact && "text-sm px-2 py-1"
                      )}
                    >
                      <span className="font-semibold">{lastOffer}</span>
                      {b.provider_note ? (
                        <span className="text-emerald-800/70">· {b.provider_note}</span>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>

              {/* dates */}
              <div className={cx("inline-flex items-center gap-2 text-gray-700 mt-3", compact ? "text-xs" : "text-sm")}>
                <Icon name="calendar" className={compact ? "w-4 h-4" : "w-5 h-5"} />
                <span className="font-medium">
                  {t("bookings.dates_label", { defaultValue: "Даты забронированы:" })}
                </span>
                <span>{dateText || "—"}</span>
              </div>

              {/* client message */}
              {b.client_message && (
                <div className={cx("text-gray-700 mt-2", compact ? "text-xs" : "text-sm")}>
                  <span className="text-gray-500">
                    {t("common.comment", { defaultValue: "Комментарий" })}:
                  </span>{" "}
                  {b.client_message}
                </div>
              )}

              {/* вложения (если есть), без заголовка */}
              {(() => {
                const toFiles = (val) => {
                  if (!val) return [];
                  if (Array.isArray(val)) return val;
                  try {
                    const x = JSON.parse(val);
                    if (Array.isArray(x)) return x;
                    if (x && typeof x === "object") return [x];
                  } catch {}
                  return [];
                };
                const isImg = (u) =>
                  /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(String(u || ""));
                const makeAbsolute = (url) => {
                  if (!url) return "";
                  const s = String(url);
                  if (/^data:|^https?:\/\//i.test(s)) return s;
                  const base = import.meta?.env?.VITE_API_BASE_URL || "";
                  return base
                    ? `${base.replace(/\/+$/, "")}/${s.replace(/^\/+/, "")}`
                    : s;
                };
                const files = toFiles(b.attachments);
                if (!files.length) return null;
                return (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {files.map((raw, i) => {
                      const f = typeof raw === "string" ? { url: raw } : raw || {};
                      const url = makeAbsolute(f.url || f.src || f.href || "");
                      const name =
                        f.name ||
                        f.filename ||
                        (url ? url.split("?")[0].split("/").pop() : "file");
                      if (!url) return null;
                      return isImg(url) ? (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="block h-20 w-28 overflow-hidden rounded border bg-gray-50"
                          title={name}
                        >
                          <img src={url} alt={name} className="h-full w-full object-cover" />
                        </a>
                      ) : (
                        <a
                          key={i}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border bg-gray-50 px-2 py-1 text-sm hover:bg-gray-100"
                        >
                          {name}
                        </a>
                      );
                    })}
                  </div>
                );
              })()}

              {/* pending без цены → информируем, что ждём предложение */}
              {status === "pending" && !hasPrice && (
                <div
                  className={cx(
                    "mt-3 px-3 py-2 rounded-lg border bg-amber-50 border-amber-200 text-amber-700",
                    compact ? "text-xs" : "text-sm"
                  )}
                >
                  {t("bookings.wait_price", {
                    defaultValue: "Ожидаем предложение цены от поставщика",
                  })}
                </div>
              )}

              {/* actions — только пока pending */}
              {status === "pending" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {hasPrice && (
                    <button
                      onClick={() => confirm(b)}
                      disabled={actingId === b.id}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
                    >
                      {t("actions.confirm", { defaultValue: "Подтвердить" })}
                    </button>
                  )}
                  <button
                    onClick={() => reject(b)}
                    disabled={actingId === b.id}
                    className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60"
                  >
                    {t("actions.reject", { defaultValue: "Отклонить" })}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }, [visibleList, loading, actingId, t, compact]);

  return (
    <div>
      {/* ШАПКА */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">
          {t("tabs.my_bookings", { defaultValue: "Мои бронирования" })}
        </h2>

        <div className="flex items-center gap-2 w/full sm:w-auto">
          {/* Поиск */}
          <div className="relative flex-1 sm:flex-none">
            <Icon name="search" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("bookings.search.placeholder", {
                defaultValue: "Поиск: поставщик, услуга, статус…",
              })}
              className="w-full sm:w-72 pl-9 pr-3 py-2 rounded-lg border border-gray-200 bg-white outline-none focus:ring-2 ring-indigo-100"
            />
          </div>

          <button
            onClick={() => setCompact((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            title={t("bookings.view.compact", { defaultValue: "Компактный режим" })}
          >
            <Icon name="compact" className="w-4 h-4" />
            <span className="hidden sm:inline">
              {compact
                ? t("bookings.view.normal", { defaultValue: "Обычный" })
                : t("bookings.view.compact", { defaultValue: "Компактный" })}
            </span>
          </button>
          <button
            onClick={exportPdf}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            title={t("common.export_pdf", { defaultValue: "Экспорт в PDF" })}
          >
            <Icon name="pdf" className="w-4 h-4" />
            <span className="hidden sm:inline">{t("common.pdf", { defaultValue: "PDF" })}</span>
          </button>
        </div>
      </div>

      {/* ФИЛЬТРЫ */}
      <div className="mb-4 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const counter = f.key === "all" ? counts.all : counts[f.key] || 0;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cx(
                  "px-3 py-1.5 rounded-full text-sm ring-1 transition whitespace-nowrap",
                  active
                    ? "bg-indigo-600 text-white ring-indigo-600"
                    : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"
                )}
              >
                {f.label}
                <span
                  className={cx(
                    "ml-2 inline-flex items-center justify-center rounded-full px-1.5 text-xs",
                    active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-700"
                  )}
                >
                  {counter}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {content}
    </div>
  );
}
