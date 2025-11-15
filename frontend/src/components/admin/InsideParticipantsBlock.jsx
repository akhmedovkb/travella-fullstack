// frontend/src/components/admin/InsideParticipantsBlock.jsx
import React, { useEffect, useState } from "react";

const RAW_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
// Гарантируем, что в ROOT есть /api
const API_ROOT = RAW_API_BASE_URL.endsWith("/api")
  ? RAW_API_BASE_URL
  : `${RAW_API_BASE_URL}/api`;

function formatDate(dt) {
  if (!dt) return "—";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function statusBadge(status) {
  const s = (status || "").toLowerCase();
  let base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ";
  if (s === "active")
    return base + "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100";
  if (s === "completed")
    return base + "bg-blue-50 text-blue-700 ring-1 ring-blue-100";
  if (s === "expelled")
    return base + "bg-red-50 text-red-700 ring-1 ring-red-100";
  return base + "bg-gray-100 text-gray-700 ring-1 ring-gray-200";
}

export default function InsideParticipantsBlock() {
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [expelModal, setExpelModal] = useState({
    open: false,
    participant: null,
    reason: "",
    saving: false,
    error: "",
  });

  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  async function loadParticipants() {
    try {
      setLoading(true);
      setError("");

      const url = `${API_ROOT}/inside/admin/participants?ts=${Date.now()}`;
      const res = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      setParticipants(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("loadParticipants error", e);
      setError("Не удалось загрузить участников программы");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadParticipants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openExpelModal(p) {
    setExpelModal({
      open: true,
      participant: p,
      reason: "",
      saving: false,
      error: "",
    });
  }

  function closeExpelModal() {
    setExpelModal({
      open: false,
      participant: null,
      reason: "",
      saving: false,
      error: "",
    });
  }

  async function handleExpelSubmit(e) {
    e.preventDefault();
    if (!expelModal.participant) return;

    try {
      setExpelModal((prev) => ({ ...prev, saving: true, error: "" }));

      const url = `${API_ROOT}/inside/admin/participants/${expelModal.participant.user_id}/expel`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          reason: expelModal.reason || null,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("expel error:", text);
        throw new Error(`HTTP ${res.status}`);
      }

      await loadParticipants();
      closeExpelModal();
    } catch (err) {
      console.error("handleExpelSubmit error", err);
      setExpelModal((prev) => ({
        ...prev,
        error: "Не удалось отчислить участника",
        saving: false,
      }));
    }
  }

  return (
    <section className="mt-10 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Участники программы</h2>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Таблица участников */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                ID пользователя
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Имя
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Telegram
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Статус
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Текущая глава
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Прогресс
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Curator TG
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Создан
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Обновлён
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">
                Действия
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-4 text-center text-gray-500"
                >
                  Загрузка...
                </td>
              </tr>
            )}

            {!loading && participants.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-4 text-center text-gray-500"
                >
                  Пока нет ни одного участника.
                </td>
              </tr>
            )}

            {!loading &&
              participants.map((p) => (
                <tr key={p.id || p.user_id}>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700">
                    {p.user_id}
                  </td>
                  <td className="px-4 py-2 text-gray-800">{p.user_name}</td>
                  <td className="px-4 py-2 text-gray-700">
                    {p.user_telegram || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={statusBadge(p.status)}>{p.status}</span>
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {p.current_chapter || "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {Number(p.progress_current || 0)} /{" "}
                    {Number(p.progress_total || 0)}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {p.curator_telegram || "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {formatDate(p.created_at)}
                  </td>
                  <td className="px-4 py-2 text-gray-700">
                    {formatDate(p.updated_at)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {p.status === "expelled" ? (
                      <span className="text-xs font-medium text-red-500">
                        Отчислен
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openExpelModal(p)}
                        className="text-sm font-medium text-red-600 hover:text-red-800"
                      >
                        Отчислить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Модалка отчисления */}
      {expelModal.open && expelModal.participant && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold">
              Отчислить участника #{expelModal.participant.user_id}
            </h3>
            <p className="mb-3 text-sm text-gray-700">
              {expelModal.participant.user_name} (
              {expelModal.participant.user_telegram || "без Telegram"})
            </p>

            {expelModal.error && (
              <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {expelModal.error}
              </div>
            )}

            <form onSubmit={handleExpelSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Причина отчисления (видна в заявках)
                </label>
                <textarea
                  rows={3}
                  value={expelModal.reason}
                  onChange={(e) =>
                    setExpelModal((prev) => ({
                      ...prev,
                      reason: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  placeholder="Например: не соблюдал правила группы, не выполнял задания и т.п."
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeExpelModal}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  disabled={expelModal.saving}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={expelModal.saving}
                  className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
                >
                  {expelModal.saving ? "Отчисляем..." : "Отчислить участника"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
