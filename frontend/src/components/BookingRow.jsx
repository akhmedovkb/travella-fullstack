// frontend/src/components/BookingRow.jsx
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

const typeLabelKey = (raw) => {
  const s = String(raw ?? "").toLowerCase();
  const byCode = { "1": "agent", "2": "guide", "3": "transport", "4": "hotel" };
  if (byCode[s]) return byCode[s];
  if (["agent", "guide", "transport", "hotel"].includes(s)) return s;
  if (s.includes("guide") || s.includes("гид")) return "guide";
  if (s.includes("trans") || s.includes("вод") || s.includes("транс")) return "transport";
  if (s.includes("hotel") || s.includes("отел")) return "hotel";
  return "agent";
};
const typeLabel = (raw, t) =>
  t(`provider.types.${typeLabelKey(raw)}`, {
    defaultValue: { agent: "Агент", guide: "Гид", transport: "Транспорт", hotel: "Отель" }[
      typeLabelKey(raw)
    ],
  });

const makeAbsolute = (u) => {
  if (!u) return null;
  const s = String(u).trim();
  if (/^(data:|https?:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `${window.location.protocol}${s}`;
  const base = (import.meta.env.VITE_API_BASE_URL || window.location.origin || "").replace(/\/+$/, "");
  return `${base}/${s.replace(/^\/+/, "")}`;
};

const isImageUrl = (url, type) => {
  if (type && String(type).toLowerCase().startsWith("image/")) return true;
  const s = String(url || "").toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(s) || s.startsWith("data:image/");
};

const normalizeAttachment = (a) => {
  if (typeof a === "string") {
    return { name: a.split("/").pop() || "file", url: makeAbsolute(a), type: "" };
  }
  if (a && typeof a === "object") {
    const url = makeAbsolute(a.url || a.href || a.path || a.file || a.src);
    const name = a.name || (url ? url.split("/").pop() : "file");
    const type = a.type || a.mime || "";
    return { name, url, type };
  }
  return null;
};

const statusKey = (s) => String(s || "").toLowerCase();
const statusView = (s, t) => {
  const k = statusKey(s);
  const map = {
    pending: { text: t("status.pending", { defaultValue: "ожидает" }), cls: "bg-amber-50 text-amber-700 ring-amber-200" },
    confirmed: { text: t("status.confirmed", { defaultValue: "подтверждено" }), cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    active: { text: t("status.active", { defaultValue: "активно" }), cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
    rejected: { text: t("status.rejected", { defaultValue: "отклонено" }), cls: "bg-rose-50 text-rose-700 ring-rose-200" },
    cancelled: { text: t("status.cancelled", { defaultValue: "отменено" }), cls: "bg-gray-100 text-gray-600 ring-gray-200" },
  };
  return map[k] || { text: k, cls: "bg-gray-100 text-gray-700 ring-gray-200" };
};

/* ===== component ===== */
export default function BookingRow({
  booking,
  viewerRole,                // 'provider' | 'client'
  onAccept = () => {},
  onReject = () => {},
  onCancel = () => {},
}) {
  const { t } = useTranslation();

  // контрагент
  const counterpart = useMemo(() => {
    if (viewerRole === "provider") {
      const tg = normalizeTg(booking.client_social || booking.requester_telegram);
      return {
        role: t("roles.client", { defaultValue: "Клиент" }),
        id: booking.client_id,
        name: booking.client_name || booking.requester_name || t("roles.client", { defaultValue: "Клиент" }),
        href: booking.client_id ? `/profile/client/${booking.client_id}` : booking.requester_url || null,
        phone: booking.client_phone || booking.requester_phone || null,
        address: booking.client_address || null,
        telegram: tg,
        extra: null, // у клиента типа нет
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
      // показываем тип поставщика для клиента
      extra: typeLabel(booking.provider_type, t),
    };
  }, [booking, viewerRole, t]);

  const canAcceptReject = viewerRole === "provider" && statusKey(booking.status) === "pending";
  const canCancel = viewerRole === "client" && ["pending", "active"].includes(statusKey(booking.status));

  const datesArr = Array.isArray(booking.dates) ? booking.dates.map((d) => String(d).slice(0, 10)) : [];
  const dates = datesArr.join(", ");

  // attachments из API (json/jsonb/строка)
  let attachments = [];
  try {
    const raw = booking.attachments;
    const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? JSON.parse(raw) : [];
    attachments = arr.map(normalizeAttachment).filter(Boolean);
  } catch {
    attachments = [];
  }

  const st = statusView(booking.status, t);

  return (
    <div className="border rounded-lg p-3 flex flex-col gap-2 bg-white">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {/* заголовок: №, название услуги, статус-бейдж */}
          <div className="flex items-center gap-2 text-sm text-gray-500 flex-wrap">
            <span>#{booking.id}</span>
            <span>·</span>
            <span className="truncate">{booking.service_title || t("common.service", { defaultValue: "услуга" })}</span>
            <span>·</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full ring-1 ${st.cls}`}>{st.text}</span>
          </div>

          {/* контрагент (имя кликабельно), для клиента показываем тип поставщика */}
          <div className="text-base mt-0.5">
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

          {/* контакты */}
          <div className="text-sm text-gray-700 mt-1 space-x-3">
            {counterpart.phone && (
              <span>
                {t("marketplace.phone", { defaultValue: "Телефон" })}:{" "}
                <a
                  className="underline"
                  href={`tel:${String(counterpart.phone).replace(/[^+\d]/g, "")}`}
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
                {t("marketplace.address", { defaultValue: "Адрес" })}: <b>{counterpart.address}</b>
              </span>
            )}
          </div>

          {/* даты */}
          <div className="text-sm text-gray-500 mt-1">
            {t("common.date", { defaultValue: "Дата" })}: {dates || "—"}
          </div>
        </div>

        {/* действия */}
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

      {/* сообщение клиента */}
      {booking.client_message && (
        <div className="text-sm text-gray-700 whitespace-pre-line">{booking.client_message}</div>
      )}

      {/* вложения */}
      {!!attachments.length && (
        <div className="mt-1">
          <div className="text-sm text-gray-500 mb-1">
            {attachments.length > 1
              ? t("attachments.list", { defaultValue: "Вложения" })
              : t("attachments.single", { defaultValue: "Вложение" })}
            :
          </div>

          <div className="flex flex-wrap gap-3">
            {attachments.map((att, i) => {
              const img = isImageUrl(att.url, att.type);
              return (
                <a
                  key={i}
                  href={att.url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 no-underline"
                  title={att.name}
                >
                  {img ? (
                    <img
                      src={att.url}
                      alt={att.name}
                      className="w-16 h-16 rounded border object-cover"
                    />
                  ) : (
                    <span className="inline-block px-2 py-1 text-xs rounded border bg-gray-50">
                      {att.name}
                    </span>
                  )}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
