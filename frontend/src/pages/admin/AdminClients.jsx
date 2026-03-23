//frontend/src/pages/admin/AdminClients.jsx
  
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "react-toastify";
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
          price: data.settings.price,
        });
      } else if (typeof data?.is_paid !== "undefined") {
        setUnlockSettings({
          is_paid: data.is_paid,
          price: data.price,
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

      await apiPost(
        "/api/admin/billing/contact-unlock-settings",
        {
          is_paid: unlockSettings.is_paid,
          price: Number(unlockSettings.price || 0),
        },
        "admin"
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
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-500">Режим unlock</div>
          <div
            className={`mt-1 text-lg font-semibold ${
              dashboard.is_paid ? "text-red-600" : "text-green-600"
            }`}
          >
            {dashboard.is_paid ? "ПЛАТНО" : "БЕСПЛАТНО"}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            Цена: {money(dashboard.price || 0)} сум
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-500">Клиенты</div>
          <div className="mt-1 text-2xl font-semibold">
            {money(dashboard.clients_total || 0)}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            Суммарный баланс: {money(dashboard.balance_total || 0)} сум
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-500">Unlocks</div>
          <div className="mt-1 text-2xl font-semibold">
            {money(dashboard.unlocks_total || 0)}
          </div>
          <div className="mt-1 text-sm text-gray-500">
            Сегодня: {money(dashboard.unlocks_today || 0)}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-4">
          <div className="text-xs text-gray-500">Выручка</div>
          <div className="mt-1 text-2xl font-semibold">
            {money(dashboard.revenue_total || 0)} сум
          </div>
          <div className="mt-1 text-sm text-gray-500">
            Сегодня: {money(dashboard.revenue_today || 0)} сум
          </div>
        </div>
      </div>

      <form onSubmit={onSearch} className="flex flex-wrap gap-2 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: имя / email / телефон / telegram / chat id"
          className="input input-bordered w-full md:w-[420px] px-3 py-2 rounded-lg border border-gray-300"
        />
        <button
          type="submit"
          className="px-3 py-2 rounded-lg bg-gray-800 text-white hover:bg-black"
        >
          Найти
        </button>
      </form>

      <div className="overflow-auto border rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="text-left p-3">ID</th>
              <th className="text-left p-3">Имя</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Телефон</th>
              <th className="text-left p-3">Telegram</th>
              <th className="text-left p-3">TG Chat ID</th>
              <th className="text-left p-3">Баланс</th>
              <th className="text-left p-3">Unlocks</th>
              <th className="text-left p-3">Создан</th>
              <th className="text-left p-3">Обновлен</th>
              <th className="text-left p-3">Действия</th>
            </tr>
          </thead>

          <tbody>
            {items.map((c) => {
              const newBadge = isNew(c.created_at);
              const isDeleting = deletingId === Number(c.id);

              return (
                <tr key={c.id} className={`border-t ${newBadge ? "bg-blue-50" : ""}`}>
                  <td className="p-3">{c.id}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {newBadge && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-blue-600 text-white">
                          NEW
                        </span>
                      )}
                      <span className="font-medium">{c.name || "—"}</span>
                    </div>
                  </td>
                  <td className="p-3">{c.email || "—"}</td>
                  <td className="p-3">{c.phone || "—"}</td>
                  <td className="p-3">{c.telegram || "—"}</td>
                  <td className="p-3">{c.telegram_chat_id || "—"}</td>
                  <td className="p-3">{money(c.balance_current || 0)}</td>
                  <td className="p-3">{Number(c.unlock_count || 0)}</td>
                  <td className="p-3">
                    {c.created_at ? new Date(c.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="p-3">
                    {c.updated_at ? new Date(c.updated_at).toLocaleString() : "—"}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openAccess(c)}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                      >
                        Подробнее / Доступы
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        disabled={isDeleting}
                        className={`px-3 py-1.5 rounded-lg text-white ${
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
                <td className="p-6 text-center text-gray-500" colSpan={11}>
                  Ничего не найдено
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
              className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300"
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
