import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";
import { toast } from "react-toastify";

const statusBadge = (status = "new") => {
  const map = {
    new: "bg-amber-100 text-amber-800",
    viewed: "bg-blue-100 text-blue-800",
    active: "bg-indigo-100 text-indigo-800",
    done: "bg-emerald-100 text-emerald-800",
    cancelled: "bg-red-100 text-red-800",
  };
  return map[status] || "bg-gray-100 text-gray-800";
};

export default function ProviderInboxList({ showHeader = true, compact = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const token = localStorage.getItem("token");
  const config = useMemo(
    () => ({ headers: { Authorization: `Bearer ${token}` } }),
    [token]
  );

  const refresh = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`${API_BASE}/api/requests/provider`, config);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.message || "Не удалось загрузить входящие");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <section>
      {showHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold">Входящие запросы</h3>
          <button
            onClick={refresh}
            className="text-sm text-orange-600 hover:text-orange-700 underline disabled:opacity-60"
            disabled={loading}
          >
            Обновить
          </button>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {loading && (
          <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-4">
            <div className="h-4 w-1/3 bg-gray-200 rounded mb-2" />
            <div className="h-3 w-1/2 bg-gray-200 rounded mb-2" />
            <div className="h-12 w-full bg-gray-100 rounded" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-gray-500 text-sm">
            Запросов нет.
          </div>
        )}

        {items.map((r) => {
          const id = r.id ?? r._id;
          const status = r.status || "new";
          const created =
            r.created_at || r.createdAt || r.created || r.date;
          const dt = created ? new Date(created) : null;

          const serviceTitle =
            r.service_title || r.service?.title || r.serviceTitle || r.service_name || "—";

          const fromName =
            r.from_name ||
            r.client_name ||
            r.user?.name ||
            r.fromUser?.name ||
            r.client?.name ||
            "Клиент";

          const note = r.note || r.comment || r.message || "";

          return (
            <article
              key={id}
              className={[
                "relative rounded-xl border bg-white p-4 shadow-sm hover:shadow-md transition",
                "border-gray-200",
                "before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:rounded-l-xl before:bg-orange-400"
              ].join(" ")}
            >
              {/* meta */}
              <div className="flex flex-wrap items-center gap-x-3 text-[13px] text-gray-500 mb-2">
                <span className="font-medium text-gray-700">#{id}</span>
                <span className="select-none">•</span>
                <span className={`px-2 py-0.5 rounded-full ${statusBadge(status)} capitalize`}>
                  {status}
                </span>
                {dt && (
                  <>
                    <span className="select-none">•</span>
                    <time dateTime={dt.toISOString()}>
                      {dt.toLocaleDateString()}&nbsp;{dt.toLocaleTimeString().slice(0,5)}
                    </time>
                  </>
                )}
              </div>

              {/* content */}
              <div className={compact ? "space-y-1" : "space-y-2"}>
                <div className="text-sm">
                  <span className="text-gray-500">Услуга:&nbsp;</span>
                  <span className="font-medium text-gray-900">{serviceTitle}</span>
                </div>

                <div className="text-sm">
                  <span className="text-gray-500">От кого:&nbsp;</span>
                  <span className="text-gray-900">{fromName}</span>
                </div>

                {note && (
                  <div className="text-[13px] leading-relaxed rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-700">
                    <span className="text-gray-500">Комментарий:&nbsp;</span>
                    {note}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
