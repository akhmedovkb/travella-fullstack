// frontend/src/components/BookingRow.jsx

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import BookingHoldCountdown from "./BookingHoldCountdown";

/* ================= helpers ================= */

// Бумажный самолетик (телеграм)
const TelegramIcon = ({ className = "inline-block w-4 h-4 mr-1 align-[-1px]" }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    {/* перо из Feather (paper-plane / send) */}
    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// базовый конструктор ссылки на профиль
const buildProfileUrl = (kind, id) => {
  if (!id) return null;
  // kind: "provider" | "client"
  return `/profile/${kind}/${id}`;
};

// преобразует booking.attachments в массив [{url,name,type}]
const toFiles = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  // NEW: одно значение уже объектом → упакуем в массив
  if (typeof val === "object") return [val];
  try {
    const x = JSON.parse(val);
    if (Array.isArray(x)) return x;
    if (x && typeof x === "object") return [x];
  } catch {}
  return [];
};

// из "сырого" элемента формируем { url, name } с догадками про /uploads
const resolveFile = (raw) => {
  const f = typeof raw === "string" ? { url: raw } : (raw || {});
  const uploadsPath =
    (import.meta && import.meta.env && import.meta.env.VITE_UPLOADS_PUBLIC_PATH) || "/uploads";

  let url =
    f.url || f.href || f.src || f.path || f.dataUrl || f.downloadUrl || "";
  let name = f.name || f.filename || "";

  // если прилетела просто строка-имя (без / и без протокола) — считаем это именем файла
  const looksLikeBareName = (s) =>
    typeof s === "string" &&
    !/^https?:\/\//i.test(s) &&
    !/^data:/i.test(s) &&
    !s.startsWith("/") &&
    !s.includes("/");

  if (!url && name) {
    // нет url, но есть имя -> пробуем /uploads/<name>
    url = `${uploadsPath}/${name}`;
  } else if (looksLikeBareName(url)) {
    // url — это на самом деле просто имя файла
    name = name || url;
    url = `${uploadsPath}/${url}`;
  }

  // финальный абсолютный URL (добавит VITE_API_BASE_URL при необходимости)
  const abs = url ? makeAbsolute(url) : "";
  const finalName =
    name || (abs ? abs.split("?")[0].split("/").pop() : "file");
  return { url: abs, name: finalName };
};

// СТАТУСЫ "confirmed", "Отклонено: поставщиком услуги", "Отменено: вами"
const statusKey = (s) => String(s || "").toLowerCase();
const StatusPill = ({ status, text, className = "" }) => {
  const map = {
    pending:   "bg-amber-50  text-amber-700  ring-amber-200",
    quoted:    "bg-blue-50   text-blue-700   ring-blue-200",
    awaiting_payment: "bg-violet-50 text-violet-700 ring-violet-200",
    confirmed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    active:    "bg-emerald-50 text-emerald-700 ring-emerald-200",
    paid:      "bg-emerald-50 text-emerald-700 ring-emerald-200",
    rejected:  "bg-rose-50   text-rose-700   ring-rose-200",
    cancelled: "bg-rose-50   text-rose-700   ring-rose-200",
    cancelled_unpaid: "bg-gray-100 text-gray-700 ring-gray-200",
    expired:   "bg-gray-100 text-gray-700 ring-gray-200",
  };
  const cls = map[statusKey(status)] || "bg-gray-100 text-gray-700 ring-gray-200";
  return (
    <span className={`ml-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ring-1 ${cls} ${className}`}>
      {text ?? status}
    </span>
  );
};

function normalizeTg(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^https?:\/\//i.test(s)) return { label: s.replace(/^https?:\/\//i, ""), href: s };
  if (s.startsWith("@")) return { label: s, href: `https://t.me/${s.slice(1)}` };
  if (/^[A-Za-z0-9_]+$/.test(s)) return { label: `@${s}`, href: `https://t.me/${s}` };
  return { label: s, href: null };
}
const typeLabel = (raw, t) => {
  const r = String(raw || "").toLowerCase();
  if (!r) return "";
  if (r === "guide") return t("types.guide", { defaultValue: "Гид" });
  if (r === "transport") return t("types.transport", { defaultValue: "Транспорт" });
  if (r === "agent" || r === "agency") return t("types.agent", { defaultValue: "Турагент" });
  if (r === "hotel") return t("types.hotel", { defaultValue: "Отель" });
  return r;
};
const fmtPrice = (n) =>
  Number.isFinite(Number(n)) ? Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "";

const makeAbsolute = (url) => {
  if (!url) return "";
  const s = String(url);
  if (/^data:|^https?:\/\//i.test(s)) return s;
  const base = (import.meta && import.meta.env && import.meta.env.VITE_API_BASE_URL) || "";
  if (!base) return s;
  return `${base.replace(/\/+$/, "")}/${s.replace(/^\/+/, "")}`;
};
const initials = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const tourBuilderDetails = (booking) => {
  const details = booking?.details && typeof booking.details === "object"
    ? booking.details
    : booking?.attachments && typeof booking.attachments === "object"
      ? booking.attachments
      : {};
  const message = String(booking?.client_message || "");
  const legacy = message.match(/^\[TourBuilder\]\s*([^•]+)\s*•\s*PAX\s*(\d+)\s*•\s*([^•]+)$/i);
  const kind = String(details.tb_kind || details.type || legacy?.[1] || "").trim().toLowerCase();
  const adults = Number(details.pax_adult);
  const children = Number(details.pax_child);
  const structuredGuests = Number.isFinite(adults) || Number.isFinite(children)
    ? (Number.isFinite(adults) ? adults : 0) + (Number.isFinite(children) ? children : 0)
    : null;
  const guests = structuredGuests ?? (legacy?.[2] ? Number(legacy[2]) : null);
  const residency = String(details.resident_type || legacy?.[3] || "").trim().toLowerCase();
  const kindLabel = kind === "hotel" ? "Гостиница" : kind === "guide" ? "Гид" : kind === "transport" ? "Транспорт" : kind === "entry" ? "Входные билеты" : "";
  const parts = [kindLabel];
  if (Number.isFinite(guests)) parts.push(`Гостей: ${guests}`);
  if (residency === "nrs") parts.push("Тариф: для нерезидентов");
  if (residency === "res") parts.push("Тариф: для резидентов");
  return { kind, text: parts.filter(Boolean).join(" · ") || message || "—" };
};

const isImg = (u) => /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(String(u || ""));

async function downloadBookingDocument(bookingId, kind) {
  const token = localStorage.getItem("clientToken") || localStorage.getItem("providerToken") || localStorage.getItem("token");
  const base = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
  const isRoomingList = kind === "rooming-list";
  const extension = isRoomingList ? "xlsx" : "pdf";
  const response = await fetch(`${base}/api/bookings/${bookingId}/docs/${kind}.${extension}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.message || "Не удалось сформировать документ");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `booking-${bookingId}-${kind}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ================= component ================= */
export default function BookingRow({
  booking,
  viewerRole,            // 'provider' (входящие) | 'client' (исходящие у провайдера и кабинет клиента)
  needPriceForAccept,    // показать «Подтвердить» только при наличии provider_price
  hideAcceptIfQuoted = false, // скрыть «Подтвердить», если цена уже отправлена (ожидаем подтверждение заявителя)
  hideClientCancel,      // спрятать кнопку «Отмена» (когда надо)
  onAccept,
  onReject,
  onCancel,
  onHoldExpired,
  onPay,
  onRefund,
  embedded = false,
}) {
  const { t } = useTranslation();

  /* ---- контрагент (имя/контакты/тип) ---- */
  const counterpart = useMemo(() => {
    // для входящих у поставщика контрагент — клиент или провайдер-заявитель
    if (viewerRole === "provider") {
      const isRequested = !!booking.requester_provider_id || !!booking.requester_name;
      if (isRequested) {
        const tg = normalizeTg(booking.requester_telegram);
        return {
          title: booking.requester_name || t("bookings.requester", { defaultValue: "Заявитель" }),
          phone: booking.requester_phone || null,
          telegram: tg,
          extra: typeLabel(booking.requester_type, t),
        };
      }
      const tg = normalizeTg(booking.client_social || booking.client_telegram);
      return {
        title: booking.client_name || t("bookings.client", { defaultValue: "Клиент" }),
        phone: booking.client_phone || null,
        telegram: tg,
        extra: "",
      };
    }
    // для исходящих (я — провайдер-заявитель) и для клиента контрагент — поставщик услуги
    const tg = normalizeTg(booking.provider_social || booking.provider_telegram);
    return {
      title: booking.provider_name || t("bookings.provider", { defaultValue: "Поставщик" }),
      phone: booking.provider_phone || null,
      telegram: tg,
      extra: typeLabel(booking.provider_type, t),
    };
  }, [booking, viewerRole, t]);

  
  
// статусы броней - Подменяем подпись статуса с учётом роли зрителя и того, кем выполнено действие
const statusText = React.useMemo(() => {
  const s = String(booking?.status || "").toLowerCase();

  // Отклонено: у нас отклоняет только поставщик услуги
  if (s === "rejected") {
    return viewerRole === "provider"
      ? t("bookings.status_by.rejected.you")        // «Отклонено: вами»
      : t("bookings.status_by.rejected.provider");  // «Отклонено: поставщиком услуги»
  }

  // Отменено: клиент (в т.ч. заявитель-провайдер) может отменить сам
  if (s === "cancelled") {
    return viewerRole === "provider"
      ? t("bookings.status_by.cancelled.client")    // «Отменено: клиентом»
      : t("bookings.status_by.cancelled.you");      // «Отменено: вами»
  }

  // Оффер отправлен поставщиком — ждём подтверждения заявителя
 if (s === "quoted") {
   return t("bookings.status.quoted", { defaultValue: "ожидает подтверждения" });
 }
  
  // Базовые статусы
  return t(`bookings.status.${s}`, { defaultValue: s });
}, [booking?.status, viewerRole, t]);


    // Куда вести по клику на имени (профиль кого)
const profileHref = useMemo(() => {
  if (viewerRole === "provider") {
    // входящие у поставщика
    if (booking.requester_provider_id) {
      return buildProfileUrl("provider", booking.requester_provider_id); // заявитель-провайдер
    }
    return buildProfileUrl("client", booking.client_id); // обычный клиент
  }
  // исходящие у провайдера (и кабинет клиента) — идём к поставщику услуги
  return buildProfileUrl("provider", booking.provider_id);
}, [viewerRole, booking]);


  /* ---- аватар ----
     ВАЖНО: по просьбе — у провайдера-заявителя (viewerRole === 'client' на вкладке
     «Мои бронирования услуг») показываем ФОТО ПОСТАВЩИКА УСЛУГИ. */
  const avatarUrlRaw =
    viewerRole === "client"
      // провайдер-заявитель смотрит исходящие → фото поставщика услуги:
      ? (booking.provider_avatar_url ||
         booking.provider_photo ||
         booking.provider_image ||
         booking.provider_avatar ||
         booking.provider_picture ||
         null)
      : // входящие у поставщика:
        (booking.requester_provider_id
          ? (booking.requester_avatar_url || booking.requester_photo || null) // заявитель-провайдер
          : (booking.client_avatar_url || booking.client_photo || null));     // обычный клиент
  const avatarUrl = avatarUrlRaw ? makeAbsolute(avatarUrlRaw) : "";

  /* ---- статус и дата создания ---- */
  const createdAt = booking?.created_at
    ? new Date(booking.created_at)
    : null;
  const createdAtLabel = createdAt
    ? createdAt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
    : null;
  const alreadyQuoted = Number(booking?.provider_price) > 0;
  // Поставщик больше НЕ подтверждает входящие: блокируем всегда
  const canAccept =
    viewerRole !== "provider" &&
    String(booking?.status) === "pending" &&
    (!needPriceForAccept || alreadyQuoted) &&
    !hideAcceptIfQuoted;

  const canReject =
    viewerRole === "provider" &&
    String(booking?.status) === "pending" &&
    typeof onReject === "function";
  const canCancel = viewerRole !== "provider" && !hideClientCancel && String(booking?.status) === "pending";
  const isAwaitingPayment = viewerRole !== "provider" && String(booking?.status) === "awaiting_payment";
  const canPay = isAwaitingPayment && String(booking?.currency || "UZS").toUpperCase() === "UZS";
  const paymentCurrencyUnsupported = isAwaitingPayment && !canPay;
  const isPaidByRequester = viewerRole !== "provider" && String(booking.payment_status || "").toLowerCase() === "paid";
  const refundStatus = String(booking.refund_status || "").toLowerCase();
  const [documentError, setDocumentError] = React.useState("");
  const getDocument = async (kind) => {
    setDocumentError("");
    try { await downloadBookingDocument(booking.id, kind); }
    catch (error) { setDocumentError(error?.message || "Не удалось сформировать документ"); }
  };

  const dates = Array.isArray(booking?.dates) ? booking.dates : [];
  const tbDetails = useMemo(() => tourBuilderDetails(booking), [booking]);
  const isIncoming = viewerRole === "provider";
  const isHotelBooking = tbDetails.kind === "hotel";
  const attachments = useMemo(
    () => toFiles(booking?.attachments).map(resolveFile).filter((file) => file.url && file.name),
    [booking?.attachments]
  );

  return (
    <div className={embedded ? "bg-transparent" : "rounded-lg border border-gray-200 bg-white p-4"}>
      {/* Верхняя строка: #id · услуга · статус · дата создания */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <span className="text-gray-500">#{booking.id}</span>
        {booking.service_title ? <span className="text-gray-700">· {booking.service_title}</span> : null}
        {booking.status && booking.source !== "tour_builder" ? (
          <StatusPill
            status={booking.status}
            text={statusText ?? t(`status.${booking.status}`, { defaultValue: booking.status })}
          />
        ) : null}
        {statusKey(booking.status) === "awaiting_payment" && booking.hold_until ? (
          <BookingHoldCountdown holdUntil={booking.hold_until} onExpired={onHoldExpired} />
        ) : null}
        {String(booking.payment_status || "").toLowerCase() === "paid" ? (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
            {t("bookings.paid_via_payme", { defaultValue: "Оплачено через Payme" })}
          </span>
        ) : null}

        {/* добавлено: дата создания */}
        {createdAtLabel ? (
          <span className="inline-flex items-center rounded-full bg-gray-50 px-2.5 py-0.5 text-xs text-gray-500">
            {createdAtLabel}
          </span>
        ) : null}

        {/* цена/комментарий поставщика — бейдж справа, если есть */}
        {Number(booking?.provider_price) > 0 ? (
          <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700 ring-1 ring-emerald-200">
            <b>{fmtPrice(booking.provider_price)} {booking.currency || "USD"}</b>
            {booking.provider_note ? <span className="opacity-70">· {booking.provider_note}</span> : null}
          </span>
        ) : null}
      </div>

      <div className="grid gap-x-6 gap-y-4 border-t border-gray-100 pt-3 sm:grid-cols-2 xl:grid-cols-[1.35fr,1fr,0.8fr,1.5fr]">
        <div className="min-w-0">
          <div className="mb-2 text-xs font-semibold uppercase text-gray-400">
            {isIncoming
              ? t("bookings.customer", { defaultValue: "Заказчик" })
              : t("bookings.provider", { defaultValue: "Поставщик" })}
          </div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-semibold">
                  {initials(counterpart.title || booking.client_name || booking.provider_name || "U")}
                </div>
              )}
            </div>
            <div className="min-w-0">
              {profileHref ? (
                <Link to={profileHref} className="block truncate font-semibold hover:underline">
                  {counterpart.title}
                </Link>
              ) : (
                <div className="truncate font-semibold">{counterpart.title}</div>
              )}
              {counterpart.extra ? (
                <span className="mt-1 inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 ring-1 ring-indigo-200">
                  {counterpart.extra}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 text-xs font-semibold uppercase text-gray-400">
            {isIncoming
              ? t("bookings.customer_contacts", { defaultValue: "Контакты заказчика" })
              : t("bookings.provider_contacts", { defaultValue: "Контакты поставщика" })}
          </div>
          <div className="space-y-1 text-sm text-gray-700">
            {counterpart.phone ? (
              <a className="block truncate hover:underline" href={`tel:${counterpart.phone}`}>{counterpart.phone}</a>
            ) : null}
            {counterpart.telegram ? (
              counterpart.telegram.href ? (
                <a className="block truncate hover:underline" href={counterpart.telegram.href} target="_blank" rel="noreferrer">
                  <TelegramIcon /> {counterpart.telegram.label}
                </a>
              ) : (
                <span className="block truncate"><TelegramIcon /> {counterpart.telegram.label}</span>
              )
            ) : null}
            {!counterpart.phone && !counterpart.telegram ? <span className="text-gray-400">—</span> : null}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 text-xs font-semibold uppercase text-gray-400">
            {isHotelBooking
              ? t("bookings.stay_date", { defaultValue: "Дата проживания" })
              : t("bookings.service_date", { defaultValue: "Дата услуги" })}
          </div>
          <div className="text-sm text-gray-700">
            {dates.length
              ? dates.map((d) => new Date(d).toLocaleDateString(undefined, {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })).join(", ")
              : "—"}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-2 text-xs font-semibold uppercase text-gray-400">
            {isHotelBooking
              ? t("bookings.accommodation", { defaultValue: "Размещение" })
              : t("bookings.request_details", { defaultValue: "Детали заявки" })}
          </div>
          <div className="whitespace-pre-wrap break-words text-sm text-gray-700">
            {booking.source === "tour_builder" ? tbDetails.text : (booking.client_message || "—")}
          </div>
        </div>
      </div>

      {/* вложения (если есть), без заголовка */}
        {attachments.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {attachments.map(({ url, name }, i) => {
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
        ) : null}


      {/* действия */}
      {(canAccept || canReject || canCancel || canPay) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {canPay ? (
            <button
              onClick={() => onPay?.(booking)}
              className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-700"
            >
              {t("bookings.pay_now", { defaultValue: "Оплатить" })}
            </button>
          ) : null}
          {canAccept ? (
            <button
              onClick={() => onAccept?.(booking)}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700"
            >
              {t("actions.confirm", { defaultValue: "Подтвердить" })}
            </button>
          ) : null}

          {canReject ? (
            <button
              onClick={() => onReject?.(booking)}
              className="rounded-lg bg-red-100 px-4 py-2 text-red-700 ring-1 ring-red-200 hover:bg-red-200/40"
            >
              {t("actions.reject", { defaultValue: "Отклонить" })}
            </button>
          ) : null}

          {canCancel ? (
            <button
              onClick={() => onCancel?.(booking)}
              className="rounded-lg bg-gray-200 px-4 py-2 text-gray-800 hover:bg-gray-300"
            >
              {t("actions.cancel", { defaultValue: "Отмена" })}
            </button>
          ) : null}
        </div>
      ) : null}
      {paymentCurrencyUnsupported ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t("bookings.online_payment_uzs_only", {
            defaultValue: "Онлайн-оплата Payme доступна только для брони в UZS. Свяжитесь с поставщиком для другого способа оплаты.",
          })}
        </div>
      ) : null}
      {isPaidByRequester ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {refundStatus === "requested" ? <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Возврат запрошен, ожидается проверка</span> : null}
          {refundStatus === "processing" ? <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Запрос возврата принят в работу</span> : null}
          {refundStatus === "refunded" ? <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Оплата возвращена через Payme</span> : null}
          {refundStatus === "rejected" ? <span className="text-sm font-semibold text-rose-700">Предыдущий запрос отклонён</span> : null}
          {(!refundStatus || refundStatus === "rejected") && onRefund ? (
            <button type="button" onClick={() => onRefund(booking)} className="rounded-lg border border-rose-200 bg-white px-4 py-2 font-semibold text-rose-700 hover:bg-rose-50">
              {refundStatus === "rejected" ? "Отправить повторно" : "Запросить возврат"}
            </button>
          ) : null}
        </div>
      ) : null}
      {String(booking.payment_status || "").toLowerCase() === "paid" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => getDocument("invoice")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Инвойс PDF</button>
          <button type="button" onClick={() => getDocument("voucher")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Ваучер PDF</button>
          <button type="button" onClick={() => getDocument("rooming-list")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Rooming list XLSX</button>
          <button type="button" onClick={() => getDocument("itinerary")} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Itinerary PDF</button>
          {documentError ? <span className="text-sm text-rose-700">{documentError}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
