// frontend/src/pages/admin/AdminRefusedActual.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

/**
 * Admin tool: shows актуальные refused_* services + manual "ask actual" button
 *
 * Backend endpoints (already in your repo):
 *  - GET  /api/admin/refused/actual
 *  - GET  /api/admin/refused/:id
 *  - POST /api/admin/refused/:id/ask-actual?force=1
 */

function getAuthToken() {
  // adjust if your project stores token differently
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("adminToken") ||
    sessionStorage.getItem("token") ||
    ""
  );
}

function apiBase() {
  // Prefer explicit env; fallback to same-origin (Railway)
  return (
    (import.meta?.env?.VITE_API_BASE_URL || import.meta?.env?.VITE_API_URL || "")
      .toString()
      .trim() || ""
  );
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function short(s, n = 60) {
  const x = (s || "").toString();
  if (x.length <= n) return x;
  return x.slice(0, n - 1) + "…";
}

function classNames(...a) {
  return a.filter(Boolean).join(" ");
}

function Badge({ children, tone = "gray" }) {
  const tones = {
    gray: "bg-gray-100 text-gray-700 border-gray-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
  };
  return (
    <span
      className={classNames(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone] || tones.gray
      )}
    >
      {children}
    </span>
  );
}

function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl rounded-2xl bg-white shadow-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <div className="text-base font-semibold text-gray-900">{title}</div>
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm border border-gray-200 hover:bg-gray-50"
            >
              Закрыть
            </button>
          </div>
          <div className="max-h-[75vh] overflow-auto p-5">{children}</div>
          {footer ? (
            <div className="px-5 py-4 border-t border-gray-200 bg-gray-50">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function AdminRefusedActual() {
  const token = useMemo(() => getAuthToken(), []);
  const base = useMemo(() => apiBase(), []);

  const http = useMemo(() => {
    const inst = axios.create({
      baseURL: base || "", // "" => same-origin
      withCredentials: true,
    });

    inst.interceptors.request.use((config) => {
      const t = getAuthToken();
      if (t) {
        config.headers = config.headers || {};
        // backend expects JWT in Authorization in most routes
        config.headers.Authorization = `Bearer ${t}`;
      }
      return config;
    });

    return inst;
  }, [base]);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  // Filters
  const [category, setCategory] = useState(""); // empty => all refused_*
  const [status, setStatus] = useState(""); // empty => published/approved
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);

  // UI messages
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);

  // Details modal
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsItem, setDetailsItem] = useState(null);

  // Ask actual action state
  const [sendingId, setSendingId] = useState(null);

  const pageCount = useMemo(() => {
    const c = Math.ceil((total || 0) / (limit || 1));
    return Math.max(c, 1);
  }, [total, limit]);

  const canUse = useMemo(() => !!token, [token]);

  function showToast(kind, text) {
    setToast({ kind, text, at: Date.now() });
    setTimeout(() => {
      setToast((t) => (t && t.at ? (Date.now() - t.at > 2500 ? null : t) : null));
    }, 2800);
  }

  async function loadList(nextPage = page) {
    setLoading(true);
    setError("");
    try {
      const resp = await http.get("/api/admin/refused/actual", {
        params: {
          category: category || "",
          status: status || "",
          q: q || "",
          page: nextPage,
          limit,
          includeInactive: includeInactive ? "1" : "0",
        },
      });

      const data = resp?.data;
      if (!data?.success) {
        throw new Error(data?.message || "Bad response");
      }

      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total || 0));
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Ошибка загрузки";
      setError(msg);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // reset to first page on filters change
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, status, includeInactive, limit]);

  useEffect(() => {
    if (!canUse) return;
    loadList(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse, category, status, includeInactive, limit]);

  useEffect(() => {
    if (!canUse) return;
    loadList(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function openDetails(id) {
    setDetailsOpen(true);
    setDetailsLoading(true);
    setDetailsItem(null);
    setError("");
    try {
      const resp = await http.get(`/api/admin/refused/${id}`);
      const data = resp?.data;
      if (!data?.success) throw new Error(data?.message || "Bad response");
      setDetailsItem(data.item);
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Ошибка загрузки деталей";
      setError(msg);
      setDetailsItem(null);
    } finally {
      setDetailsLoading(false);
    }
  }

  async function askActual(id, force = false) {
    setSendingId(id);
    setError("");
    try {
      const resp = await http.post(
        `/api/admin/refused/${id}/ask-actual`,
        null,
        { params: { force: force ? "1" : "0" } }
      );

      const data = resp?.data;
      if (!data?.success) {
        // locked is a "soft" fail — show nice message
        if (data?.locked && data?.meta?.lockUntil) {
          showToast(
            "warn",
            `⏳ Заблокировано до ${formatDate(data.meta.lockUntil)}`
          );
          return;
        }
        throw new Error(data?.message || "Не удалось отправить");
      }

      if (data?.sent) {
        showToast(
          "ok",
          `✅ Отправлено (${data?.used || "bot"}), chatId=${data?.chatId}`
        );
      } else {
        showToast(
          "warn",
          `⚠️ Не отправлено: ${data?.tg?.error || data?.message || "unknown"}`
        );
      }

      // refresh list to update meta fields
      await loadList(page);
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Ошибка отправки";
      setError(msg);
      showToast("err", `❌ ${msg}`);
    } finally {
      setSendingId(null);
    }
  }

  const categories = [
    { value: "", label: "Все отказные" },
    { value: "refused_tour", label: "Отказной тур" },
    { value: "refused_hotel", label: "Отказной отель" },
    { value: "refused_flight", label: "Отказной авиабилет" },
    { value: "refused_ticket", label: "Отказной билет" },
  ];

  const statuses = [
    { value: "", label: "На витрине (published/approved)" },
    { value: "published", label: "published" },
    { value: "approved", label: "approved" },
    { value: "draft", label: "draft" },
    { value: "rejected", label: "rejected" },
  ];

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Актуальные отказы
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Список refused_* услуг, сортировка по ближайшей дате. Можно вручную
            спросить актуальность у поставщика в Telegram.
          </p>
        </div>

        {toast ? (
          <div
            className={classNames(
              "rounded-xl border px-4 py-2 text-sm shadow-sm",
              toast.kind === "ok" && "bg-green-50 border-green-200 text-green-800",
              toast.kind === "warn" && "bg-amber-50 border-amber-200 text-amber-900",
              toast.kind === "err" && "bg-red-50 border-red-200 text-red-800"
            )}
          >
            {toast.text}
          </div>
        ) : null}
      </div>

      {!canUse ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
          Не найден JWT токен в localStorage/sessionStorage. Админ-страница требует
          авторизацию (Authorization: Bearer ...).
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
          <div className="md:col-span-3">
            <label className="text-xs font-medium text-gray-600">Категория</label>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.value || "all"} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-medium text-gray-600">Статус</label>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s.value || "default"} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="text-xs font-medium text-gray-600">Поиск</label>
            <div className="mt-1 flex gap-2">
              <input
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="hotel, direction, provider, phone, username..."
              />
              <button
                onClick={() => {
                  setPage(1);
                  loadList(1);
                }}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
                disabled={loading}
              >
                Найти
              </button>
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-medium text-gray-600">Лимит</label>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              {[20, 30, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-12 flex items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
              />
              Показывать неактуальные тоже
            </label>

            <button
              onClick={() => loadList(page)}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50"
              disabled={loading}
            >
              Обновить
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="mt-4 overflow-auto rounded-xl border border-gray-200">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="px-3 py-2 text-left font-medium">ID</th>
                <th className="px-3 py-2 text-left font-medium">Категория</th>
                <th className="px-3 py-2 text-left font-medium">Название</th>
                <th className="px-3 py-2 text-left font-medium">Дата (сорт)</th>
                <th className="px-3 py-2 text-left font-medium">Провайдер</th>
                <th className="px-3 py-2 text-left font-medium">TG</th>
                <th className="px-3 py-2 text-left font-medium">Meta</th>
                <th className="px-3 py-2 text-left font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td className="px-3 py-3 text-gray-600" colSpan={8}>
                    Загрузка…
                  </td>
                </tr>
              ) : items.length ? (
                items.map((it) => {
                  const tgOk = !!it?.provider?.chatId;
                  const actual = !!it.isActual;

                  const meta = it.meta || {};
                  const lockUntil = meta.lockUntil;
                  const lastSentAt = meta.lastSentAt;
                  const lastAnswer = meta.lastAnswer;

                  return (
                    <tr key={it.id} className="bg-white">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-900">
                        {it.id}
                      </td>

                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge tone="blue">{it.category}</Badge>
                        <div className="mt-1">
                          <Badge tone={actual ? "green" : "red"}>
                            {actual ? "actual" : "inactive"}
                          </Badge>
                        </div>
                      </td>

                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">
                          {short(it.title || it.details?.hotel || it.details?.hotelName || "—", 70)}
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">
                          status: <span className="font-mono">{it.status}</span>
                        </div>
                      </td>

                      <td className="px-3 py-2 whitespace-nowrap">
                        {it.startDateForSort ? (
                          <div className="text-gray-900">{formatDate(it.startDateForSort)}</div>
                        ) : (
                          <div className="text-gray-500">—</div>
                        )}
                      </td>

                      <td className="px-3 py-2">
                        <div className="text-gray-900 font-medium">
                          {it?.provider?.companyName || it?.provider?.name || "—"}
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">
                          {it?.provider?.phone ? `📞 ${it.provider.phone}` : ""}
                          {it?.provider?.telegramUsername
                            ? `  •  @${it.provider.telegramUsername}`
                            : ""}
                        </div>
                      </td>

                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge tone={tgOk ? "green" : "red"}>
                          {tgOk ? "chatId OK" : "нет chatId"}
                        </Badge>
                        {tgOk ? (
                          <div className="text-xs text-gray-600 mt-0.5 font-mono">
                            {it.provider.chatId}
                          </div>
                        ) : null}
                      </td>

                      <td className="px-3 py-2">
                        <div className="text-xs text-gray-700">
                          sent:{" "}
                          <span className="font-mono">
                            {lastSentAt ? formatDate(lastSentAt) : "—"}
                          </span>
                        </div>
                        <div className="text-xs text-gray-700">
                          answer:{" "}
                          <span className="font-mono">
                            {lastAnswer ? String(lastAnswer) : "—"}
                          </span>
                        </div>
                        <div className="text-xs text-gray-700">
                          lock:{" "}
                          <span className="font-mono">
                            {lockUntil ? formatDate(lockUntil) : "—"}
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openDetails(it.id)}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
                          >
                            Детали
                          </button>

                          <button
                            onClick={() => askActual(it.id, false)}
                            disabled={!tgOk || sendingId === it.id}
                            className={classNames(
                              "rounded-lg px-3 py-1.5 text-xs border",
                              !tgOk || sendingId === it.id
                                ? "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed"
                                : "border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100"
                            )}
                            title={!tgOk ? "У провайдера нет telegram chatId" : "Спросить актуальность"}
                          >
                            {sendingId === it.id ? "Отправка…" : "Спросить"}
                          </button>

                          <button
                            onClick={() => askActual(it.id, true)}
                            disabled={!tgOk || sendingId === it.id}
                            className={classNames(
                              "rounded-lg px-3 py-1.5 text-xs border",
                              !tgOk || sendingId === it.id
                                ? "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed"
                                : "border-amber-200 text-amber-900 bg-amber-50 hover:bg-amber-100"
                            )}
                            title="Принудительно, даже если lockUntil не прошёл"
                          >
                            Force
                          </button>

                          <a
                            href={`/dashboard?from=admin&service=${it.id}`}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
                            target="_blank"
                            rel="noreferrer"
                          >
                            На сайте
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-3 py-3 text-gray-600" colSpan={8}>
                    Нет данных.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-gray-600">
            Всего: <span className="font-medium text-gray-900">{total}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              ← Назад
            </button>
            <div className="text-sm text-gray-700">
              Стр.{" "}
              <span className="font-medium text-gray-900">{page}</span> из{" "}
              <span className="font-medium text-gray-900">{pageCount}</span>
            </div>
            <button
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount || loading}
            >
              Вперёд →
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={detailsOpen}
        title={
          detailsItem
            ? `Отказ #${detailsItem.id} — ${detailsItem.category}`
            : "Детали отказа"
        }
        onClose={() => setDetailsOpen(false)}
        footer={
          detailsItem ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-gray-600">
                Провайдер:{" "}
                <span className="font-medium text-gray-900">
                  {detailsItem?.provider?.companyName ||
                    detailsItem?.provider?.name ||
                    "—"}
                </span>
                {detailsItem?.provider?.chatId ? (
                  <span className="ml-2 font-mono text-xs text-gray-600">
                    chatId: {detailsItem.provider.chatId}
                  </span>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => askActual(detailsItem.id, false)}
                  className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100"
                  disabled={!detailsItem?.provider?.chatId || sendingId === detailsItem.id}
                >
                  Спросить
                </button>
                <button
                  onClick={() => askActual(detailsItem.id, true)}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 hover:bg-amber-100"
                  disabled={!detailsItem?.provider?.chatId || sendingId === detailsItem.id}
                >
                  Force
                </button>
              </div>
            </div>
          ) : null
        }
      >
        {detailsLoading ? (
          <div className="text-sm text-gray-600">Загрузка…</div>
        ) : detailsItem ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-5 rounded-2xl border border-gray-200 p-4">
              <div className="text-sm font-semibold text-gray-900">Основное</div>
              <div className="mt-3 space-y-2 text-sm text-gray-800">
                <div>
                  <span className="text-gray-600">ID:</span>{" "}
                  <span className="font-mono">{detailsItem.id}</span>
                </div>
                <div>
                  <span className="text-gray-600">Категория:</span>{" "}
                  <span className="font-mono">{detailsItem.category}</span>
                </div>
                <div>
                  <span className="text-gray-600">Статус:</span>{" "}
                  <span className="font-mono">{detailsItem.status}</span>
                </div>
                <div>
                  <span className="text-gray-600">Актуален:</span>{" "}
                  <Badge tone={detailsItem.isActual ? "green" : "red"}>
                    {detailsItem.isActual ? "да" : "нет"}
                  </Badge>
                </div>
                <div>
                  <span className="text-gray-600">Дата (сорт):</span>{" "}
                  <span className="font-mono">
                    {detailsItem.startDateForSort
                      ? formatDate(detailsItem.startDateForSort)
                      : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Title:</span>{" "}
                  <span>{detailsItem.title || "—"}</span>
                </div>
              </div>

              <div className="mt-4 border-t border-gray-200 pt-4">
                <div className="text-sm font-semibold text-gray-900">Провайдер</div>
                <div className="mt-3 space-y-2 text-sm text-gray-800">
                  <div>
                    <span className="text-gray-600">Компания/имя:</span>{" "}
                    <span>
                      {detailsItem?.provider?.companyName ||
                        detailsItem?.provider?.name ||
                        "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Телефон:</span>{" "}
                    <span className="font-mono">{detailsItem?.provider?.phone || "—"}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Username:</span>{" "}
                    <span className="font-mono">
                      {detailsItem?.provider?.telegramUsername
                        ? `@${detailsItem.provider.telegramUsername}`
                        : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">chatId:</span>{" "}
                    <span className="font-mono">{detailsItem?.provider?.chatId || "—"}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="md:col-span-7 rounded-2xl border border-gray-200 p-4">
              <div className="text-sm font-semibold text-gray-900">details (JSON)</div>
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-gray-50 border border-gray-200 p-3 text-xs text-gray-800">
                {JSON.stringify(detailsItem.details || {}, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-600">Нет данных.</div>
        )}
      </Modal>
    </div>
  );
}
