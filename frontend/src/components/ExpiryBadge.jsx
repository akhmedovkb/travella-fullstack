// i18n-enabled ExpiryBadge
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
    if (typeof cand === "number") ts = cand > 1e12 ? cand : cand * 1000;
    else {
      const parsed = Date.parse(String(cand));
      if (!Number.isNaN(parsed)) ts = parsed;
    }
  }
  if (!ts) {
    const ttl = d.ttl_hours ?? d.ttlHours ?? s.ttl_hours ?? null;
    if (ttl && Number(ttl) > 0 && s.created_at) {
      const created = Date.parse(s.created_at);
      if (!Number.isNaN(created)) ts = created + Number(ttl) * 3600 * 1000;
    }
  }
  return ts;
}
function useCountdown(targetTs) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, Math.floor((targetTs - now) / 1000));
  const expired = left <= 0;
  return { left, expired };
}
function formatLeft(left) {
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = Math.floor(left % 60);
  if (d > 0) return `${d}д ${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}`;
  if (h > 0) return `${h}ч ${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;
  if (m > 0) return `${m}м ${s.toString().padStart(2,"0")}`;
  return `${s}с`;
}

export default function ExpiryBadge({ service, className = "" }) {
  const { t } = useTranslation();
  const ts = useMemo(() => resolveExpireAt(service), [service]);
  if (!ts) return null;
  const { left, expired } = useCountdown(ts);
  const txt = formatLeft(left);
  return (
    <div className={`absolute top-2 left-2 z-30 ${className}`}>
      <span
        className={\`px-2 py-1 rounded-full text-[11px] font-semibold text-white shadow \${expired ? "bg-gray-400/90" : "bg-orange-600/95"} backdrop-blur-sm ring-1 ring-white/20\`}
        title={expired ? t("countdown.expired") : t("countdown.until_end")}
      >
        {txt}
      </span>
    </div>
  );
}
