import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

/* ===== helpers ===== */
function normalizeTg(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^https?:\/\//i.test(s)) return { label: s.replace(/^https?:\/\//i, ""), href: s };
  if (s.startsWith("@")) return { label: s, href: `https://t.me/${s.slice(1)}` };
  if (/^[A-Za-z0-9_]+$/.test(s)) return { label: `@${s}`, href: `https://t.me/${s}` };
  return { label: s, href: null };
}

// Человечный ярлык типа провайдера (умеет числа: 1=agent, 2=guide, 3=transport, 4=hotel)
function typeLabel(raw, t) {
  if (raw === undefined || raw === null) return "";
  const s = String(raw).trim().toLowerCase();
  const byCode = { "1": "agent", "2": "guide", "3": "transport", "4": "hotel" };
  const key =
    byCode[s] ||
    (["agent", "guide", "transport", "hotel"].includes(s)
      ? s
      : s.includes("guide")
      ? "guide"
      : s.includes("trans")
      ? "transport"
      : s.includes("hotel")
      ? "hotel"
      : "agent");

  const fallback = { agent: "Агент", guide: "Гид", transport: "Транспорт", hotel: "Отель" }[key];
  return t(`provider.types.${key}`, { defaultValue: fallback });
}

const toDatesText = (dlist) => {
  if (!dlist || !dlist.length) return "—";
  const arr = dlist.map((d) => String(d).slice(0, 10));
  return Array.from(new Set(arr)).join(", ");
};

/* ===== component ===== */
export default function BookingRow({
  booking,
  viewerRole,               // 'provider' | 'client'
  onAccept = () => {},
  onReject = () => {},
  onCancel = () => {},
}) {
  const { t } = useTranslation();

  // Унифицированные поля (поддержка нового API с requester_* и старых client_* / provider_*)
  const counterpart = useMemo(() => {
    if (viewerRole === "provider") {
      // инициатор — КЛИЕНТ
      const id =
        booking.requester_client_id ??
        booking.requester_id ??
        booking.client_id;

      const name =
        booking.requester_name ??
        booking.client_name ??
        t("roles.client", { defaultValue: "Клиент" });

      const phone   = booking.requester_phone   ?? booking.client_phone   ?? null;
      // у clients «адреса» нет, используем location
      const address = booking.requester_location ?? booking.client_location ?? null;

      const tgRaw =
        booking.requester_telegram ??
        booking.client_telegram ??
        booking.client_social ?? // если вдруг так названо
        null;

      return {
        role: t("roles.client", { defaultValue: "Клиент" }),
        extra: null,
        href: id ? `/profile/client/${id}` : null,
        name,
        phone,
        address,
        telegram: normalizeTg(tgRaw),
      };
    }

    // viewerRole === "client" -> контрагент — ПОСТАВЩИК
    const id = booking.provider_id ?? booking.provider_profile_id;
    const name = booking.provider_name ?? t("roles.provider", { defaultValue: "Поставщик" });
    const phone   = booking.provider_phone   ?? null;
    const address = booking.provider_address ?? null;
    const tgRaw   =
      booking.provider_social ?? // у providers «social» = Telegram
      booking.provider_telegram ??
      null;

    return {
      role: t("roles.provider", { defaultValue: "Поставщик" }),
      extra: typeLabel(booking.provider_type, t),
      href: id ? `/profile/provider/${id}` : null,
      name,
      phone,
      address,
      telegram: normalizeTg(tgRaw),
    };
  }, [booking, viewerRole, t]);

  const canAcceptReject = viewerRole === "provider" && String(booking.status) === "pending";
  const canCancel = viewerRole === "client" && ["pending", "active"].includes(String(booking.status));
  const datesText = toDatesText(booking.dates);

  const serviceTitle =
    booking.service_title ||
    booking.service?.title ||
    t("common.service", { defaultValue: "услуга" });

  return (
    <div className="border rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-gray-500">
            #{booking.id} · {serviceTitle} · {booking.status}
          </div>

          <div className="text-base">
            <span className="text-gray-500">{counterpart.role}</span>
            {counterpart.extra && (
              <>
                {" · "}
                <span className="text-gray-500">{counterpart.extra}</span>
              </>
            )}
            {" · "}
            {counterpart.href ? (
              <a className="font-semibold underline" href={counterpart.href}>
                {counterpart.name}
              </a>
            ) : (
              <span className="font-semibold">{counterpart.name}</span>
            )}
          </div>

          <div className="text-sm text-gray-700 mt-1 space-x-3">
            {counterpart.phone && (
              <span>
                {t("marketplace.phone", { defaultValue: "Телефон" })}:{" "}
                <a
                  className="underline"
                  href={`tel:${String(counterpart.phone).replace(/\s+/g, "")}`}
                >
                  {counterpart.phone}
                </a>
              </span>
            )}
            {counterpart.telegram?.label && (
              <span>
                {t("marketplace.telegram", { defaultValue: "Телеграм" })}:{" "}
                {counterpart.telegram.href ? (
                  <a
                    className="underline break-all"
                    href={counterpart.telegram.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {counterpart.telegram.label}
                  </a>
                ) : (
                  <span>{counterpart.telegram.label}</span>
                )}
              </span>
            )}
            {counterpart.address && (
              <span>
                {t("marketplace.address", { defaultValue: "Адрес" })}:{" "}
                <b>{counterpart.address}</b>
              </span>
            )}
          </div>

          <div className="text-sm text-gray-500 mt-1">
            {t("common.date", { defaultValue: "Дата" })}: {datesText}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {canAcceptReject && (
            <>
              <button
                onClick={() => onAccept(booking)}
                className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white text-sm"
              >
                {t("actions.accept", { defaultValue: "Подтвердить" })}
              </button>
              <button
                onClick={() => onReject(booking)}
                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-sm"
              >
                {t("actions.reject", { defaultValue: "Отклонить" })}
              </button>
            </>
          )}

          {canCancel && (
            <button
              onClick={() => onCancel(booking)}
              className="px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm"
            >
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
