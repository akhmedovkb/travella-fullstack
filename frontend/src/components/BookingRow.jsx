//frontend/src/components/BookingRow.jsx

import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

/* ===== helpers ===== */
const cx = (...a) => a.filter(Boolean).join(" ");
const toYMD = (s) => String(s || "").slice(0, 10);
const initials = (name = "") =>
  name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

const statusKey = (s) => String(s || "").toLowerCase();
const formatLocalDate = (iso) => {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  } catch { return null; }
};

function normalizeTg(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^https?:\/\//i.test(s)) return { label: s.replace(/^https?:\/\//i, ""), href: s };
  const nick = s.replace(/^@/, "");
  return { label: `@${nick}`, href: `https://t.me/${nick}` };
}

const typeLabel = (raw, t) => {
  const s = String(raw ?? "").toLowerCase();
  const byCode = { "1": "agent", "2": "guide", "3": "transport", "4": "hotel" };
  const key = byCode[s] || (["agent","guide","transport","hotel"].includes(s) ? s :
              s.includes("guide") ? "guide" :
              s.includes("trans") ? "transport" :
              s.includes("hotel") ? "hotel" : "agent");
  const fallback = { agent:"Турагент", guide:"Гид", transport:"Транспорт", hotel:"Отель" }[key];
  return t(`provider.types.${key}`, { defaultValue: fallback });
};

const ProviderTypeBadge = ({ label }) => (
  <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 bg-indigo-50 text-indigo-700 ring-indigo-200">
    {label}
  </span>
);

/* icons */
const Icon = ({ name, className="w-4 h-4" }) => {
  switch (name) {
    case "phone":
      return <svg viewBox="0 0 24 24" className={className} fill="none">
        <path d="M4 5c0-1 1-2 2-2h2l2 4-2 2c1 2 3 4 5 5l2-2 4 2v2c0 1-1 2-2 2 0 0-9 1-15-11Z" stroke="currentColor" strokeWidth="1.5"/>
      </svg>;
    case "tg":
      return <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M9.5 15.3l-.2 3.2c.3 0 .5-.1.6-.3l1.5-1.4 3.1 2.2c.6.3 1 .1 1.1-.6l2-12c.2-.9-.3-1.3-1-1L3.8 9.9c-.9.3-.9.8-.2 1l3.8 1.2 8.8-5.5-6.4 6.5-.3 1.2Z"/>
      </svg>;
    case "calendar":
      return <svg viewBox="0 0 24 24" className={className} fill="none">
        <path d="M7 2v3M17 2v3M3 9h18M5 5h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5"/>
      </svg>;
    default: return null;
  }
};

const StatusBadge = ({ status, text }) => {
  const s = statusKey(status);
  const map = {
    pending:   { txt: "ожидает",      cls: "bg-amber-50 text-amber-700 ring-amber-200" },
    confirmed: { txt: "подтверждено", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    active:    { txt: "подтверждено", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    rejected:  { txt: "отклонено",    cls: "bg-rose-50 text-rose-700 ring-rose-200" },
    cancelled: { txt: "отменено",     cls: "bg-gray-100 text-gray-600 ring-gray-200" },
  };
  const { txt, cls } = map[s] || { txt: s, cls:"bg-gray-100 text-gray-700 ring-gray-200" };
  return (
    <span className={cx("inline-flex items-center px-2 py-0.5 rounded-full text-xs ring-1", cls)}>
      {text || txt}
    </span>
  );
};

/* ===== component ===== */
export default function BookingRow({
  booking,
  viewerRole,                // 'provider' | 'client'
  onAccept = () => {},
  onReject = () => {},
  onCancel = () => {},
  needPriceForAccept = false,
  hideAcceptIfQuoted = false, // если уже отправили цену, скрыть «Подтвердить»
  hideClientCancel = false,   // не используется теперь (кнопки внизу)
  rejectedByLabel = null,     // «кем отклонено»
  cancelledByLabel = null,    // «кем отменено»
}) {
  const { t } = useTranslation();

  // Контрагент (для поставщика это клиент или заявитель-провайдер)
  const cp = useMemo(() => {
    if (viewerRole === "provider") {
      const isRequesterProvider = !!booking.requester_provider_id || !!booking.requester_name;
      const name = (!isRequesterProvider && (booking.client_name || booking.requester_name)) || booking.requester_name || t("roles.client", { defaultValue: "Клиент" });
      const href =
        booking.client_id ? `/profile/client/${booking.client_id}` :
        booking.requester_provider_id ? `/profile/provider/${booking.requester_provider_id}` :
        booking.requester_url || null;
      const phone = isRequesterProvider ? booking.requester_phone : (booking.client_phone || booking.requester_phone);
      const tg = normalizeTg(isRequesterProvider ? booking.requester_telegram : (booking.client_social || booking.requester_telegram));
      const typeLbl = isRequesterProvider ? typeLabel(booking.requester_type || "agent", t) : null;
           // фото клиента (или заявителя-провайдера, если когда-нибудь добавите)
      const avatarUrl =
        (!isRequesterProvider && (booking.client_avatar_url || booking.client_photo)) ||
        (isRequesterProvider && (booking.requester_avatar_url || booking.requester_photo)) ||
        null;
      return { name, href, phone, tg, typeLbl, avatarUrl, avatarName: name || "C" };
    }
    // viewer as "client" — показываем поставщика
    const name = booking.provider_name || t("roles.provider", { defaultValue: "Поставщик" });
    const href = booking.provider_id ? `/profile/provider/${booking.provider_id}` : null;
    const phone = booking.provider_phone || null;
    const tg = normalizeTg(booking.provider_social);
    const typeLbl = typeLabel(booking.provider_type, t);
        // фото поставщика услуги
    const avatarUrl = booking.provider_photo || booking.provider_avatar_url || null;
    return { name, href, phone, tg, typeLbl, avatarUrl, avatarName: name || "P" };
  }, [booking, viewerRole, t]);

  const status = statusKey(booking.status);
  const hasPrice = Number(booking?.provider_price) > 0;
  const serviceTitle = booking.service_title || t("common.service", { defaultValue: "услуга" });
  const bookedDates = (booking.dates || []).map(toYMD);
  const bookedText = bookedDates.length
    ? (bookedDates.length === 1
        ? new Date(bookedDates[0]).toLocaleDateString(undefined, { day:"2-digit", month:"short", year:"numeric" })
        : `${new Date(bookedDates[0]).toLocaleDateString(undefined, { day:"2-digit", month:"short", year:"numeric" })}, ${
            new Date(bookedDates[bookedDates.length - 1]).toLocaleDateString(undefined, { day:"2-digit", month:"short", year:"numeric" })
          }`)
    : "—";
  const confirmedAt = (status === "confirmed" || status === "active") ? formatLocalDate(booking.updated_at) : null;

  // статусный текст с «кем»
  const statusOverride =
    status === "rejected"  ? `${t("bookings.rejected_by", { defaultValue:"Отклонено" })}: ${rejectedByLabel || ""}` :
    status === "cancelled" ? `${t("bookings.cancelled_by", { defaultValue:"Отменено" })}: ${cancelledByLabel || ""}` : null;

  // attachments → чипами
  let attachments = [];
  try {
    const raw = booking.attachments;
    const arr = Array.isArray(raw) ? raw : (typeof raw === "string" ? JSON.parse(raw) : []);
    attachments = arr
      .map((a) => (typeof a === "string" ? { url: a } : a || {}))
      .filter((a) => a && (a.url || a.href));
  } catch { attachments = []; }

  // действия (для входящих у поставщика)
  const canAct = viewerRole === "provider" && status === "pending";
  const showAccept =
    canAct && (!needPriceForAccept || hasPrice) && !(hideAcceptIfQuoted && hasPrice);
  const showReject = canAct;

  return (
    <div className="rounded-2xl border bg-white shadow-sm p-4">
      {/* header */}
      <div className="flex justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 shrink-0 rounded-full overflow-hidden bg-indigo-600 text-white grid place-items-center">
            {cp.avatarUrl ? (
              <img
                src={cp.avatarUrl}
                alt={cp.name || "avatar"}
                className="w-full h-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="font-semibold">{initials(cp.avatarName)}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm text-gray-500 truncate">
              #{booking.id} · {serviceTitle} ·{" "}
              <StatusBadge status={status} text={statusOverride || undefined} />
              {confirmedAt ? <span className="ml-2 text-gray-500">{confirmedAt}</span> : null}
            </div>
            <div className="text-gray-900 font-semibold truncate">
              {cp.href ? <a href={cp.href} className="hover:underline">{cp.name}</a> : cp.name}
              {cp.typeLbl ? <ProviderTypeBadge label={cp.typeLbl} /> : null}
            </div>
            <div className="text-sm text-gray-700 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              {cp.phone && (
                <a className="inline-flex items-center gap-1 hover:underline" href={`tel:${String(cp.phone).replace(/[^+\d]/g,"")}`}>
                  <Icon name="phone" /> {cp.phone}
                </a>
              )}
              {cp.tg?.label && (
                <a className="inline-flex items-center gap-1 hover:underline" href={cp.tg.href} target="_blank" rel="noreferrer">
                  <Icon name="tg" /> {cp.tg.label}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* price pill */}
        {hasPrice && (
          <div className="shrink-0">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
              <span className="font-semibold">
                {Number(booking.provider_price).toLocaleString(undefined, { maximumFractionDigits: 2 })} {booking.currency || "USD"}
              </span>
              {booking.provider_note ? <span className="text-emerald-800/70">· {booking.provider_note}</span> : null}
            </div>
          </div>
        )}
      </div>

      {/* dates */}
      <div className="mt-3 inline-flex items-center gap-2 text-sm text-gray-700">
        <Icon name="calendar" className="w-5 h-5" />
        <span className="font-medium">{t("bookings.booked_dates", { defaultValue:"Даты забронированы" })}:</span>
        <span>{bookedText}</span>
      </div>

      {/* сообщение клиента (если есть) */}
      {booking.client_message && (
        <div className="mt-2 text-sm text-gray-700">
          <span className="text-gray-500">{t("common.comment", { defaultValue:"Комментарий" })}:</span> {booking.client_message}
        </div>
      )}

      {/* attachments */}
      {!!attachments.length && (
        <div className="mt-3">
          <div className="text-xs text-gray-500 mb-1">{t("bookings.attachments", { defaultValue:"Вложения" })}</div>
          <div className="flex flex-wrap gap-2">
            {attachments.map((att, i) => {
              const url = att.url || att.href;
              const name = att.name || att.filename || url.split("?")[0].split("/").pop();
              return (
                <a key={i} href={url} target="_blank" rel="noreferrer" className="px-2 py-1 text-xs rounded-full border border-gray-200 bg-white hover:bg-gray-50">
                  {name || t("bookings.file", { defaultValue:"файл" })}
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* actions (входящие: поставщик) */}
      {(showAccept || showReject) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {showAccept && (
            <button
              onClick={() => onAccept(booking)}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {t("actions.accept", { defaultValue:"Подтвердить" })}
            </button>
          )}
          {showReject && (
            <button
              onClick={() => onReject(booking)}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white"
            >
              {t("actions.reject", { defaultValue:"Отклонить" })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
