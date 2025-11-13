// frontend/src/pages/admin/AdminInsideRequests.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listCompletionRequests,
  approveRequest,
  rejectRequest,
} from "../../api/inside";
import { tError, tInfo, tSuccess } from "../../shared/toast";

const CHAPTERS = [
  { key: "royal",   label: "Золотой Треугольник" },
  { key: "silence", label: "Приключения в Раджастане" },
  { key: "modern",  label: "Мумбаи + Гоа" },
  { key: "kerala",  label: "Керала" },
];

function ChapterBadge({ chapter }) {
  const map = {
    royal:   "bg-orange-50 text-orange-700 ring-orange-200",
    silence: "bg-sky-50 text-sky-700 ring-sky-200",
    modern:  "bg-violet-50 text-violet-700 ring-violet-200",
    kerala:  "bg-emerald-50 text-emerald-700 ring-emerald-200",
  };
  const cls = map[chapter] || "bg-gray-50 text-gray-700 ring-gray-200";
  const human = CHAPTERS.find((c) => c.key === chapter)?.label || chapter;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ring-1 ${cls}`}>
      {human}
    </span>
  );
}

export default function AdminInsideRequests() {
  const { t } = useTranslation();
  const [status, setStatus] = useState("pending"); // pending|approved|rejected|all
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [nextChapter, setNextChapter] = useState(""); // optional for approve
  const [q, setQ] = useState("");

  async function load() {
    try {
      setLoading(true);
      const data = await listCompletionRequests(status);
      const arr = Array.isArray(data) ? data : data?.items || [];
      setItems(arr);
    } catch (e) {
      setItems([]);
      tError("Не удалось загрузить заявки", { autoClose: 1800 });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  const filtered = useMemo(() => {
    if (!q) return items;
    const s = q.toLowerCase();
    return items.filter((r) =>
      String(r.user_id).toLowerCase().includes(s) ||
      String(r.chapter || "").toLowerCase().includes(s) ||
      String(r.status || "").toLowerCase().includes(s)
    );
  }, [items, q]);

  async function onApprove(row) {
    try {
      setBusyId(row.id);
      await approveRequest(row.id, nextChapter || undefined);
      tSuccess("Подтверждено", { autoClose: 1200 });
      setNextChapter("");
      await load();
    } catch {
      tError("Ошибка подтверждения");
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(row) {
    if (!window.confirm("Отклонить заявку?")) return;
    try {
      setBusyId(row.id);
      await rejectRequest(row.id);
      tInfo("Отклонено", { autoClose: 1200 });
      await load();
    } catch {
      tError("Ошибка отклонения");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Inside → Заявки на завершение</h1>
        <div className="ml-auto flex gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-white"
          >
            <option value="pending">Ожидают</option>
            <option value="approved">Подтверждено</option>
            <option value="rejected">Отклонено</option>
            <option value="all">Все</option>
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск (user_id/глава/статус)"
            className="border rounded-lg px-3 py-2 w-64"
          />
          <button
            onClick={load}
            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
          >
            Обновить
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow border overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-2">ID</th>
              <th className="text-left px-4 py-2">Пользователь</th>
              <th className="text-left px-4 py-2">Глава</th>
              <th className="text-left px-4 py-2">Статус</th>
              <th className="text-left px-4 py-2">Создано</th>
              <th className="text-left px-4 py-2">Решение</th>
              <th className="text-left px-4 py-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={7}>Загрузка…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td className="px-4 py-6 text-gray-500" colSpan={7}>Нет данных</td></tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2">{r.id}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium">user_id: {r.user_id}</div>
                  </td>
                  <td className="px-4 py-2"><ChapterBadge chapter={r.chapter} /></td>
                  <td className="px-4 py-2">{r.status}</td>
                  <td className="px-4 py-2">
                    {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {r.decided_at ? new Date(r.decided_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {r.status === "pending" ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={nextChapter}
                          onChange={(e) => setNextChapter(e.target.value)}
                          className="border rounded-lg px-2 py-1 text-xs bg-white"
                          title="Следующая глава (опционально)"
                        >
                          <option value="">следующая автоматически</option>
                          {CHAPTERS.map((c) => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => onApprove(r)}
                          disabled={busyId === r.id}
                          className="px-2 py-1 rounded bg-emerald-600 text-white text-xs disabled:opacity-60"
                        >
                          {busyId === r.id ? "..." : "Подтвердить"}
                        </button>
                        <button
                          onClick={() => onReject(r)}
                          disabled={busyId === r.id}
                          className="px-2 py-1 rounded border text-xs hover:bg-gray-50 disabled:opacity-60"
                        >
                          Отклонить
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        Подсказка: если не выбрана «Следующая глава», система возьмёт следующую по порядку.
        При достижении 4/4 статус участника становится <b>completed</b>.
      </div>
    </div>
  );
}
