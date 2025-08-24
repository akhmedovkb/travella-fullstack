// src/components/ProviderOutboxList.jsx
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/* helpers */
function formatDate(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function makeTgHref(v) {
  if (!v) return null;
  let s = String(v).trim();
  s = s.replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "").replace(/^t\.me\//i, "");
  return `https://t.me/${s}`;
}

export default function ProviderOutboxList({ showHeader = false }) {
  const { t } = useTranslation();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyEdit, setBusyEdit] = useState({}); // { [id]: true }
  const [busyDel, setBusyDel] = useState({});  // { [id]: true }

  const token = localStorage.getItem("token");
  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const config = { headers: { Authorization: `Bearer ${token}` } };

  const load = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/api/requests/provider/outgoing`, config);
      setItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch (e) {
      console.error("Ошибка загрузки исходящих:", e?.response?.data || e?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* actions */
  const handleEdit = async (id, currentNote) => {
    const next = window.prompt(
      t("common.note_optional", { defaultValue: "Комментарий (необязательно):" }),
      currentNote || ""
    );
    if (next === null) return; // cancel
    setBusyEdit((m) => ({ ...m, [id]: true }));
    try {
      await axios.put(`${API_BASE}/api/requests/${id}`, { note: next || null }, config);
      setItems((prev) => prev.map((r) => (r.id === id ? { ...r, note: next || null } : r)));
    } catch (e) {
      console.error("edit request failed:", e?.response?.data || e?.message);
      alert(t("errors.action_failed", { defaultValue: "Не удалось выполнить действие" }));
    } finally {
      setBusyEdit((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(t("provider.outbox.confirm_delete", { defaultValue: "Удалить заявку?" })))
      return;
    setBusyDel((m) => ({ ...m, [id]: true }));
    try {
      await axios.delete(`${API_BASE}/api/requests/${id}`, config);
      setItems((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      console.error("delete request failed:", e?.response?.data || e?.message);
      alert(t("errors.action_failed", { defaultValue: "Не удалось выполнить действие" }));
    } finally {
      setBusyDel((m) => {
        const n = { ...m };
        delete n[id];
        return n;
      });
    }
  };

  /* counters */
  const total = items.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-2xl font-semibold">
            {t("provider.outbox.title", { defaultValue: "Исходящие запросы" })}
          </h3>
          <span className="ml-1 inline-flex items-center justify-center text-xs font-medium
                           min-w-[20px] h-[20px] px-1 rounded-full bg-gray-100 text-gray-700">
            {total}
          </span>
        </div>
        <button
          onClick={load}
          className="px-3 py-1 rounded-lg text-white bg-blue-500 hover:bg-blue-600 text-sm disabled:opacity-60"
          disabled={loading}
        >
          {t("common.refresh", { defaultValue: "Обновить" })}
        </button>
      </div>

      {loading && (
        <div className="text-sm text-gray-500">
          {t("common.loading", { defaultValue: "Загрузка…" })}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="text-sm text-gray-500">
          {t("provider.outbox.empty", { defaultValue: "Нет исходящих заявок" })}
        </div>
      )}

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((r) => {
          // адресат (куда отправлено)
          const dst =
            r?.recipient || r?.to || r?.provider || r?.agency || r?.company || r?.client || {};
          const profileUrl = dst?.provider_id
            ? `/profile/provider/${dst.provider_id}`
            : dst?.id
            ? `/profile/provider/${dst.id}`
            : null;

          const phone = dst?.phone || r?.phone || null;
          const phoneHref = phone ? `tel:${String(phone).replace(/[^+\d]/g, "")}` : null;

          const tgRaw = dst?.telegram || dst?.social || r?.telegram || null;
          const tgHref = tgRaw ? makeTgHref(tgRaw) : null;
          const tgLabel = tgRaw
            ? "@" +
              String(tgRaw).trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "").replace(/^t\.me\//i, "")
            : null;

          const serviceTitle =
            r?.service?.title || r?.service_title || r?.title || t("common.request", { defaultValue: "Запрос" });
          const created = r?.created_at ? formatDate(r.created_at) : "";

          return (
            <div key={r.id} className="bg-white border rounded-xl p-4 overflow-hidden">
              <div className="font-semibold leading-tight break-words line-clamp-2">{serviceTitle}</div>

              {/* Кому */}
              <div className="mt-2 text-sm text-gray-700 min-w-0">
                <div className="flex items-center gap-2">
                  {profileUrl ? (
                    <Link to={profileUrl} className="underline hover:no-underline truncate block max-w-full">
                      {dst?.name || dst?.title || "—"}
                    </Link>
                  ) : (
                    <span className="truncate">{dst?.name || dst?.title || "—"}</span>
                  )}
                  {!!dst?.type && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-700">
                      {{
                        agent: t("labels.agent", { defaultValue: "Турагент" }),
                        guide: t("labels.guide", { defaultValue: "Гид" }),
                        transport: t("labels.transport", { defaultValue: "Транспорт" }),
                        hotel: t("labels.hotel", { defaultValue: "Отель" }),
                        client: t("labels.client", { defaultValue: "Клиент" }),
                      }[String(dst.type).toLowerCase()] || dst.type}
                    </span>
                  )}
                </div>

                <div className="flex gap-4 mt-1">
                  {phoneHref ? (
                    <a className="hover:underline break-all" href={phoneHref}>
                      {phone}
                    </a>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                  {tgHref ? (
                    <a className="hover:underline break-all" href={tgHref} target="_blank" rel="noopener noreferrer">
                      {tgLabel}
                    </a>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </div>
              </div>

              <div className="text-sm text-gray-500 mt-1">
                {t("common.status", { defaultValue: "Статус" })}: {r?.status || "new"}
              </div>
              {created && (
                <div className="text-xs text-gray-400 mt-1">
                  {t("common.created", { defaultValue: "Создан" })}: {created}
                </div>
              )}

              {!!r?.note && (
                <div className="text-sm text-gray-600 mt-2 whitespace-pre-wrap break-words">
                  {t("common.comment", { defaultValue: "Комментарий" })}: {r.note}
                </div>
              )}

              {/* действия */}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => handleEdit(r.id, r.note)}
                  disabled={!!busyEdit[r.id]}
                  className="px-3 py-1.5 rounded border hover:bg-gray-50 disabled:opacity-60"
                >
                  {busyEdit[r.id]
                    ? t("common.saving", { defaultValue: "Сохранение..." })
                    : t("actions.edit", { defaultValue: "Править" })}
                </button>
                <button
                  onClick={() => handleDelete(r.id)}
                  disabled={!!busyDel[r.id]}
                  className="px-3 py-1.5 rounded border text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  {t("actions.delete", { defaultValue: "Удалить" })}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
