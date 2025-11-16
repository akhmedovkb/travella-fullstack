// frontend/src/pages/admin/AdminInsideChapters.jsx
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

function formatDateShort(dt) {
  if (!dt) return "—";
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function formatRange(a, b) {
  if (!a && !b) return "—";
  if (a && !b) return formatDateShort(a);
  if (!a && b) return formatDateShort(b);
  return `${formatDateShort(a)} — ${formatDateShort(b)}`;
}

function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

// 🔒 helper: минимальное значение для <input type="datetime-local"> (сейчас, локальное время)
function nowLocalInputMin() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

const EMPTY_FORM = {
  chapter_key: "",
  title: "",
  starts_at: "",
  tour_starts_at: "",
  tour_ends_at: "",
  capacity: "",
  enrolled_count: "",
  status: "draft",
};

export default function AdminInsideChapters() {
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingKey, setEditingKey] = useState(null); // chapter_key или null

  // 🔒 min-значение для всех дат в форме (фиксируется при монтировании компонента)
  const [minDateTime] = useState(() => nowLocalInputMin());

  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  async function loadChapters() {
    try {
      setLoading(true);
      setError("");

      // ts в query нужен, чтобы обойти 304/кэш
      const url = `${API_ROOT}/inside/admin/chapters?ts=${Date.now()}`;
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
      setChapters(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("loadChapters error", e);
      setError("Не удалось загрузить главы");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChapters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleEdit(ch) {
    setEditingKey(ch.chapter_key);
    setForm({
      chapter_key: ch.chapter_key || "",
      title: ch.title || "",
      starts_at: toLocalInputValue(ch.starts_at),
      tour_starts_at: toLocalInputValue(ch.tour_starts_at),
      tour_ends_at: toLocalInputValue(ch.tour_ends_at),
      capacity: ch.capacity != null ? String(ch.capacity) : "",
      enrolled_count:
        ch.enrolled_count != null ? String(ch.enrolled_count) : "",
      status: ch.status || "draft",
    });
    setFormError("");
  }

  function handleNew() {
    setEditingKey(null);
    setForm(EMPTY_FORM);
    setFormError("");
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");

    if (!form.chapter_key.trim()) {
      setFormError("Нужно указать ключ главы (chapter_key)");
      return;
    }

    // 🔒 локальный парсер в Date
    const parseLocalToDate = (val) => {
      if (!val) return null;
      const d = new Date(val);
      if (Number.isNaN(d.getTime())) return null;
      return d;
    };

    const now = new Date();
    const startsAtDate = parseLocalToDate(form.starts_at);
    const tourStartsDate = parseLocalToDate(form.tour_starts_at);
    const tourEndsDate = parseLocalToDate(form.tour_ends_at);

    // 🔒 Валидация на прошлые даты
    if (startsAtDate && startsAtDate < now) {
      setFormError("Дата старта набора не может быть в прошлом");
      return;
    }
    if (tourStartsDate && tourStartsDate < now) {
      setFormError("Дата начала тура не может быть в прошлом");
      return;
    }
    if (tourEndsDate && tourEndsDate < now) {
      setFormError("Дата окончания тура не может быть в прошлом");
      return;
    }
    // 🔒 Дополнительно: окончание должно быть позже начала
    if (tourStartsDate && tourEndsDate && tourEndsDate <= tourStartsDate) {
      setFormError("Дата окончания тура должна быть позже даты начала");
      return;
    }

    const toIso = (d) => (d ? d.toISOString() : null);

    try {
      setSaving(true);

      const startsAtIso = toIso(startsAtDate);
      const tourStartsIso = toIso(tourStartsDate);
      const tourEndsIso = toIso(tourEndsDate);

      const body = {
        chapter_key: form.chapter_key.trim(),
        title: form.title.trim() || null,
        starts_at: startsAtIso,
        tour_starts_at: tourStartsIso,
        tour_ends_at: tourEndsIso,
        capacity:
          form.capacity !== "" && form.capacity != null
            ? Number(form.capacity)
            : null,
        enrolled_count:
          form.enrolled_count !== "" && form.enrolled_count != null
            ? Number(form.enrolled_count)
            : null,
        status: form.status || null,
      };

      const res = await fetch(`${API_ROOT}/inside/admin/chapters`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("save chapter error:", text);
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      console.log("chapter saved:", data);

      await loadChapters();
      setEditingKey(body.chapter_key);
    } catch (err) {
      console.error("handleSubmit error", err);
      setFormError("Не удалось сохранить главу");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">India Inside — главы</h1>
        <button
          type="button"
          onClick={handleNew}
          className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          + Новая / другая глава
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Таблица глав */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Ключ
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Название
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Старт набора
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Даты тура
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">
                Лимит
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">
                Зачислено
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">
                Осталось
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">
                Статус
              </th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-4 text-center text-gray-500">
                  Загрузка...
                </td>
              </tr>
            )}

            {!loading && chapters.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-4 text-center text-gray-500">
                  Пока нет ни одной записи о главах.
                </td>
              </tr>
            )}

            {!loading &&
              chapters.map((ch) => {
                const capacity =
                  ch.capacity != null ? Number(ch.capacity) : null;
                const enrolled =
                  ch.enrolled_count != null ? Number(ch.enrolled_count) : 0;
                const left =
                  capacity != null ? Math.max(0, capacity - enrolled) : null;

                return (
                  <tr key={ch.id || ch.chapter_key}>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">
                      {ch.chapter_key}
                    </td>
                    <td className="px-4 py-2 text-gray-800">{ch.title}</td>
                    <td className="px-4 py-2 text-gray-700">
                      {formatDate(ch.starts_at)}
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      {formatRange(ch.tour_starts_at, ch.tour_ends_at)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700">
                      {capacity != null ? capacity : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700">
                      {enrolled}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700">
                      {left != null ? left : "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{ch.status}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleEdit(ch)}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800"
                      >
                        Править
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Форма создания/редактирования */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-semibold">
          {editingKey
            ? `Редактирование главы "${editingKey}"`
            : "Новая глава"}
        </h2>

        {formError && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Ключ главы (chapter_key)
              </label>
              <input
                name="chapter_key"
                type="text"
                value={form.chapter_key}
                onChange={handleChange}
                disabled={!!editingKey}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                placeholder="royal / silence / modern / kerala"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Название (для админки/лендинга)
              </label>
              <input
                name="title"
                type="text"
                value={form.title}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Золотой Треугольник"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Дата и время старта набора (по Ташкенту)
              </label>
              <input
                name="starts_at"
                type="datetime-local"
                value={form.starts_at}
                onChange={handleChange}
                min={minDateTime} // 🔒 нельзя выбрать прошедшую дату
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Можно оставить пустым, если набор ещё не планируется.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Дата начала тура
              </label>
              <input
                name="tour_starts_at"
                type="datetime-local"
                value={form.tour_starts_at}
                onChange={handleChange}
                min={minDateTime} // 🔒 нельзя выбрать прошедшую дату
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Реальная дата выезда / начала путешествия.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Дата окончания тура
              </label>
              <input
                name="tour_ends_at"
                type="datetime-local"
                value={form.tour_ends_at}
                onChange={handleChange}
                min={minDateTime} // 🔒 нельзя выбрать прошедшую дату
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Когда участники возвращаются домой / программа завершена.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Лимит мест (capacity)
              </label>
              <input
                name="capacity"
                type="number"
                min="0"
                value={form.capacity}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="20"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Уже зачислено (enrolled_count)
              </label>
              <input
                name="enrolled_count"
                type="number"
                min="0"
                value={form.enrolled_count}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="0"
              />
              <p className="mt-1 text-xs text-gray-500">
                Можно править вручную, либо позже сделать авто-счётчик от
                заявок.
              </p>
            </div>

            <div>
              <label className="mb-1 block text.sm font-medium text-gray-700">
                Статус
              </label>
              <select
                name="status"
                value={form.status}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="draft">draft (черновик)</option>
                <option value="scheduled">scheduled (запланирована)</option>
                <option value="open">open (набор открыт)</option>
                <option value="closed">closed (набор закрыт)</option>
                <option value="completed">completed (глава завершена)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleNew}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Очистить форму
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "Сохранение..." : "Сохранить главу"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
