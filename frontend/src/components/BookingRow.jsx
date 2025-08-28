import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

function normalizeTg(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^https?:\/\//i.test(s)) return { label: s.replace(/^https?:\/\//i, ""), href: s };
  if (s.startsWith("@")) return { label: s, href: `https://t.me/${s.slice(1)}` };
  if (/^[A-Za-z0-9_]+$/.test(s)) return { label: `@${s}`, href: `https://t.me/${s}` };
  return { label: s, href: null };
}
const typeLabel = (raw, t) => {
  if (!raw && raw !== 0) return "";
  const s = String(raw).toLowerCase();
  const byCode = { "1":"agent","2":"guide","3":"transport","4":"hotel" };
  const key = byCode[s] || (["agent","guide","transport","hotel"].includes(s) ? s
    : s.includes("guide") ? "guide"
    : s.includes("trans") ? "transport"
    : s.includes("hotel") ? "hotel" : "agent");
  const fallback = { agent:"Агент", guide:"Гид", transport:"Транспорт", hotel:"Отель" }[key];
  return t(`provider.types.${key}`, { defaultValue: fallback });
};

export default function BookingRow({
  booking,
  viewerRole,                // 'provider' | 'client'
  onAccept = () => {},
  onReject = () => {},
  onCancel = () => {},
}) {
  const { t } = useTranslation();

  // для поставщика контрагент — клиент, для клиента — поставщик
  const counterpart = useMemo(() => {
    if (viewerRole === "provider") {
      const tg = normalizeTg(booking.client_social);
      return {
        role: t("roles.client", { defaultValue: "Клиент" }),
        id: booking.client_id,
        name: booking.client_name || t("roles.client", { defaultValue: "Клиент" }),
        href: booking.client_id ? `/profile/client/${booking.client_id}` : null,
        phone: booking.client_phone || null,
        address: booking.client_address || null,
        telegram: tg,
        extra: null,
      };
    }
    const tg = normalizeTg(booking.provider_social);
    return {
      role: t("roles.provider", { defaultValue: "Поставщик" }),
      id: booking.provider_id,
      name: booking.provider_name || t("roles.provider", { defaultValue: "Поставщик" }),
      href: booking.provider_id ? `/profile/provider/${booking.provider_id}` : null,
      phone: booking.provider_phone || null,
      address: booking.provider_address || null,
      telegram: tg,
      extra: typeLabel(booking.provider_type, t),
    };
  }, [booking, viewerRole, t]);

  const canAcceptReject = viewerRole === "provider" && booking.status === "pending";
  const canCancel = viewerRole === "client" && ["pending","active"].includes(String(booking.status));
  const dates = (booking.dates || []).map(d => String(d).slice(0,10)).join(", ");

  return (
    <div className="border rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-gray-500">
            #{booking.id} · {booking.service_title || t("common.service", { defaultValue: "услуга" })} · {booking.status}
          </div>
          <div className="text-base">
            <span className="text-gray-500">{counterpart.role}</span>
            {counterpart.extra && <> · <span className="text-gray-500">{counterpart.extra}</span></>}
            {" · "}
            {counterpart.href ? (
              <a className="font-semibold underline" href={counterpart.href}>{counterpart.name}</a>
            ) : (
              <span className="font-semibold">{counterpart.name}</span>
            )}
          </div>

          <div className="text-sm text-gray-700 mt-1 space-x-3">
            {counterpart.phone && (
              <span>
                {t("marketplace.phone", { defaultValue: "Телефон" })}:{" "}
                <a className="underline" href={`tel:${String(counterpart.phone).replace(/\s+/g,"")}`}>{counterpart.phone}</a>
              </span>
            )}
            {counterpart.telegram?.label && (
              <span>
                {t("marketplace.telegram", { defaultValue: "Телеграм" })}:{" "}
                {counterpart.telegram.href ? (
                  <a className="underline break-all" href={counterpart.telegram.href} target="_blank" rel="noreferrer">
                    {counterpart.telegram.label}
                  </a>
                ) : (
                  <span>{counterpart.telegram.label}</span>
                )}
              </span>
            )}
            {counterpart.address && (
              <span>
                {t("marketplace.address", { defaultValue: "Адрес" })}: <b>{counterpart.address}</b>
              </span>
            )}
          </div>

          <div className="text-sm text-gray-500 mt-1">
            {t("common.date", { defaultValue: "Дата" })}: {dates || "—"}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {canAcceptReject && (
            <>
              <button onClick={() => onAccept(booking)} className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white text-sm">
                {t("actions.accept", { defaultValue: "Подтвердить" })}
              </button>
              <button onClick={() => onReject(booking)} className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-sm">
                {t("actions.reject", { defaultValue: "Отклонить" })}
              </button>
            </>
          )}
          {canCancel && (
            <button onClick={() => onCancel(booking)} className="px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm">
              {t("actions.cancel", { defaultValue: "Отменить" })}
            </button>
          )}
        </div>
      </div>

      {booking.client_message && (
        <div className="text-sm text-gray-700 whitespace-pre-line">
          {booking.client_message}
        </div>
      )}
    </div>
  );
}
