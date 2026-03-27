//frontend/src/pages/admin/AdminClients.jsx

import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "react-toastify";
import axios from "axios";
import { apiDelete, apiGet, apiPost } from "../../api";
import ClientAccessModal from "../../components/admin/ClientAccessModal";

const LS_KEY = "admin.clients.lastSeenISO";

function useLastSeen() {
  const [lastSeen, setLastSeen] = useState(() => {
    return localStorage.getItem(LS_KEY) || new Date(0).toISOString();
  });

  const save = (iso) => {
    localStorage.setItem(LS_KEY, iso);
    setLastSeen(iso);
  };

  return [lastSeen, save];
}

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString("ru-RU");
}
function toTiyin(sumValue) {
  return Math.round(Number(sumValue || 0) * 100);
}

function fromTiyin(tiyinValue) {
  return Math.round(Number(tiyinValue || 0) / 100);
}
function fmtCellDate(x) {
  if (!x) return "—";
  try {
    const d = new Date(x);
    const date = d.toLocaleDateString("ru-RU");
    const time = d.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return `${date}, ${time}`;
  } catch {
    return String(x);
  }
}

function getAuthHeader() {
  const token =
    localStorage.getItem("adminToken") ||
    localStorage.getItem("providerToken") ||
    localStorage.getItem("token") ||
    "";

  return token ? { Authorization: `Bearer ${token}` } : {};
}

function StatCard({ label, value, sub, valueClass = "" }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-white p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={`mt-1 text-lg xl:text-2xl font-semibold leading-tight break-words whitespace-normal ${valueClass}`}
      >
        {value}
      </div>
      <div className="mt-1 text-sm text-gray-500 break-words whitespace-normal">{sub}</div>
    </div>
  );
}

function CellText({ children, className = "", title }) {
  return (
    <div
      className={`truncate whitespace-nowrap ${className}`}
      title={title ?? (typeof children === "string" ? children : undefined)}
    >
      {children || "—"}
    </div>
  );
}

export default function AdminClients() {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [lastSeen, setLastSeen] = useLastSeen();
  const pollTimer = useRef(null);

  const [selectedClient, setSelectedClient] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const [unlockSettings, setUnlockSettings] = useState({
    is_paid: true,
    price: 10000,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  const [dashboard, setDashboard] = useState({
    mode: "paid",
    is_paid: true,
    price: 0,
    clients_total: 0,
    balance_total: 0,
    unlocks_total: 0,
    unlocks_today: 0,
    revenue_total: 0,
    revenue_today: 0,
  });

  const loadUnlockSettings = useCallback(async () => {
    try {
      const res = await apiGet("/api/admin/billing/contact-unlock-settings", "admin");
      const data = res?.data || res;

      if (data?.settings) {
          setUnlockSettings({
            is_paid: data.settings.is_paid,
            price: fromTiyin(data.settings.price),
          });
      } else if (typeof data?.is_paid !== "undefined") {
        setUnlockSettings({
          is_paid: data.is_paid,
          price: fromTiyin(data.price),
        });
      }
    } catch (e) {
      console.warn("[unlock settings] load failed", e?.message || e);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await apiGet("/api/admin/clients/dashboard", "admin");
      const data = res?.data || res;
      if (data?.dashboard) {
        setDashboard(data.dashboard);
      }
    } catch (e) {
      console.warn("[AdminClients] dashboard load failed:", e?.message || e);
    }
  }, []);

  const fetchList = useCallback(
    async (opts = {}) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (q) params.set("q", q);
        if (opts.limit) params.set("limit", String(opts.limit));
        if (opts.cursor?.cursor_created_at && opts.cursor?.cursor_id) {
          params.set("cursor_created_at", opts.cursor.cursor_created_at);
          params.set("cursor_id", opts.cursor.cursor_id);
        }

        const res = await apiGet(`/api/admin/clients-table?${params.toString()}`, "provider");
        const payload =
          res && res.data && (res.data.items || res.data.nextCursor !== undefined)
            ? res.data
            : res;

        const baseItems = payload?.items || [];

        let extraRows = [];
        try {
          const resExtra = await apiGet("/api/admin/clients?limit=200&offset=0", "admin");
          const payloadExtra =
            resExtra && resExtra.data && Array.isArray(resExtra.data.rows)
              ? resExtra.data
              : resExtra;
          extraRows = payloadExtra?.rows || [];
        } catch (e) {
          console.warn("[AdminClients] extra rows fetch failed:", e?.message || e);
        }

        const extraMap = new Map(
          extraRows.map((r) => [
            Number(r.id),
            {
              balance_current: r.balance_current ?? 0,
              unlock_count: r.unlock_count ?? 0,
            },
          ])
        );

        const newItems = baseItems.map((item) => {
          const extra = extraMap.get(Number(item.id));
          return {
            ...item,
            balance_current: extra?.balance_current ?? item.balance_current ?? 0,
            unlock_count: extra?.unlock_count ?? item.unlock_count ?? 0,
          };
        });

        if (opts.append) {
          setItems((prev) => [...prev, ...newItems]);
        } else {
          setItems(newItems);
        }

        setNextCursor(payload?.nextCursor || null);
      } catch (e) {
        console.error(e);
        toast.error("Не удалось загрузить список клиентов");
      } finally {
        setLoading(false);
      }
    },
    [q]
  );

  const checkNew = useCallback(async () => {
    try {
      const since = encodeURIComponent(lastSeen);
      const res = await apiGet(`/api/admin/clients-table/new-count?since=${since}`, "provider");
      const payload =
        res && res.data && typeof res.data.count !== "undefined" ? res.data : res;
      const count = Number(payload?.count || 0);

      if (count > 0) {
        toast.info(`Новых клиентов: ${count}`, { icon: "🆕" });
      }
    } catch {
      //
    }
  }, [lastSeen]);

  useEffect(() => {
    fetchList({ limit: 50 });
    loadUnlockSettings();
    loadDashboard();
  }, [fetchList, loadUnlockSettings, loadDashboard]);

  useEffect(() => {
    pollTimer.current = setInterval(checkNew, 30000);
    return () => clearInterval(pollTimer.current);
  }, [checkNew]);

  const onSearch = (e) => {
    e?.preventDefault?.();
    fetchList({ limit: 50 });
  };

  const onClearNewMark = async () => {
    const now = new Date().toISOString();
    setLastSeen(now);

    try {
      await apiPost("/api/admin/clients/reset-new", {}, "admin");
    } catch (e) {
      console.warn("[AdminClients] reset-new failed:", e?.message || e);
    }

    toast.success("Метка обновлена — «новые» сброшены");
    fetchList({ limit: 50 });
  };

  const saveUnlockSettings = async () => {
    try {
      setSavingSettings(true);

      await axios.put(
        "/api/admin/billing/contact-unlock-settings",
        {
          is_paid: unlockSettings.is_paid,
          price: Math.round(Number(unlockSettings.price || 0) * 100),
        },
        {
          headers: {
            ...getAuthHeader(),
          },
        }
      );

      toast.success("Настройки сохранены");
      await loadUnlockSettings();
      await loadDashboard();
    } catch (e) {
      console.error(e);
      toast.error("Ошибка сохранения");
    } finally {
      setSavingSettings(false);
    }
  };

  const isNew = useCallback(
    (created_at) => {
      if (!created_at) return false;
      try {
        return new Date(created_at).toISOString() > (lastSeen || "");
      } catch {
        return false;
      }
    },
    [lastSeen]
  );

  const handleDelete = async (client) => {
    const id = Number(client?.id || 0);
    if (!id) return;

    const ok = window.confirm(
      `Удалить клиента #${id}${client?.name ? ` (${client.name})` : ""}?\n\nЭто действие необратимо.`
    );
    if (!ok) return;

    try {
      setDeletingId(id);
      await apiDelete(`/api/admin/clients-table/${id}`, "provider");
      setItems((prev) => prev.filter((x) => Number(x.id) !== id));
      toast.success(`Клиент #${id} удалён`);
      await loadDashboard();
    } catch (e) {
      console.error(e);
      toast.error(e?.message || "Не удалось удалить клиента");
    } finally {
      setDeletingId(null);
    }
  };

  const openAccess = (client) => {
    setSelectedClient(client);
    setModalOpen(true);
  };

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">Клиенты</h1>
        <div className="flex gap-2">
          <button
            onClick={onClearNewMark}
            className="px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            Сбросить «Новые»
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border bg-white p-4 flex flex-wrap items-center gap-4">
        <div className="text-sm font-semibold">Открытие контактов:</div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={unlockSettings.is_paid === true}
            onChange={() => setUnlockSettings((s) => ({ ...s, is_paid: true }))}
          />
          Платно
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={unlockSettings.is_paid === false}
            onChange={() => setUnlockSettings((s) => ({ ...s, is_paid: false }))}
          />
          Бесплатно
        </label>

        <div className="flex items-center gap-2">
          <span className="text-sm">Цена:</span>
          <input
            type="number"
            value={unlockSettings.price}
            onChange={(e) =>
              setUnlockSettings((s) => ({
                ...s,
                price: e.target.value,
              }))
            }
            className="w-[120px] rounded-lg border px-2 py-1 text-sm"
          />
          <span className="text-sm">сум</span>
        </div>

        <button
          onClick={saveUnlockSettings}
          disabled={savingSettings}
          className="px-3 py-1.5 rounded-lg bg-black text-white text-sm"
        >
          {savingSettings ? "Сохранение..." : "Сохранить"}
        </button>

        <div className="ml-auto text-xs text-gray-500">
          Текущий режим:{" "}
          <b className={unlockSettings.is_paid ? "text-red-600" : "text-green-600"}>
            {unlockSettings.is_paid ? "ПЛАТНО" : "БЕСПЛАТНО"}
          </b>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Режим unlock"
          value={dashboard.is_paid ? "ПЛАТНО" : "БЕСПЛАТНО"}
          sub={`Цена: ${money(fromTiyin(dashboard.price || 0))} сум`}
          valueClass={dashboard.is_paid ? "text-red-600" : "text-green-600"}
        />

        <StatCard
          label="Клиенты"
          value={money(dashboard.clients_total || 0)}
          sub={`Суммарный баланс: ${money(dashboard.balance_total || 0)} сум`}
        />

        <StatCard
          label="Unlocks"
          value={money(dashboard.unlocks_total || 0)}
          sub={`Сегодня: ${money(dashboard.unlocks_today || 0)}`}
        />

        <StatCard
          label="Выручка"
          value={`${money(dashboard.revenue_total || 0)} сум`}
          sub={`Сегодня: ${money(dashboard.revenue_today || 0)} сум`}
        />
      </div>

      <form onSubmit={onSearch} className="flex flex-wrap gap-2 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: имя / email / телефон / telegram / chat id"
          className="w-full md:w-[420px] px-3 py-2 rounded-lg border border-gray-300 text-sm"
        />
        <button
          type="submit"
          className="px-3 py-2 rounded-lg bg-gray-800 text-white hover:bg-black text-sm"
        >
          Найти
        </button>
      </form>

      <div className="border rounded-2xl bg-white overflow-hidden">
        <table className="w-full table-fixed text-[11px] xl:text-xs">
          <colgroup>
            <col className="w-[48px]" />
            <col className="w-[115px]" />
            <col className="w-[170px]" />
            <col className="w-[100px]" />
            <col className="w-[120px]" />
            <col className="w-[95px]" />
            <col className="w-[70px]" />
            <col className="w-[65px]" />
            <col className="w-[90px]" />
            <col className="w-[90px]" />
            <col className="w-[120px]" />
          </colgroup>

          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr className="text-gray-700">
              <th className="text-left px-2 py-3 font-semibold">ID</th>
              <th className="text-left px-2 py-3 font-semibold">Имя</th>
              <th className="text-left px-2 py-3 font-semibold">Email</th>
              <th className="text-left px-2 py-3 font-semibold">Телефон</th>
              <th className="text-left px-2 py-3 font-semibold">Telegram</th>
              <th className="text-left px-2 py-3 font-semibold">TG Chat ID</th>
              <th className="text-left px-2 py-3 font-semibold">Баланс</th>
              <th className="text-left px-2 py-3 font-semibold">Unlocks</th>
              <th className="text-left px-2 py-3 font-semibold">Создан</th>
              <th className="text-left px-2 py-3 font-semibold">Обновлен</th>
              <th className="text-left px-2 py-3 font-semibold">Действия</th>
            </tr>
          </thead>

          <tbody>
            {items.map((c) => {
              const newBadge = isNew(c.created_at);
              const isDeleting = deletingId === Number(c.id);

              return (
                <tr
                  key={c.id}
                  className={`border-t align-top hover:bg-gray-50 ${
                    newBadge ? "bg-blue-50/60" : ""
                  }`}
                >
                  <td className="px-2 py-2 text-gray-800">{c.id}</td>

                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {newBadge && (
                        <span className="shrink-0 px-2 py-0.5 text-[10px] rounded-full bg-blue-600 text-white">
                          NEW
                        </span>
                      )}
                      <CellText className="font-medium text-gray-900" title={c.name}>
                        {c.name || "—"}
                      </CellText>
                    </div>
                  </td>

                  <td className="px-2 py-2">
                    <CellText title={c.email}>{c.email || "—"}</CellText>
                  </td>

                  <td className="px-2 py-2">
                    <CellText title={c.phone}>{c.phone || "—"}</CellText>
                  </td>

                  <td className="px-2 py-2">
                    <CellText title={c.telegram}>{c.telegram || "—"}</CellText>
                  </td>

                  <td className="px-2 py-2">
                    <CellText title={String(c.telegram_chat_id || "—")}>
                      {c.telegram_chat_id || "—"}
                    </CellText>
                  </td>

                  <td className="px-2 py-2 text-gray-900">{money(c.balance_current || 0)}</td>

                  <td className="px-2 py-2 text-gray-900">
                    {Number(c.unlock_count || 0)}
                  </td>

                  <td className="px-2 py-2 text-gray-700">
                    <div className="leading-4" title={fmtCellDate(c.created_at)}>
                      {c.created_at ? (
                        <>
                          <div>{new Date(c.created_at).toLocaleDateString("ru-RU")}</div>
                          <div>{new Date(c.created_at).toLocaleTimeString("ru-RU")}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </div>
                  </td>

                  <td className="px-2 py-2 text-gray-700">
                    <div className="leading-4" title={fmtCellDate(c.updated_at)}>
                      {c.updated_at ? (
                        <>
                          <div>{new Date(c.updated_at).toLocaleDateString("ru-RU")}</div>
                          <div>{new Date(c.updated_at).toLocaleTimeString("ru-RU")}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </div>
                  </td>

                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => openAccess(c)}
                        className="w-full px-2 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-[11px] font-medium"
                      >
                        Доступы
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        disabled={isDeleting}
                        className={`w-full px-2 py-1.5 rounded-lg text-white text-[11px] font-medium ${
                          isDeleting
                            ? "bg-gray-400 cursor-not-allowed"
                            : "bg-red-600 hover:bg-red-700"
                        }`}
                      >
                        {isDeleting ? "Удаление..." : "Удалить"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {!items.length && !loading && (
              <tr>
                <td className="px-3 py-8 text-center text-gray-500" colSpan={11}>
                  Ничего не найдено
                </td>
              </tr>
            )}

            {loading && !items.length && (
              <tr>
                <td className="px-3 py-8 text-center text-gray-500" colSpan={11}>
                  Загрузка...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 gap-3 flex-wrap">
        <div className="text-sm text-gray-500">
          Последний просмотр новых: {new Date(lastSeen).toLocaleString()}
        </div>

        <div>
          {nextCursor ? (
            <button
              onClick={() => fetchList({ append: true, cursor: nextCursor, limit: 50 })}
              className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-sm"
              disabled={loading}
            >
              {loading ? "Загрузка..." : "Загрузить ещё"}
            </button>
          ) : (
            <span className="text-sm text-gray-400">Достигнут конец списка</span>
          )}
        </div>
      </div>

      <ClientAccessModal
        open={modalOpen}
        client={selectedClient}
        onClose={() => {
          setModalOpen(false);
          setSelectedClient(null);
        }}
        onChanged={async () => {
          await fetchList({ limit: 50 });
          await loadDashboard();
        }}
      />
    </div>
  );
}
