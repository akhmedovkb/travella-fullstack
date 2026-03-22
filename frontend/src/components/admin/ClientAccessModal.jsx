//frontend/src/components/admin/ClientAccessModal.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../../api";

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString("ru-RU");
}

function fmtTs(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(x);
  }
}

function Badge({ children, tone = "gray" }) {
  const cls =
    tone === "green"
      ? "bg-green-100 text-green-700 border-green-200"
      : tone === "red"
      ? "bg-red-100 text-red-700 border-red-200"
      : tone === "blue"
      ? "bg-blue-100 text-blue-700 border-blue-200"
      : tone === "amber"
      ? "bg-amber-100 text-amber-700 border-amber-200"
      : "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {children}
    </span>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-3 py-2 text-sm border ${
        active
          ? "bg-black text-white border-black"
          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

export default function ClientAccessModal({ open, client, onClose, onChanged }) {
  const clientId = client?.id;
  const [tab, setTab] = useState("summary");

  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [unlocks, setUnlocks] = useState([]);
  const [matrix, setMatrix] = useState([]);
  const [globalCfg, setGlobalCfg] = useState({ is_paid: true, price: 0 });

  const [loading, setLoading] = useState(false);
  const [busyMap, setBusyMap] = useState({});

  const [matrixQ, setMatrixQ] = useState("");
  const [matrixCategory, setMatrixCategory] = useState("");
  const [matrixOpened, setMatrixOpened] = useState("");

  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustType, setAdjustType] = useState("credit");
  const [adjustNote, setAdjustNote] = useState("");

  const [grantServiceId, setGrantServiceId] = useState("");
  const [grantNote, setGrantNote] = useState("");

  const categories = useMemo(() => {
    const set = new Set();
    for (const r of matrix) if (r?.category) set.add(r.category);
    return Array.from(set);
  }, [matrix]);

  async function loadSummary() {
    if (!clientId) return;
    const res = await apiGet(`/api/admin/clients/${clientId}/summary`, "admin");
    const data = res?.data || res;
    setSummary(data?.client || null);
  }

  async function loadLedger() {
    if (!clientId) return;
    const res = await apiGet(`/api/admin/clients/${clientId}/ledger?limit=100&offset=0`, "admin");
    const data = res?.data || res;
    setLedger(data?.rows || []);
  }

  async function loadUnlocks() {
    if (!clientId) return;
    const res = await apiGet(`/api/admin/clients/${clientId}/unlocks?limit=200&offset=0`, "admin");
    const data = res?.data || res;
    setUnlocks(data?.rows || []);
  }

  async function loadMatrix() {
    if (!clientId) return;
    const qs = new URLSearchParams();
    if (matrixQ.trim()) qs.set("q", matrixQ.trim());
    if (matrixCategory) qs.set("category", matrixCategory);
    if (matrixOpened) qs.set("opened", matrixOpened);
    qs.set("limit", "200");
    qs.set("offset", "0");

    const res = await apiGet(
      `/api/admin/clients/${clientId}/access-matrix?${qs.toString()}`,
      "admin"
    );
    const data = res?.data || res;
    setGlobalCfg(data?.global || { is_paid: true, price: 0 });
    setMatrix(data?.rows || []);
  }

  async function loadAll() {
    if (!clientId) return;
    try {
      setLoading(true);
      await Promise.all([loadSummary(), loadLedger(), loadUnlocks(), loadMatrix()]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && clientId) {
      setTab("summary");
      loadAll();
    }
  }, [open, clientId]);

  async function grantUnlock(serviceId) {
    if (!clientId || !serviceId) return;
    const key = `grant:${serviceId}`;
    try {
      setBusyMap((s) => ({ ...s, [key]: true }));
      await apiPost(
        `/api/admin/clients/${clientId}/unlocks`,
        {
          service_id: Number(serviceId),
          source: "test_grant",
          note: grantNote.trim() || "manual test grant",
        },
        "admin"
      );
      await Promise.all([loadUnlocks(), loadMatrix(), loadSummary()]);
      onChanged?.();
    } finally {
      setBusyMap((s) => ({ ...s, [key]: false }));
    }
  }

  async function revokeUnlock(serviceId) {
    if (!clientId || !serviceId) return;
    const key = `revoke:${serviceId}`;
    try {
      setBusyMap((s) => ({ ...s, [key]: true }));
      await apiDelete(`/api/admin/clients/${clientId}/unlocks/${serviceId}`, "admin");
      await Promise.all([loadUnlocks(), loadMatrix(), loadSummary()]);
      onChanged?.();
    } finally {
      setBusyMap((s) => ({ ...s, [key]: false }));
    }
  }

  async function adjustBalance() {
    const amount = Number(String(adjustAmount).replace(/\s+/g, ""));
    if (!clientId || !Number.isFinite(amount) || amount <= 0) return;
    try {
      setBusyMap((s) => ({ ...s, adjust: true }));
      await apiPost(
        `/api/admin/clients/${clientId}/balance-adjust`,
        {
          amount,
          type: adjustType,
          source: "admin_adjust",
          note: adjustNote.trim() || null,
        },
        "admin"
      );
      setAdjustAmount("");
      setAdjustNote("");
      await Promise.all([loadSummary(), loadLedger()]);
      onChanged?.();
    } finally {
      setBusyMap((s) => ({ ...s, adjust: false }));
    }
  }

  if (!open || !client) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 p-3 sm:p-6 overflow-y-auto">
      <div className="mx-auto max-w-7xl rounded-2xl bg-white shadow-2xl border border-gray-200">
        <div className="flex items-start justify-between gap-4 border-b p-4 sm:p-5">
          <div>
            <h2 className="text-xl font-semibold">Клиент #{client.id}</h2>
            <div className="mt-1 text-sm text-gray-600">
              {client.name || "—"} · {client.phone || "—"} · {client.email || "—"}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="blue">
                Глобально: {globalCfg?.is_paid ? "Платно" : "Бесплатно"}
              </Badge>
              <Badge tone="amber">Цена unlock: {money(globalCfg?.price || 0)} сум</Badge>
              <Badge tone="green">
                Баланс: {money(summary?.balance_current ?? client.balance_current ?? 0)} сум
              </Badge>
              <Badge>{`Unlocks: ${summary?.unlock_count ?? client.unlock_count ?? 0}`}</Badge>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            Закрыть
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <TabBtn active={tab === "summary"} onClick={() => setTab("summary")}>
              Summary
            </TabBtn>
            <TabBtn active={tab === "ledger"} onClick={() => setTab("ledger")}>
              Ledger
            </TabBtn>
            <TabBtn active={tab === "unlocks"} onClick={() => setTab("unlocks")}>
              Unlocks
            </TabBtn>
            <TabBtn active={tab === "matrix"} onClick={() => setTab("matrix")}>
              Access Matrix
            </TabBtn>
          </div>

          {loading ? (
            <div className="rounded-2xl border bg-gray-50 p-6 text-sm text-gray-500">Загрузка...</div>
          ) : null}

          {tab === "summary" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-2xl border p-4 space-y-2">
                <div className="text-sm font-semibold">Профиль</div>
                <div className="text-sm text-gray-700">ID: {summary?.id ?? client.id}</div>
                <div className="text-sm text-gray-700">Имя: {summary?.name || "—"}</div>
                <div className="text-sm text-gray-700">Email: {summary?.email || "—"}</div>
                <div className="text-sm text-gray-700">Телефон: {summary?.phone || "—"}</div>
                <div className="text-sm text-gray-700">Telegram: {summary?.telegram || "—"}</div>
                <div className="text-sm text-gray-700">
                  Chat ID: {summary?.telegram_chat_id || "—"}
                </div>
                <div className="text-sm text-gray-700">
                  Создан: {fmtTs(summary?.created_at || client.created_at)}
                </div>
              </div>

              <div className="rounded-2xl border p-4 space-y-2">
                <div className="text-sm font-semibold">Финансы</div>
                <div className="text-sm text-gray-700">
                  Баланс: <b>{money(summary?.balance_current || 0)} сум</b>
                </div>
                <div className="text-sm text-gray-700">
                  Начислено: {money(summary?.credited || 0)} сум
                </div>
                <div className="text-sm text-gray-700">
                  Списано: {money(summary?.debited || 0)} сум
                </div>
                <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    className="rounded-xl border px-3 py-2 text-sm"
                    placeholder="Сумма"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                  />
                  <select
                    className="rounded-xl border px-3 py-2 text-sm"
                    value={adjustType}
                    onChange={(e) => setAdjustType(e.target.value)}
                  >
                    <option value="credit">Пополнить</option>
                    <option value="debit">Списать</option>
                  </select>
                  <input
                    className="rounded-xl border px-3 py-2 text-sm sm:col-span-2"
                    placeholder="Комментарий"
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                  />
                  <button
                    onClick={adjustBalance}
                    disabled={!!busyMap.adjust}
                    className="rounded-xl bg-black text-white px-3 py-2 text-sm sm:col-span-2 disabled:opacity-50"
                  >
                    {busyMap.adjust ? "Сохранение..." : "Применить"}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border p-4 space-y-2">
                <div className="text-sm font-semibold">Быстрый test grant</div>
                <input
                  className="rounded-xl border px-3 py-2 text-sm w-full"
                  placeholder="Service ID"
                  value={grantServiceId}
                  onChange={(e) => setGrantServiceId(e.target.value)}
                />
                <input
                  className="rounded-xl border px-3 py-2 text-sm w-full"
                  placeholder="Комментарий"
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                />
                <button
                  onClick={() => grantUnlock(grantServiceId)}
                  disabled={!grantServiceId || !!busyMap[`grant:${grantServiceId}`]}
                  className="rounded-xl bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-50"
                >
                  Выдать доступ
                </button>
              </div>
            </div>
          )}

          {tab === "ledger" && (
            <div className="rounded-2xl border overflow-hidden">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="px-3 py-2">ID</th>
                      <th className="px-3 py-2">Сумма</th>
                      <th className="px-3 py-2">Reason</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2">{r.id}</td>
                        <td className="px-3 py-2">
                          <span className={Number(r.amount) >= 0 ? "text-green-600" : "text-red-600"}>
                            {Number(r.amount) >= 0 ? "+" : "-"} {money(Math.abs(Number(r.amount || 0)))}
                          </span>
                        </td>
                        <td className="px-3 py-2">{r.reason || "—"}</td>
                        <td className="px-3 py-2">{r.source || "—"}</td>
                        <td className="px-3 py-2">{fmtTs(r.created_at)}</td>
                      </tr>
                    ))}
                    {!ledger.length && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                          Нет данных
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "unlocks" && (
            <div className="rounded-2xl border overflow-hidden">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="px-3 py-2">Service ID</th>
                      <th className="px-3 py-2">Услуга</th>
                      <th className="px-3 py-2">Категория</th>
                      <th className="px-3 py-2">Provider</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Открыто</th>
                      <th className="px-3 py-2">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unlocks.map((r) => {
                      const key = `revoke:${r.service_id}`;
                      return (
                        <tr key={`${r.service_id}-${r.opened_at || ""}`} className="border-t">
                          <td className="px-3 py-2">{r.service_id}</td>
                          <td className="px-3 py-2">{r.title || "—"}</td>
                          <td className="px-3 py-2">{r.category || "—"}</td>
                          <td className="px-3 py-2">{r.provider_name || `#${r.provider_id || "—"}`}</td>
                          <td className="px-3 py-2">{r.source || "—"}</td>
                          <td className="px-3 py-2">{fmtTs(r.opened_at)}</td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => revokeUnlock(r.service_id)}
                              disabled={!!busyMap[key]}
                              className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              {busyMap[key] ? "..." : "Закрыть"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {!unlocks.length && (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                          Нет открытых контактов
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "matrix" && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <input
                  className="rounded-xl border px-3 py-2 text-sm"
                  placeholder="Поиск"
                  value={matrixQ}
                  onChange={(e) => setMatrixQ(e.target.value)}
                />
                <select
                  className="rounded-xl border px-3 py-2 text-sm"
                  value={matrixCategory}
                  onChange={(e) => setMatrixCategory(e.target.value)}
                >
                  <option value="">Все категории</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-xl border px-3 py-2 text-sm"
                  value={matrixOpened}
                  onChange={(e) => setMatrixOpened(e.target.value)}
                >
                  <option value="">Все</option>
                  <option value="opened">Только opened</option>
                  <option value="closed">Только closed</option>
                </select>
                <button
                  onClick={loadMatrix}
                  className="rounded-xl bg-black text-white px-3 py-2 text-sm"
                >
                  Применить
                </button>
              </div>

              <div className="rounded-2xl border overflow-hidden">
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left">
                      <tr>
                        <th className="px-3 py-2">Service ID</th>
                        <th className="px-3 py-2">Услуга</th>
                        <th className="px-3 py-2">Provider</th>
                        <th className="px-3 py-2">Категория</th>
                        <th className="px-3 py-2">Mode</th>
                        <th className="px-3 py-2">Access</th>
                        <th className="px-3 py-2">Opened at</th>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2">Действие</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.map((r) => {
                        const grantKey = `grant:${r.service_id}`;
                        const revokeKey = `revoke:${r.service_id}`;
                        return (
                          <tr key={r.service_id} className="border-t">
                            <td className="px-3 py-2">{r.service_id}</td>
                            <td className="px-3 py-2">{r.title || "—"}</td>
                            <td className="px-3 py-2">{r.provider_name || `#${r.provider_id || "—"}`}</td>
                            <td className="px-3 py-2">{r.category || "—"}</td>
                            <td className="px-3 py-2">
                              <Badge tone={r.effective_mode === "free" ? "green" : "amber"}>
                                {r.effective_mode === "free" ? "free" : "paid"}
                              </Badge>
                            </td>
                            <td className="px-3 py-2">
                              <Badge tone={r.opened_for_client ? "green" : "red"}>
                                {r.opened_for_client ? "opened" : "closed"}
                              </Badge>
                            </td>
                            <td className="px-3 py-2">{fmtTs(r.opened_at)}</td>
                            <td className="px-3 py-2">{r.source || "—"}</td>
                            <td className="px-3 py-2">
                              {r.opened_for_client ? (
                                <button
                                  onClick={() => revokeUnlock(r.service_id)}
                                  disabled={!!busyMap[revokeKey]}
                                  className="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                                >
                                  {busyMap[revokeKey] ? "..." : "Закрыть"}
                                </button>
                              ) : (
                                <button
                                  onClick={() => grantUnlock(r.service_id)}
                                  disabled={!!busyMap[grantKey]}
                                  className="rounded-lg border border-blue-300 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                                >
                                  {busyMap[grantKey] ? "..." : "Открыть"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {!matrix.length && (
                        <tr>
                          <td colSpan={9} className="px-3 py-6 text-center text-gray-500">
                            Нет данных
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
