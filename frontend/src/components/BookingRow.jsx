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

const typeLabel = (raw, t) => {
  if (!raw && raw !== 0) return "";
  const s = String(raw).toLowerCase();
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
};

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

const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const normalizeAttachment = (a) => {
  // поддержка: строка-URL | {url|href|path|file|src, name, type}
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

const initials = (name = "") =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

/* ===== component ===== */
export default function BookingRow({
  booking,
  viewerRole, // 'provider' | 'client'
  onAccept = () => {},
  onReject = () => {},
  onCancel = () => {},
}) {
  const { t } = useTranslation();

  // чей аватар показываем
  const avatarUrl = useMemo(() => {
    if (viewerRole === "provider") {
      return (
        makeAbsolute(booking.client_avatar_url) ||
        makeAbsolute(booking.client_photo) ||
        makeAbsolute(booking.client?.avatar_url)
      );
    }
    // viewerRole === 'client' → показываем провайдера
    return (
      makeAbsolute(booking.provider_photo) ||
      makeAbsolute(booking.provider?.photo) ||
      makeAbsolute(booking.provider_avatar_url)
    );
  }, [booking, viewerRole]);

  // контрагент для подписи/ссылок
  const counterpart = useMemo(() => {
    if (viewerRole === "provider") {
      const tg = normalizeTg(booking.client_social || booking.requester_telegram);
      const name =
        booking.client_name ||
        booking.requester_name ||
        t("roles.client", { defaultValue: "Клиент" });
      return {
        role: t("roles.client", { defaultValue: "Клиент" }),
        id: booking.client_id,
        name,
        href: booking.client_id ? `/profile/client/${booking.client_id}` : booking.requester_url || null,
        phone: booking.client_phone || booking.requester_phone || null,
        address: booking.client_address || null,
        telegram: tg,
        extra: null, // тип клиента не нужен
      };
    }
    const tg = normalizeTg(booking.provider_social);
    const name =
      booking.provider_name ||
      booking.provider?.name ||
      t("roles.provider", { defaultValue: "Поставщик" });
    return {
      role: t("roles.provider", { defaultValue: "Поставщик" }),
      id: booking.provider_id,
      name,
      href: booking.provider_id ? `/profile/provider/${booking.provider_id}` : null,
      phone: booking.provider_phone || booking.provider?.phone || null,
      address: booking.provider_address || null,
      telegram: tg,
      // Для клиента показываем тип провайдера
      extra: typeLabel(booking.provider_type, t),
    };
  }, [booking, viewerRole, t]);

  // разрешения
  const canAcceptReject = viewerRole === "provider" && String(booking.status).toLowerCase() === "pending";
  // клиент может отменить pending/confirmed (ранее было 'active', синхронизируем со статусами бекенда)
  const canCancel =
    viewerRole === "client" && ["pending", "confirmed"].includes(String(booking.status).toLowerCase());

  const dates = (booking.dates || []).map((d) => String(d).slice(0, 10)).join(", ");

  // attachments из API (json/jsonb) или строка — приводим к массиву
  let attachments = [];
  try {
    const raw = booking.attachments;
    const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? JSON.parse(raw) : [];
    attachments = arr.map(normalizeAttachment).filter(Boolean);
  } catch {
    attachments = [];
  }

  return (
    <div className="border rounded-lg p-3 flex flex-col gap-2 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {/* Аватар / инициалы */}
          <div className="w-10 h-10 rounded-full overflow-hidden bg-indigo-600 text-white grid place-items-center shrink-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={counterpart.name || "avatar"}
                className="w-full h-full object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="font-semibold">{initials(counterpart.name || "U")}</span>
            )}
          </div>

          <div className="min-w-0">
            <div className="text-sm text-gray-500">
              #{booking.id} · {booking.service_title || t("common.service", { defaultValue: "услуга" })} ·{" "}
              <span className="lowercase">{String(booking.status).toLowerCase()}</span>
            </div>

            <div className="text-base">
              <span className="text-gray-500">{counterpart.role}</span>
              {counterpart.href ? (
                <>
                  {" · "}
                  <a className="font-semibold underline" href={counterpart.href}>
                    {counterpart.name}
                  </a>
                </>
              ) : (
                <>
                  {" · "}
                  <span className="font-semibold">{counterpart.name}</span>
                </>
              )}
              {/* бейдж типа поставщика только для клиента */}
              {viewerRole === "client" && counterpart.extra && (
                <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 bg-gray-100 text-gray-700 ring-gray-200">
                  {counterpart.extra}
                </span>
              )}
            </div>

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

            <div className="text-sm text-gray-500 mt-1">
              {t("common.date", { defaultValue: "Дата" })}: {dates || "—"}
            </div>
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
                      loading="lazy"
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
