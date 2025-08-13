// frontend/src/components/ExpiryBadge.jsx
import { useEffect, useMemo, useState } from "react";

/** Нормализуем поле "когда истекает":
 *  поддерживаем: expires_at / expire_at / expireAt / details.{...} (ISO/UTC строка или unix)
 *  а также относительный ttl_hours на основе created_at
 */
function resolveExpireAt(service) {
  const s = service || {};
  const d = s.details || {};

  const cand = [
    s.expires_at, s.expire_at, s.expireAt,
    d.expires_at, d.expire_at, d.expiresAt, d.expiration, d.expiration_at, d.expirationAt,
    d.expiration_ts, d.expirationTs,
  ].find((v) => v !== undefined && v !== null && String(v).trim?.() !== "");

  let ts = null;

  if (cand !== undefined && cand !== null) {
    if (typeof cand === "number") {
      // unix seconds / milliseconds
      ts = cand > 1e12 ? cand : cand * 1000;
    } else {
      const parsed = Date.parse(String(cand));
      if (!Number.isNaN(parsed)) ts = parsed;
    }
  }

  // ttl_hours как альтернатива
  if (!ts) {
    const ttl = d.ttl_hours ?? d.ttlHours ?? s.ttl_hours ?? null;
    if (ttl && Number(ttl) > 0 && s.created_at) {
      const created = Date.parse(s.created_at);
      if (!Number.isNaN(created)) ts = created + Number(ttl) * 3600 * 1000;
    }
  }

  return ts; // ms или null
}

function formatLeft(ms) {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const dd = Math.floor(total / 86400);
  const hh = Math.floor((total % 86400) / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;

  const pad = (n) => String(n).padStart(2, "0");
  // >1 дня показываем "Dд HH:MM"
  if (dd > 0) return `${dd}д ${pad(hh)}:${pad(mm)}`;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

/** Бейдж обратного счёта. Ничего не рендерит, если срока нет. */
export default function ExpiryBadge({ service, className = "" }) {
  const expireAt = useMemo(() => resolveExpireAt(service), [service]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!expireAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expireAt]);

  if (!expireAt) return null;

  const left = Math.max(0, expireAt - now);
  const expired = left <= 0;
  const txt = formatLeft(left);

  return (
    <div className={`absolute top-2 left-2 z-30 ${className}`}>
      <span
        className={`px-2 py-1 rounded-full text-[11px] font-semibold text-white shadow
        ${expired ? "bg-gray-400/90" : "bg-orange-600/95"} backdrop-blur-sm ring-1 ring-white/20`}
        title={expired ? "Время истекло" : "До окончания"}
      >
        {txt}
      </span>
    </div>
  );
}
