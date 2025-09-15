import { useEffect, useState } from "react";
import axios from "axios";

const API = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "") || "";

function cls(...xs){ return xs.filter(Boolean).join(" "); }

export default function GeoNamesStatusBadge() {
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState("");

  async function load() {
    try {
      const { data } = await axios.get(`${API}/api/monitor/geonames`, { withCredentials: true });
      setSummary(data); setErr("");
    } catch (e) {
      setErr(e?.message || "load_error");
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const s = summary;
  let state = "unknown";
  if (s) {
    if (s.quota_suspected) state = "quota";
    else if (s.err_1h > 0 && s.ok_1h === 0) state = "down";
    else if (s.err_1h > 0) state = "degraded";
    else state = "ok";
  }

  const color = {
    ok: "bg-green-100 text-green-800 border-green-300",
    degraded: "bg-yellow-100 text-yellow-800 border-yellow-300",
    quota: "bg-red-100 text-red-800 border-red-300",
    down: "bg-red-100 text-red-800 border-red-300",
    unknown: "bg-gray-100 text-gray-700 border-gray-300",
  }[state];

  const title = {
    ok: "GeoNames: OK",
    degraded: "GeoNames: есть ошибки за час",
    quota: "GeoNames: вероятно исчерпана квота",
    down: "GeoNames: ошибки за час",
    unknown: "GeoNames: статус неизвестен",
  }[state];

  return (
    <div className={cls("inline-flex items-center gap-2 px-2 py-1 rounded border text-sm", color)} title={title}>
      <span className="inline-block w-2 h-2 rounded-full bg-current opacity-70" />
      <span>{title}</span>
      {s && (
        <span className="text-xs opacity-70">
          (1ч: ok {s.ok_1h}, err {s.err_1h}) {s.last_message ? `| last: ${s.last_message}` : ""}
        </span>
      )}
      {err && <span className="text-xs text-red-600">[{err}]</span>}
    </div>
  );
}
