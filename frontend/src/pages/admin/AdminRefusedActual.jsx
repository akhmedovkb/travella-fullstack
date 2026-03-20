// frontend/src/pages/admin/AdminRefusedActual.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

/**
 * Admin tool: shows refused_* services + manual actions
 *
 * Backend endpoints:
 *  - GET    /api/admin/refused/actual
 *  - GET    /api/admin/refused/:id
 *  - POST   /api/admin/refused/:id/ask-actual?force=1
 *  - POST   /api/admin/refused/:id/extend
 *  - DELETE /api/admin/refused/:id
 *  - POST   /api/admin/refused/:id/restore
 */

function getAuthToken() {
  return (
    localStorage.getItem("token") ||
    localStorage.getItem("adminToken") ||
    localStorage.getItem("providerToken") ||
    sessionStorage.getItem("token") ||
    ""
  );
}

function getRuntimeApiBase() {
  try {
    const v = window?.frontend?.API_BASE;
    return (v || "").toString().trim();
  } catch {
    return "";
  }
}

function getEnvApiBase() {
  const v =
    (
      import.meta?.env?.VITE_API_BASE_URL ||
      import.meta?.env?.VITE_API_URL ||
      import.meta?.env?.VITE_API_BASE ||
      ""
    )
      .toString()
      .trim();
  return v;
}

function normalizeApiBase(raw) {
  return (raw || "").toString().trim().replace(/\/+$/, "");
}

function computeApiPrefix(base) {
  if (!base) return "/api";
  const b = base.replace(/\/+$/, "");
  return b.endsWith("/api") ? "" : "/api";
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

function isProbablyHtmlPayload(data, contentType) {
  if (contentType && String(contentType).toLowerCase().includes("text/html")) {
    return true;
  }
  if (typeof data !== "string") return false;
  const t = data.trim().slice(0, 200).toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

function extractAxiosError(e) {
  const status = e?.response?.status || e?.__resp?.status;
  const contentType =
    e?.response?.headers?.["content-type"] ||
    e?.__resp?.headers?.["content-type"];
  const data = e?.response?.data ?? e?.__resp?.data;

  let msg =
    e?.response?.data?.message ||
    e?.response?.data?.error ||
    e?.message ||
    "Ошибка";

  if (isProbablyHtmlPayload(data, contentType)) {
    const hint =
      "API вернул HTML вместо JSON. Обычно это значит, что API_BASE не настроен и запрос ушёл на фронтенд вместо backend.";
    msg = `${hint} (status=${status || "?"}, content-type=${contentType || "?"})`;
  } else if (typeof data === "string" && data.trim()) {
    msg = `${msg} (status=${status || "?"})`;
  } else if (status) {
    msg = `${msg} (status=${status})`;
  }

  const snippet =
    typeof data === "string" ? data.trim().slice(0, 180) : null;

  return { msg, status, contentType, snippet };
}

function readUrlSort() {
  try {
    const sp = new URLSearchParams(window.location.search || "");
    const sortBy = (sp.get("sortBy") || "sort_date").toLowerCase();
    const sortOrder =
      (sp.get("sortOrder") || "asc").toLowerCase() === "desc" ? "desc" : "asc";

    const allowed = new Set(["created_at", "provider", "sort_date"]);
    return {
      sortBy: allowed.has(sortBy) ? sortBy : "sort_date",
      sortOrder,
    };
  } catch {
    return { sortBy: "sort_date", sortOrder: "asc" };
  }
}

function writeUrlSort(sortBy, sortOrder) {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("sortBy", sortBy);
    url.searchParams.set("sortOrder", sortOrder);
    window.history.replaceState({}, "", url.toString());
  } catch {
    // ignore
  }
}

function SortBadge({ active, dir }) {
  if (!active) return null;
  return (
    <span
      className={classNames(
        "ml-2 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        dir === "asc"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : "border-indigo-200 bg-indigo-50 text-indigo-700"
      )}
    >
      {dir === "asc" ? "ASC" : "DESC"}
    </span>
  );
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
        <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <div className="text-base font-semibold text-gray-900">{title}</div>
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Закрыть
            </button>
          </div>
          <div className="max-h-[75vh] overflow-auto p-5">{children}</div>
          {footer ? (
            <div className="border-t border-gray-200 bg-gray-50 px-5 py-4">
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

  const base = useMemo(() => {
    const env = normalizeApiBase(getEnvApiBase());
    const rt = normalizeApiBase(getRuntimeApiBase());
    return env || rt || "";
  }, []);

  const apiPrefix = useMemo(() => computeApiPrefix(base), [base]);
  const apiPath = (p) => `${apiPrefix}${p.startsWith("/") ? p : `/${p}`}`;

  const http = useMemo(() => {
    const inst = axios.create({
      baseURL: base || "",
      withCredentials: true,
      timeout: 20000,
      validateStatus: () => true,
    });

    inst.interceptors.request.use((config) => {
      const t = getAuthToken();
      if (t) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${t}`;
      }
      return config;
    });

    return inst;
  }, [base]);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [actuality, setActuality] = useState("actual");
  const [visibility, setVisibility] = useState("active"); // active | deleted | all

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);

  const initialSort = useMemo(() => readUrlSort(), []);
  const [sortBy, setSortBy] = useState(initialSort.sortBy);
  const [sortOrder, setSortOrder] = useState(initialSort.sortOrder);

  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [unlockCfgLoading, setUnlockCfgLoading] = useState(false);
  const [unlockCfgSaving, setUnlockCfgSaving] = useState(false);
  const [unlockIsPaid, setUnlockIsPaid] = useState(true);
  const [unlockPrice, setUnlockPrice] = useState("10000");
  const [unlockUpdatedAt, setUnlockUpdatedAt] = useState(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsItem, setDetailsItem] = useState(null);

  const [sendingId, setSendingId] = useState(null);

  const pageCount = useMemo(() => {
    const c = Math.ceil((total || 0) / (limit || 1));
    return Math.max(c, 1);
  }, [total, limit]);

  const canUse = useMemo(() => !!token, [token]);

  const baseLooksMissing = useMemo(() => {
    if (base) return false;
    const host = (window?.location?.hostname || "").toLowerCase();
    return host && host !== "localhost" && host !== "127.0.0.1";
  }, [base]);

  function showToast(kind, text) {
    const entry = { kind, text, at: Date.now() };
    setToast(entry);
    setTimeout(() => {
      setToast((t) => (t?.at === entry.at ? null : t));
    }, 2800);
  }

  function ensureJsonOrThrow(resp, where = "") {
    const statusCode = resp?.status;
    const contentType = resp?.headers?.["content-type"];
    const data = resp?.data;

    if (!statusCode || statusCode < 200 || statusCode >= 300) {
      const msg =
        data?.message ||
        data?.error ||
        (typeof data === "string" ? data.slice(0, 120) : null) ||
        `HTTP ${statusCode || "?"}`;
      const err = new Error(
        `${msg} (status=${statusCode || "?"}${where ? `, ${where}` : ""})`
      );
      err.__resp = resp;
      throw err;
    }

    if (isProbablyHtmlPayload(data, contentType)) {
      const err = new Error(
        `API вернул HTML вместо JSON (${where || "request"}). Проверь VITE_API_BASE_URL или window.frontend.API_BASE.`
      );
      err.__resp = resp;
      throw err;
    }

    if (!data || typeof data !== "object") {
      const err = new Error(
        `Bad response (${where || "request"}): ожидали JSON-объект`
      );
      err.__resp = resp;
      throw err;
    }

    return data;
  }

    async function loadContactUnlockSettings() {
    setUnlockCfgLoading(true);
    try {
      const resp = await http.get(apiPath("/admin/billing/contact-unlock-settings"));
      const data = ensureJsonOrThrow(resp, "loadContactUnlockSettings");

      if (!data?.ok) {
        throw new Error(data?.message || "Не удалось загрузить настройки");
      }

      setUnlockIsPaid(Boolean(data.is_paid));
      setUnlockPrice(String(data.price ?? 10000));
      setUnlockUpdatedAt(data.updated_at || null);
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg || "Ошибка загрузки настроек открытия контактов");
    } finally {
      setUnlockCfgLoading(false);
    }
  }

  async function saveContactUnlockSettings() {
    const priceNum = Math.max(0, Math.trunc(Number(unlockPrice || 0)));

    if (!Number.isFinite(priceNum)) {
      showToast("err", "❌ Некорректная цена");
      return;
    }

    setUnlockCfgSaving(true);
    setError("");

    try {
      const resp = await http.put(
        apiPath("/admin/billing/contact-unlock-settings"),
        {
          is_paid: unlockIsPaid,
          price: priceNum,
        }
      );

      const data = ensureJsonOrThrow(resp, "saveContactUnlockSettings");

      if (!data?.ok) {
        throw new Error(data?.message || "Не удалось сохранить настройки");
      }

      setUnlockIsPaid(Boolean(data.is_paid));
      setUnlockPrice(String(data.price ?? priceNum));
      setUnlockUpdatedAt(data.updated_at || null);

      showToast(
        "ok",
        data?.is_paid
          ? "✅ Открытие контактов переведено в платный режим"
          : "✅ Открытие контактов переведено в бесплатный режим"
      );
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
    } finally {
      setUnlockCfgSaving(false);
    }
  }

  const thClass = (field) =>
    classNames(
      "px-3 py-2 text-left font-medium select-none",
      "cursor-pointer hover:text-blue-700",
      sortBy === field ? "bg-blue-50/60 text-blue-900" : ""
    );

  const tdClass = (field) =>
    classNames("px-3 py-2", sortBy === field ? "bg-blue-50/30" : "");

  const iconClass = (field) =>
    classNames(sortBy === field ? "text-blue-700" : "text-gray-400", "ml-1");

  function toggleSort(field) {
    setPage(1);
    setSortBy((prev) => {
      const nextBy = field;
      const nextOrder =
        prev === nextBy ? (sortOrder === "asc" ? "desc" : "asc") : "asc";
      setSortOrder(nextOrder);
      writeUrlSort(nextBy, nextOrder);
      return nextBy;
    });
  }

  const sortIcon = (field) =>
    sortBy === field ? (sortOrder === "asc" ? "▲" : "▼") : "";

  async function loadList(nextPage = page) {
    setLoading(true);
    setError("");
    try {
      const showDeleted = visibility === "active" ? "0" : "1";
      const effectiveStatus =
        visibility === "deleted" ? "deleted" : status || "";

      const resp = await http.get(apiPath("/admin/refused/actual"), {
        params: {
          category: category || "",
          status: effectiveStatus,
          q: q || "",
          page: nextPage,
          limit,
          actuality,
          showDeleted,
          sortBy,
          sortOrder,
        },
      });

      const data = ensureJsonOrThrow(resp, "loadList");
      if (!data?.success) throw new Error(data?.message || "Bad response");

      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total || 0));
    } catch (e) {
      const info = extractAxiosError(e);
      const resp = e?.__resp;
      const ct = resp?.headers?.["content-type"];
      const data = resp?.data;

      let msg = info.msg;
      if (isProbablyHtmlPayload(data, ct)) {
        msg +=
          " → Настрой API_BASE: VITE_API_BASE_URL или window.frontend.API_BASE.";
      } else if (info.snippet) {
        msg = `${msg}. Ответ: ${info.snippet}`;
      }

      setError(msg);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(1);
  }, [category, status, actuality, visibility, limit, sortBy, sortOrder]);

  useEffect(() => {
    if (!canUse) return;
    loadList(1);
    loadContactUnlockSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUse, category, status, actuality, visibility, limit, sortBy, sortOrder]);

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
      const resp = await http.get(apiPath(`/admin/refused/${id}`));
      const data = ensureJsonOrThrow(resp, "openDetails");
      if (!data?.success) throw new Error(data?.message || "Bad response");
      setDetailsItem(data.item || null);
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg || "Ошибка загрузки деталей");
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
        apiPath(`/admin/refused/${id}/ask-actual`),
        null,
        { params: { force: force ? "1" : "0" } }
      );

      const data = ensureJsonOrThrow(resp, "askActual");
      if (!data?.success) {
        if (data?.locked && data?.meta?.lockUntil) {
          showToast(
            "warn",
            `⏳ Заблокировано до ${formatDate(data.meta.lockUntil)}`
          );
          return;
        }
        throw new Error(data?.message || "Не удалось отправить");
      }

      if (data?.sent || data?.ok) {
        showToast("ok", `✅ Отправлено, chatId=${data?.chatId || "—"}`);
      } else {
        showToast(
          "warn",
          `⚠️ Не отправлено: ${data?.tg?.error || data?.message || "unknown"}`
        );
      }

      await loadList(page);
      if (detailsItem?.id === id) {
        await openDetails(id);
      }
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
    } finally {
      setSendingId(null);
    }
  }

  async function extendService(id) {
    setSendingId(id);
    setError("");
    try {
      const resp = await http.post(apiPath(`/admin/refused/${id}/extend`));
      const data = ensureJsonOrThrow(resp, "extendService");
      if (!data?.success) {
        throw new Error(data?.message || "Не удалось продлить");
      }

      showToast("ok", "✅ Продлено на 7 дней");
      await loadList(page);

      if (detailsItem?.id === id) {
        await openDetails(id);
      }
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
    } finally {
      setSendingId(null);
    }
  }

  async function deleteService(id) {
    const ok = window.confirm(`Удалить услугу #${id}?`);
    if (!ok) return;

    setSendingId(id);
    setError("");
    try {
      const resp = await http.delete(apiPath(`/admin/refused/${id}`));
      const data = ensureJsonOrThrow(resp, "deleteService");
      if (!data?.success) {
        throw new Error(data?.message || "Не удалось удалить");
      }

      showToast("ok", "✅ Услуга удалена");

      if (detailsItem?.id === id) {
        await openDetails(id);
      }
      await loadList(page);
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
    } finally {
      setSendingId(null);
    }
  }

  async function restoreService(id) {
    setSendingId(id);
    setError("");
    try {
      const resp = await http.post(apiPath(`/admin/refused/${id}/restore`));
      const data = ensureJsonOrThrow(resp, "restoreService");
      if (!data?.success) {
        throw new Error(data?.message || "Не удалось восстановить");
      }

      showToast("ok", "✅ Услуга восстановлена");

      if (detailsItem?.id === id) {
        await openDetails(id);
      }
      await loadList(page);
    } catch (e) {
      const info = extractAxiosError(e);
      setError(info.msg);
      showToast("err", `❌ ${info.msg}`);
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

  const actualityOptions = [
    { value: "all", label: "Все" },
    { value: "actual", label: "Только актуальные" },
    { value: "inactive", label: "Только неактуальные" },
  ];

  const visibilityOptions = [
    { value: "active", label: "Активные" },
    { value: "deleted", label: "Удалённые" },
    { value: "all", label: "Все" },
  ];

  const sortLabel = useMemo(() => {
    const name =
      sortBy === "created_at"
        ? "Дата создания"
        : sortBy === "provider"
        ? "Провайдер"
        : "Дата (сорт)";
    const arrow = sortOrder === "asc" ? "↑" : "↓";
    return `${name} ${arrow}`;
  }, [sortBy, sortOrder]);

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Все отказные услуги
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Список всех refused_* услуг. Можно фильтровать актуальные,
            неактуальные и удалённые, вручную спросить актуальность у поставщика,
            продлить, удалить или восстановить услугу.
          </p>
          <div className="mt-2 text-xs text-gray-500">
            API base:{" "}
            <span className="font-mono">{base ? base : "— (не задан)"}</span>
            {" • "}
            prefix: <span className="font-mono">{apiPrefix || "—"}</span>
          </div>
        </div>

        {toast ? (
          <div
            className={classNames(
              "rounded-xl border px-4 py-2 text-sm shadow-sm",
              toast.kind === "ok" &&
                "border-green-200 bg-green-50 text-green-800",
              toast.kind === "warn" &&
                "border-amber-200 bg-amber-50 text-amber-900",
              toast.kind === "err" &&
                "border-red-200 bg-red-50 text-red-800"
            )}
          >
            {toast.text}
          </div>
        ) : null}
      </div>

      {!canUse ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
          Не найден JWT токен в localStorage/sessionStorage. Админ-страница
          требует авторизацию.
        </div>
      ) : null}

      {canUse && baseLooksMissing ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <div className="font-semibold">API_BASE не настроен</div>
          <div className="mt-1 text-sm">
            Сейчас base пустой, а домен не localhost — запросы уйдут на фронтенд
            и вернут HTML.
            <div className="mt-2">
              Настрой env:{" "}
              <span className="font-mono">
                VITE_API_BASE_URL=https://api.travella.uz
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              Открытие контактов
            </div>
            <div className="mt-1 text-xs text-gray-500">
              Этот переключатель влияет и на сайт, и на Telegram-бот.
              {unlockUpdatedAt ? ` Обновлено: ${formatDate(unlockUpdatedAt)}` : ""}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-end">
            <div>
              <label className="text-xs font-medium text-gray-600">Режим</label>
              <select
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
                value={unlockIsPaid ? "paid" : "free"}
                onChange={(e) => setUnlockIsPaid(e.target.value === "paid")}
                disabled={unlockCfgLoading || unlockCfgSaving}
              >
                <option value="paid">Платно</option>
                <option value="free">Бесплатно</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">
                Цена (сум)
              </label>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                value={unlockPrice}
                onChange={(e) => setUnlockPrice(e.target.value)}
                disabled={!unlockIsPaid || unlockCfgLoading || unlockCfgSaving}
                placeholder="10000"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={loadContactUnlockSettings}
                disabled={unlockCfgLoading || unlockCfgSaving}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {unlockCfgLoading ? "Загрузка…" : "Обновить"}
              </button>

              <button
                onClick={saveContactUnlockSettings}
                disabled={unlockCfgLoading || unlockCfgSaving}
                className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {unlockCfgSaving ? "Сохранение…" : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
          <div className="md:col-span-3">
            <label className="text-xs font-medium text-gray-600">
              Категория
            </label>
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
              disabled={visibility === "deleted"}
            >
              {statuses.map((s) => (
                <option key={s.value || "default"} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-medium text-gray-600">
              Видимость
            </label>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
            >
              {visibilityOptions.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="text-xs font-medium text-gray-600">
              Актуальность
            </label>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gray-200"
              value={actuality}
              onChange={(e) => setActuality(e.target.value)}
            >
              {actualityOptions.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-8">
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

          <div className="md:col-span-2 flex items-center justify-end gap-3 pt-1">
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

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-600">
            Сортировка:{" "}
            <span className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-gray-800">
              {sortLabel}
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-auto rounded-xl border border-gray-200">
          <table className="min-w-[1080px] w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 text-gray-700">
              <tr>
                <th className="px-3 py-2 text-left font-medium">ID</th>
                <th className="px-3 py-2 text-left font-medium">Категория</th>
                <th className="px-3 py-2 text-left font-medium">Название</th>
                <th
                  className={thClass("created_at")}
                  onClick={() => toggleSort("created_at")}
                  title="Сортировать по дате создания"
                >
                  Дата создания
                  <span className={iconClass("created_at")}>
                    {sortIcon("created_at")}
                  </span>
                  <SortBadge
                    active={sortBy === "created_at"}
                    dir={sortOrder}
                  />
                </th>
                <th
                  className={thClass("sort_date")}
                  onClick={() => toggleSort("sort_date")}
                  title="Сортировать по ближайшей дате услуги"
                >
                  Дата (сорт)
                  <span className={iconClass("sort_date")}>
                    {sortIcon("sort_date")}
                  </span>
                  <SortBadge active={sortBy === "sort_date"} dir={sortOrder} />
                </th>
                <th
                  className={thClass("provider")}
                  onClick={() => toggleSort("provider")}
                  title="Сортировать по провайдеру"
                >
                  Провайдер
                  <span className={iconClass("provider")}>
                    {sortIcon("provider")}
                  </span>
                  <SortBadge active={sortBy === "provider"} dir={sortOrder} />
                </th>
                <th className="px-3 py-2 text-left font-medium">TG</th>
                <th className="px-3 py-2 text-left font-medium">Meta</th>
                <th className="px-3 py-2 text-left font-medium">Действия</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td className="px-3 py-3 text-gray-600" colSpan={9}>
                    Загрузка…
                  </td>
                </tr>
              ) : items.length ? (
                items.map((it) => {
                  const tgOk = !!it?.provider?.chatId;
                  const actual = !!it.isActual;
                  const deleted =
                    !!it.deletedAt ||
                    String(it.status || "").toLowerCase() === "deleted";

                  const meta = it.meta || {};
                  const lockUntil = meta.lockUntil;
                  const lastSentAt = meta.lastSentAt;
                  const lastAnswer = meta.lastAnswer;
                  const lastSentBy = String(meta.lastSentBy || "").toLowerCase();

                  const sentBadge =
                    lastSentBy === "job"
                      ? {
                          text: "AUTO",
                          cls: "border-violet-200 bg-violet-50 text-violet-700",
                        }
                      : lastSentBy === "admin"
                      ? {
                          text: "ADMIN",
                          cls: "border-sky-200 bg-sky-50 text-sky-700",
                        }
                      : null;

                  return (
                    <tr key={it.id} className="bg-white hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-900">
                        {it.id}
                      </td>

                      <td className="whitespace-nowrap px-3 py-2">
                        <Badge tone="blue">{it.category}</Badge>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={actual ? "green" : "red"}>
                            {actual ? "actual" : "inactive"}
                          </Badge>
                          {deleted ? <Badge tone="amber">deleted</Badge> : null}
                        </div>
                      </td>

                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">
                          {short(
                            it.title ||
                              it.details?.hotel ||
                              it.details?.hotelName ||
                              "—",
                            70
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-600">
                          status: <span className="font-mono">{it.status}</span>
                        </div>
                      </td>

                      <td
                        className={classNames(
                          tdClass("created_at"),
                          "whitespace-nowrap"
                        )}
                      >
                        {it.createdAt ? (
                          <div className="text-gray-900">
                            {formatDate(it.createdAt)}
                          </div>
                        ) : (
                          <div className="text-gray-500">—</div>
                        )}
                      </td>

                      <td
                        className={classNames(
                          tdClass("sort_date"),
                          "whitespace-nowrap"
                        )}
                      >
                        {it.startDateForSort ? (
                          <div className="text-gray-900">
                            {formatDate(it.startDateForSort)}
                          </div>
                        ) : (
                          <div className="text-gray-500">—</div>
                        )}
                      </td>

                      <td className={tdClass("provider")}>
                        <div className="font-medium text-gray-900">
                          {it?.provider?.companyName || it?.provider?.name || "—"}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-600">
                          {it?.provider?.phone ? `📞 ${it.provider.phone}` : ""}
                          {it?.provider?.telegramUsername
                            ? ` • @${it.provider.telegramUsername}`
                            : ""}
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-3 py-2">
                        <Badge tone={tgOk ? "green" : "red"}>
                          {tgOk ? "chatId OK" : "нет chatId"}
                        </Badge>
                        {tgOk ? (
                          <div className="mt-0.5 font-mono text-xs text-gray-600">
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
                          {lastSentAt && sentBadge ? (
                            <span
                              className={classNames(
                                "ml-1 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none",
                                sentBadge.cls
                              )}
                            >
                              {sentBadge.text}
                            </span>
                          ) : null}
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

                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openDetails(it.id)}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
                          >
                            Детали
                          </button>

                          {!deleted ? (
                            <>
                              <button
                                onClick={() => askActual(it.id, false)}
                                disabled={!tgOk || sendingId === it.id}
                                className={classNames(
                                  "rounded-lg border px-3 py-1.5 text-xs",
                                  !tgOk || sendingId === it.id
                                    ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                                    : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                                )}
                                title={
                                  !tgOk
                                    ? "У провайдера нет telegram chatId"
                                    : "Спросить актуальность"
                                }
                              >
                                {sendingId === it.id ? "Отправка…" : "Спросить"}
                              </button>

                              <button
                                onClick={() => askActual(it.id, true)}
                                disabled={!tgOk || sendingId === it.id}
                                className={classNames(
                                  "rounded-lg border px-3 py-1.5 text-xs",
                                  !tgOk || sendingId === it.id
                                    ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                                    : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                                )}
                                title="Принудительно, даже если lockUntil не прошёл"
                              >
                                Force
                              </button>

                              <button
                                onClick={() => extendService(it.id)}
                                disabled={sendingId === it.id}
                                className={classNames(
                                  "rounded-lg border px-3 py-1.5 text-xs",
                                  sendingId === it.id
                                    ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                                    : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                                )}
                                title="Продлить на 7 дней"
                              >
                                Продлить
                              </button>

                              <button
                                onClick={() => deleteService(it.id)}
                                disabled={sendingId === it.id}
                                className={classNames(
                                  "rounded-lg border px-3 py-1.5 text-xs",
                                  sendingId === it.id
                                    ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                                    : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                )}
                                title="Удалить услугу"
                              >
                                Удалить
                              </button>

                              <a
                                href={`/dashboard?from=admin&service=${it.id}`}
                                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
                                target="_blank"
                                rel="noreferrer"
                              >
                                На сайте
                              </a>
                            </>
                          ) : (
                            <button
                              onClick={() => restoreService(it.id)}
                              disabled={sendingId === it.id}
                              className={classNames(
                                "rounded-lg border px-3 py-1.5 text-xs",
                                sendingId === it.id
                                  ? "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400"
                                  : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                              )}
                              title="Восстановить услугу"
                            >
                              Восстановить
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-3 py-3 text-gray-600" colSpan={9}>
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
              Стр. <span className="font-medium text-gray-900">{page}</span> из{" "}
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

              {String(detailsItem?.status || "").toLowerCase() === "deleted" ||
              detailsItem?.deletedAt ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => restoreService(detailsItem.id)}
                    className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100"
                    disabled={sendingId === detailsItem.id}
                  >
                    Восстановить
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => askActual(detailsItem.id, false)}
                    className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100"
                    disabled={
                      !detailsItem?.provider?.chatId ||
                      sendingId === detailsItem.id
                    }
                  >
                    Спросить
                  </button>

                  <button
                    onClick={() => askActual(detailsItem.id, true)}
                    className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 hover:bg-amber-100"
                    disabled={
                      !detailsItem?.provider?.chatId ||
                      sendingId === detailsItem.id
                    }
                  >
                    Force
                  </button>

                  <button
                    onClick={() => extendService(detailsItem.id)}
                    className="rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700 hover:bg-green-100"
                    disabled={sendingId === detailsItem.id}
                  >
                    Продлить
                  </button>

                  <button
                    onClick={() => deleteService(detailsItem.id)}
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100"
                    disabled={sendingId === detailsItem.id}
                  >
                    Удалить
                  </button>
                </div>
              )}
            </div>
          ) : null
        }
      >
        {detailsLoading ? (
          <div className="text-sm text-gray-600">Загрузка…</div>
        ) : detailsItem ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="rounded-2xl border border-gray-200 p-4 md:col-span-5">
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
                  <span className="text-gray-600">Удалена:</span>{" "}
                  <Badge
                    tone={
                      String(detailsItem?.status || "").toLowerCase() ===
                        "deleted" || detailsItem?.deletedAt
                        ? "amber"
                        : "green"
                    }
                  >
                    {String(detailsItem?.status || "").toLowerCase() ===
                      "deleted" || detailsItem?.deletedAt
                      ? "да"
                      : "нет"}
                  </Badge>
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
                <div>
                  <span className="text-gray-600">Deleted at:</span>{" "}
                  <span className="font-mono">
                    {detailsItem.deletedAt
                      ? formatDate(detailsItem.deletedAt)
                      : "—"}
                  </span>
                </div>
              </div>

              <div className="mt-4 border-t border-gray-200 pt-4">
                <div className="text-sm font-semibold text-gray-900">
                  Провайдер
                </div>
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
                    <span className="font-mono">
                      {detailsItem?.provider?.phone || "—"}
                    </span>
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
                    <span className="font-mono">
                      {detailsItem?.provider?.chatId || "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 p-4 md:col-span-7">
              <div className="text-sm font-semibold text-gray-900">
                details (JSON)
              </div>
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
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
