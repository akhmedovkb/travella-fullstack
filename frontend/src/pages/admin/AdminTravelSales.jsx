//frontend/src/pages/admin/AdminTravelSales.jsx

import React, { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

const emptyAgentForm = {
  name: "",
  contact: "",
  address: "",
};

const emptySaleForm = {
  sale_date: new Date().toISOString().slice(0, 10),
  agent_id: "",
  direction: "",
  sale_amount: "",
  net_amount: "",
};

function money(v) {
  const n = Number(v || 0);
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

function num(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

function iso(v) {
  if (!v) return "";
  return String(v).slice(0, 10);
}

function clsTab(active) {
  return active
    ? "px-3 py-2 rounded-lg bg-black text-white text-sm"
    : "px-3 py-2 rounded-lg border bg-white text-sm";
}

function Card({ title, children, right }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border p-4 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {right || null}
      </div>
      {children}
    </div>
  );
}

function StatCard({ title, value, hint }) {
  return (
    <div className="bg-white rounded-2xl border shadow-sm p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
    </div>
  );
}

export default function AdminTravelSales() {
  const [tab, setTab] = useState("agents");

  const [agents, setAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentForm, setAgentForm] = useState(emptyAgentForm);
  const [editingAgentId, setEditingAgentId] = useState(null);
  const [agentQuery, setAgentQuery] = useState("");

  const [dailySales, setDailySales] = useState([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [saleForm, setSaleForm] = useState(emptySaleForm);
  const [editingSaleId, setEditingSaleId] = useState(null);
  const [dailyFilterAgentId, setDailyFilterAgentId] = useState("");
  const [dailyDateFrom, setDailyDateFrom] = useState("");
  const [dailyDateTo, setDailyDateTo] = useState("");

  const [salesReport, setSalesReport] = useState([]);
  const [salesReportLoading, setSalesReportLoading] = useState(false);
  const [salesAgentId, setSalesAgentId] = useState("");
  const [salesDateFrom, setSalesDateFrom] = useState("");
  const [salesDateTo, setSalesDateTo] = useState("");

  const [balanceReport, setBalanceReport] = useState([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceAgentId, setBalanceAgentId] = useState("");
  const [balanceDateFrom, setBalanceDateFrom] = useState("");
  const [balanceDateTo, setBalanceDateTo] = useState("");
  const [paymentDrafts, setPaymentDrafts] = useState({});
  const [paymentSavingId, setPaymentSavingId] = useState(null);

  async function loadAgents() {
    try {
      setAgentsLoading(true);
      const q = new URLSearchParams();
      if (agentQuery.trim()) q.set("q", agentQuery.trim());
      q.set("limit", "500");

      const res = await apiGet(`/api/admin/travel-sales/agents?${q.toString()}`, "admin");
      setAgents(Array.isArray(res?.rows) ? res.rows : []);
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось загрузить агентов");
    } finally {
      setAgentsLoading(false);
    }
  }

  async function loadDailySales() {
    try {
      setDailyLoading(true);
      const q = new URLSearchParams();
      q.set("limit", "500");
      if (dailyFilterAgentId) q.set("agent_id", dailyFilterAgentId);
      if (dailyDateFrom) q.set("date_from", dailyDateFrom);
      if (dailyDateTo) q.set("date_to", dailyDateTo);

      const res = await apiGet(`/api/admin/travel-sales/daily-sales?${q.toString()}`, "admin");
      setDailySales(Array.isArray(res?.rows) ? res.rows : []);
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось загрузить дневные продажи");
    } finally {
      setDailyLoading(false);
    }
  }

  async function loadSalesReport() {
    try {
      setSalesReportLoading(true);
      const q = new URLSearchParams();
      q.set("limit", "1000");
      if (salesAgentId) q.set("agent_id", salesAgentId);
      if (salesDateFrom) q.set("date_from", salesDateFrom);
      if (salesDateTo) q.set("date_to", salesDateTo);

      const res = await apiGet(`/api/admin/travel-sales/reports/sales?${q.toString()}`, "admin");
      setSalesReport(Array.isArray(res?.rows) ? res.rows : []);
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось загрузить отчет продаж");
    } finally {
      setSalesReportLoading(false);
    }
  }

  async function loadBalanceReport() {
    try {
      setBalanceLoading(true);
      const q = new URLSearchParams();
      q.set("limit", "2000");
      if (balanceAgentId) q.set("agent_id", balanceAgentId);
      if (balanceDateFrom) q.set("date_from", balanceDateFrom);
      if (balanceDateTo) q.set("date_to", balanceDateTo);

      const res = await apiGet(
        `/api/admin/travel-sales/reports/agent-balance?${q.toString()}`,
        "admin"
      );

      const rows = Array.isArray(res?.rows) ? res.rows : [];
      setBalanceReport(rows);

      const drafts = {};
      rows.forEach((r) => {
        drafts[r.id] = num(r.payment);
      });
      setPaymentDrafts(drafts);
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось загрузить баланс агентов");
    } finally {
      setBalanceLoading(false);
    }
  }

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    if (tab === "daily") loadDailySales();
    if (tab === "sales") loadSalesReport();
    if (tab === "balance") loadBalanceReport();
  }, [tab]);

  const totalSales = useMemo(
    () => salesReport.reduce((s, r) => s + Number(r.sale_amount || 0), 0),
    [salesReport]
  );

  const totalNet = useMemo(
    () => salesReport.reduce((s, r) => s + Number(r.net_amount || 0), 0),
    [salesReport]
  );

  const totalMargin = useMemo(
    () => salesReport.reduce((s, r) => s + Number(r.margin || 0), 0),
    [salesReport]
  );

  const totalBalance = useMemo(() => {
    const byAgent = new Map();
    balanceReport.forEach((r) => {
      byAgent.set(r.agent_id, Number(r.balance || 0));
    });
    return Array.from(byAgent.values()).reduce((s, n) => s + n, 0);
  }, [balanceReport]);

  async function handleSaveAgent(e) {
    e.preventDefault();
    try {
      const payload = {
        name: agentForm.name.trim(),
        contact: agentForm.contact.trim(),
        address: agentForm.address.trim(),
      };

      if (!payload.name) {
        tError("Введите наименование агента");
        return;
      }

      if (editingAgentId) {
        await apiPut(`/api/admin/travel-sales/agents/${editingAgentId}`, payload, "admin");
        tSuccess("Агент обновлен");
      } else {
        await apiPost("/api/admin/travel-sales/agents", payload, "admin");
        tSuccess("Агент добавлен");
      }

      setAgentForm(emptyAgentForm);
      setEditingAgentId(null);
      await loadAgents();
    } catch (e2) {
      console.error(e2);
      tError(e2?.message || "Ошибка сохранения агента");
    }
  }

  function startEditAgent(row) {
    setEditingAgentId(row.id);
    setAgentForm({
      name: row.name || "",
      contact: row.contact || "",
      address: row.address || "",
    });
    setTab("agents");
  }

  async function handleDeleteAgent(id) {
    if (!window.confirm("Удалить агента?")) return;
    try {
      await apiDelete(`/api/admin/travel-sales/agents/${id}`, "admin");
      tSuccess("Агент удален");
      if (editingAgentId === id) {
        setEditingAgentId(null);
        setAgentForm(emptyAgentForm);
      }
      await loadAgents();
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось удалить агента");
    }
  }

  async function handleSaveSale(e) {
    e.preventDefault();
    try {
      const payload = {
        sale_date: saleForm.sale_date,
        agent_id: Number(saleForm.agent_id),
        direction: String(saleForm.direction || "").trim(),
        sale_amount: Number(saleForm.sale_amount || 0),
        net_amount: Number(saleForm.net_amount || 0),
      };

      if (!payload.agent_id) {
        tError("Выбери агента");
        return;
      }
      if (!payload.sale_date) {
        tError("Укажи дату");
        return;
      }
      if (!payload.direction) {
        tError("Укажи направление");
        return;
      }

      if (editingSaleId) {
        await apiPut(`/api/admin/travel-sales/daily-sales/${editingSaleId}`, payload, "admin");
        tSuccess("Продажа обновлена");
      } else {
        await apiPost("/api/admin/travel-sales/daily-sales", payload, "admin");
        tSuccess("Продажа добавлена");
      }

      setEditingSaleId(null);
      setSaleForm(emptySaleForm);
      await loadDailySales();
      await loadSalesReport();
      await loadBalanceReport();
    } catch (e2) {
      console.error(e2);
      tError(e2?.message || "Ошибка сохранения продажи");
    }
  }

  function startEditSale(row) {
    setEditingSaleId(row.id);
    setSaleForm({
      sale_date: iso(row.sale_date),
      agent_id: String(row.agent_id || ""),
      direction: row.direction || "",
      sale_amount: num(row.sale_amount),
      net_amount: num(row.net_amount),
    });
    setTab("daily");
  }

  async function handleDeleteSale(id) {
    if (!window.confirm("Удалить продажу?")) return;
    try {
      await apiDelete(`/api/admin/travel-sales/daily-sales/${id}`, "admin");
      tSuccess("Продажа удалена");
      if (editingSaleId === id) {
        setEditingSaleId(null);
        setSaleForm(emptySaleForm);
      }
      await loadDailySales();
      await loadSalesReport();
      await loadBalanceReport();
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось удалить продажу");
    }
  }

  async function handleSavePayment(rowId) {
    try {
      setPaymentSavingId(rowId);
      const payment = Number(paymentDrafts[rowId] || 0);

      await apiPut(
        `/api/admin/travel-sales/daily-sales/${rowId}/payment`,
        { payment },
        "admin"
      );

      tSuccess("Оплата обновлена");
      await loadBalanceReport();
      await loadDailySales();
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось обновить оплату");
    } finally {
      setPaymentSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className={clsTab(tab === "agents")} onClick={() => setTab("agents")}>
          Все агенты
        </button>
        <button className={clsTab(tab === "daily")} onClick={() => setTab("daily")}>
          Дневная продажа
        </button>
        <button className={clsTab(tab === "sales")} onClick={() => setTab("sales")}>
          Отчет продаж
        </button>
        <button className={clsTab(tab === "balance")} onClick={() => setTab("balance")}>
          Баланс агента
        </button>
      </div>

      {tab === "agents" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-1">
            <Card title={editingAgentId ? "Редактировать агента" : "Добавить агента"}>
              <form onSubmit={handleSaveAgent} className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Наименование</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    value={agentForm.name}
                    onChange={(e) =>
                      setAgentForm((p) => ({ ...p, name: e.target.value }))
                    }
                    placeholder="Например: Air Broker"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Контакт</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    value={agentForm.contact}
                    onChange={(e) =>
                      setAgentForm((p) => ({ ...p, contact: e.target.value }))
                    }
                    placeholder="+998 ..."
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Адрес</label>
                  <textarea
                    className="w-full border rounded-lg px-3 py-2 min-h-[96px]"
                    value={agentForm.address}
                    onChange={(e) =>
                      setAgentForm((p) => ({ ...p, address: e.target.value }))
                    }
                    placeholder="Адрес агента"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-black text-white"
                  >
                    {editingAgentId ? "Сохранить" : "Добавить"}
                  </button>

                  {(editingAgentId || agentForm.name || agentForm.contact || agentForm.address) && (
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg border bg-white"
                      onClick={() => {
                        setEditingAgentId(null);
                        setAgentForm(emptyAgentForm);
                      }}
                    >
                      Сбросить
                    </button>
                  )}
                </div>
              </form>
            </Card>
          </div>

          <div className="xl:col-span-2">
            <Card
              title="Список агентов"
              right={
                <div className="flex items-center gap-2">
                  <input
                    className="border rounded-lg px-3 py-2 text-sm"
                    placeholder="Поиск..."
                    value={agentQuery}
                    onChange={(e) => setAgentQuery(e.target.value)}
                  />
                  <button
                    className="px-3 py-2 rounded-lg border bg-white text-sm"
                    onClick={loadAgents}
                    type="button"
                  >
                    Найти
                  </button>
                </div>
              }
            >
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left border-b bg-gray-50">
                      <th className="px-3 py-2">№</th>
                      <th className="px-3 py-2">Наименование</th>
                      <th className="px-3 py-2">Контакт</th>
                      <th className="px-3 py-2">Адрес</th>
                      <th className="px-3 py-2 w-[180px]">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentsLoading ? (
                      <tr>
                        <td className="px-3 py-6 text-gray-500" colSpan={5}>
                          Загрузка...
                        </td>
                      </tr>
                    ) : agents.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-gray-500" colSpan={5}>
                          Нет данных
                        </td>
                      </tr>
                    ) : (
                      agents.map((row, idx) => (
                        <tr key={row.id} className="border-b">
                          <td className="px-3 py-2">{idx + 1}</td>
                          <td className="px-3 py-2 font-medium">{row.name}</td>
                          <td className="px-3 py-2">{row.contact || "—"}</td>
                          <td className="px-3 py-2">{row.address || "—"}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="px-3 py-1.5 rounded-lg border bg-white"
                                onClick={() => startEditAgent(row)}
                              >
                                Изменить
                              </button>
                              <button
                                className="px-3 py-1.5 rounded-lg border text-red-600 bg-white"
                                onClick={() => handleDeleteAgent(row.id)}
                              >
                                Удалить
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "daily" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-1">
            <Card title={editingSaleId ? "Редактировать продажу" : "Добавить продажу"}>
              <form onSubmit={handleSaveSale} className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Дата</label>
                  <input
                    type="date"
                    className="w-full border rounded-lg px-3 py-2"
                    value={saleForm.sale_date}
                    onChange={(e) =>
                      setSaleForm((p) => ({ ...p, sale_date: e.target.value }))
                    }
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Агент</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2"
                    value={saleForm.agent_id}
                    onChange={(e) =>
                      setSaleForm((p) => ({ ...p, agent_id: e.target.value }))
                    }
                  >
                    <option value="">Выберите агента</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Направление</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    value={saleForm.direction}
                    onChange={(e) =>
                      setSaleForm((p) => ({ ...p, direction: e.target.value }))
                    }
                    placeholder="Например: Дели / Дубай / Турпакет"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Сумма продажи</label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2"
                    value={saleForm.sale_amount}
                    onChange={(e) =>
                      setSaleForm((p) => ({ ...p, sale_amount: e.target.value }))
                    }
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Сумма нетто</label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2"
                    value={saleForm.net_amount}
                    onChange={(e) =>
                      setSaleForm((p) => ({ ...p, net_amount: e.target.value }))
                    }
                    placeholder="0"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-black text-white"
                  >
                    {editingSaleId ? "Сохранить" : "Добавить"}
                  </button>

                  {(editingSaleId ||
                    saleForm.agent_id ||
                    saleForm.direction ||
                    saleForm.sale_amount ||
                    saleForm.net_amount) && (
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg border bg-white"
                      onClick={() => {
                        setEditingSaleId(null);
                        setSaleForm(emptySaleForm);
                      }}
                    >
                      Сбросить
                    </button>
                  )}
                </div>
              </form>
            </Card>
          </div>

          <div className="xl:col-span-2">
            <Card
              title="Список продаж"
              right={
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="border rounded-lg px-3 py-2 text-sm"
                    value={dailyFilterAgentId}
                    onChange={(e) => setDailyFilterAgentId(e.target.value)}
                  >
                    <option value="">Все агенты</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>

                  <input
                    type="date"
                    className="border rounded-lg px-3 py-2 text-sm"
                    value={dailyDateFrom}
                    onChange={(e) => setDailyDateFrom(e.target.value)}
                  />
                  <input
                    type="date"
                    className="border rounded-lg px-3 py-2 text-sm"
                    value={dailyDateTo}
                    onChange={(e) => setDailyDateTo(e.target.value)}
                  />

                  <button
                    className="px-3 py-2 rounded-lg border bg-white text-sm"
                    onClick={loadDailySales}
                    type="button"
                  >
                    Фильтр
                  </button>
                </div>
              }
            >
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left border-b bg-gray-50">
                      <th className="px-3 py-2">№</th>
                      <th className="px-3 py-2">Дата</th>
                      <th className="px-3 py-2">Агент</th>
                      <th className="px-3 py-2">Направление</th>
                      <th className="px-3 py-2">Продажа</th>
                      <th className="px-3 py-2">Нетто</th>
                      <th className="px-3 py-2">Оплата</th>
                      <th className="px-3 py-2 w-[180px]">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyLoading ? (
                      <tr>
                        <td className="px-3 py-6 text-gray-500" colSpan={8}>
                          Загрузка...
                        </td>
                      </tr>
                    ) : dailySales.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-gray-500" colSpan={8}>
                          Нет данных
                        </td>
                      </tr>
                    ) : (
                      dailySales.map((row, idx) => (
                        <tr key={row.id} className="border-b">
                          <td className="px-3 py-2">{idx + 1}</td>
                          <td className="px-3 py-2">{iso(row.sale_date)}</td>
                          <td className="px-3 py-2">{row.agent_name}</td>
                          <td className="px-3 py-2">{row.direction}</td>
                          <td className="px-3 py-2">{money(row.sale_amount)}</td>
                          <td className="px-3 py-2">{money(row.net_amount)}</td>
                          <td className="px-3 py-2">{money(row.payment)}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="px-3 py-1.5 rounded-lg border bg-white"
                                onClick={() => startEditSale(row)}
                              >
                                Изменить
                              </button>
                              <button
                                className="px-3 py-1.5 rounded-lg border text-red-600 bg-white"
                                onClick={() => handleDeleteSale(row.id)}
                              >
                                Удалить
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "sales" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4">
            <StatCard title="Сумма продаж" value={money(totalSales)} />
            <StatCard title="Сумма нетто" value={money(totalNet)} />
            <StatCard title="Маржа" value={money(totalMargin)} />
            <StatCard title="Записей" value={String(salesReport.length)} />
          </div>

          <Card
            title="Отчет продаж"
            right={
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="border rounded-lg px-3 py-2 text-sm"
                  value={salesAgentId}
                  onChange={(e) => setSalesAgentId(e.target.value)}
                >
                  <option value="">Все агенты</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  className="border rounded-lg px-3 py-2 text-sm"
                  value={salesDateFrom}
                  onChange={(e) => setSalesDateFrom(e.target.value)}
                />
                <input
                  type="date"
                  className="border rounded-lg px-3 py-2 text-sm"
                  value={salesDateTo}
                  onChange={(e) => setSalesDateTo(e.target.value)}
                />

                <button
                  className="px-3 py-2 rounded-lg border bg-white text-sm"
                  onClick={loadSalesReport}
                  type="button"
                >
                  Фильтр
                </button>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b bg-gray-50">
                    <th className="px-3 py-2">№</th>
                    <th className="px-3 py-2">Дата</th>
                    <th className="px-3 py-2">Агент</th>
                    <th className="px-3 py-2">Направление</th>
                    <th className="px-3 py-2">Сумма продажи</th>
                    <th className="px-3 py-2">Сумма нетто</th>
                    <th className="px-3 py-2">Маржа</th>
                  </tr>
                </thead>
                <tbody>
                  {salesReportLoading ? (
                    <tr>
                      <td className="px-3 py-6 text-gray-500" colSpan={7}>
                        Загрузка...
                      </td>
                    </tr>
                  ) : salesReport.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-gray-500" colSpan={7}>
                        Нет данных
                      </td>
                    </tr>
                  ) : (
                    salesReport.map((row, idx) => (
                      <tr key={row.id} className="border-b">
                        <td className="px-3 py-2">{idx + 1}</td>
                        <td className="px-3 py-2">{iso(row.sale_date)}</td>
                        <td className="px-3 py-2">{row.agent}</td>
                        <td className="px-3 py-2">{row.direction || "—"}</td>
                        <td className="px-3 py-2">{money(row.sale_amount)}</td>
                        <td className="px-3 py-2">{money(row.net_amount)}</td>
                        <td className="px-3 py-2 font-medium text-emerald-700">
                          {money(row.margin)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "balance" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard title="Общий баланс" value={money(totalBalance)} />
            <StatCard title="Строк в отчете" value={String(balanceReport.length)} />
          </div>

          <Card
            title="Баланс агента"
            right={
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="border rounded-lg px-3 py-2 text-sm"
                  value={balanceAgentId}
                  onChange={(e) => setBalanceAgentId(e.target.value)}
                >
                  <option value="">Все агенты</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>

                <input
                  type="date"
                  className="border rounded-lg px-3 py-2 text-sm"
                  value={balanceDateFrom}
                  onChange={(e) => setBalanceDateFrom(e.target.value)}
                />
                <input
                  type="date"
                  className="border rounded-lg px-3 py-2 text-sm"
                  value={balanceDateTo}
                  onChange={(e) => setBalanceDateTo(e.target.value)}
                />

                <button
                  className="px-3 py-2 rounded-lg border bg-white text-sm"
                  onClick={loadBalanceReport}
                  type="button"
                >
                  Фильтр
                </button>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b bg-gray-50">
                    <th className="px-3 py-2">№</th>
                    <th className="px-3 py-2">Дата</th>
                    <th className="px-3 py-2">Агент</th>
                    <th className="px-3 py-2">Направление</th>
                    <th className="px-3 py-2">Сумма продажи</th>
                    <th className="px-3 py-2">Оплата</th>
                    <th className="px-3 py-2">Баланс</th>
                    <th className="px-3 py-2">Сохранить</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceLoading ? (
                    <tr>
                      <td className="px-3 py-6 text-gray-500" colSpan={8}>
                        Загрузка...
                      </td>
                    </tr>
                  ) : balanceReport.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-gray-500" colSpan={8}>
                        Нет данных
                      </td>
                    </tr>
                  ) : (
                    balanceReport.map((row, idx) => (
                      <tr key={row.id} className="border-b">
                        <td className="px-3 py-2">{idx + 1}</td>
                        <td className="px-3 py-2">{iso(row.sale_date)}</td>
                        <td className="px-3 py-2">{row.agent}</td>
                        <td className="px-3 py-2">{row.direction || "—"}</td>
                        <td className="px-3 py-2">{money(row.sale_amount)}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            className="w-32 border rounded-lg px-3 py-2"
                            value={paymentDrafts[row.id] ?? ""}
                            onChange={(e) =>
                              setPaymentDrafts((p) => ({
                                ...p,
                                [row.id]: e.target.value,
                              }))
                            }
                          />
                        </td>
                        <td
                          className={`px-3 py-2 font-semibold ${
                            Number(row.balance || 0) > 0
                              ? "text-red-600"
                              : "text-emerald-700"
                          }`}
                        >
                          {money(row.balance)}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            className="px-3 py-2 rounded-lg border bg-white disabled:opacity-50"
                            disabled={paymentSavingId === row.id}
                            onClick={() => handleSavePayment(row.id)}
                          >
                            {paymentSavingId === row.id ? "..." : "Сохранить"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 text-sm text-gray-500">
              Формула: <span className="font-medium">баланс = предыдущий баланс + сумма продажи - оплата</span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
