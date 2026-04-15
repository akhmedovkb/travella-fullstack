//frontend/src/pages/admin/AdminTravelSales.jsx

import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

const SERVICE_TYPE_OPTIONS = [
  { value: "airticket", label: "Авиабилет" },
  { value: "visa", label: "Виза" },
  { value: "tourpackage", label: "Турпакет" },
];

const SERVICE_TYPE_LABELS = {
  airticket: "Авиабилет",
  visa: "Виза",
  tourpackage: "Турпакет",
};

const emptyAgentForm = {
  name: "",
  contact: "",
  address: "",
};

function localTodayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const todayIso = localTodayIso();

const emptySaleForm = {
  sale_date: todayIso,
  agent_id: "",
  service_type: "airticket",
  direction: "",
  traveller_name: "",
  sale_amount: "",
  net_amount: "",
};

const emptyPaymentForm = {
  payment_date: todayIso,
  agent_id: "",
  amount: "",
  comment: "",
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

  if (typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }

  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function clsTab(active) {
  return active
    ? "px-3 py-2 rounded-lg bg-black text-white text-sm"
    : "px-3 py-2 rounded-lg border bg-white text-sm";
}

function typeLabel(v) {
  return SERVICE_TYPE_LABELS[v] || "—";
}

function ledgerTypeLabel(v) {
  if (v === "sale") return "Продажа";
  if (v === "payment") return "Оплата";
  if (v === "payment_legacy") return "Оплата (старая)";
  return "—";
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

function exportToExcel(filename, rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([wbout], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename
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
  const [dailyServiceType, setDailyServiceType] = useState("");

  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [paymentsAgentId, setPaymentsAgentId] = useState("");
  const [paymentsDateFrom, setPaymentsDateFrom] = useState("");
  const [paymentsDateTo, setPaymentsDateTo] = useState("");

  const [salesReport, setSalesReport] = useState([]);
  const [salesReportLoading, setSalesReportLoading] = useState(false);
  const [salesAgentId, setSalesAgentId] = useState("");
  const [salesDateFrom, setSalesDateFrom] = useState("");
  const [salesDateTo, setSalesDateTo] = useState("");
  const [salesServiceType, setSalesServiceType] = useState("");

  const [balanceReport, setBalanceReport] = useState([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceAgentId, setBalanceAgentId] = useState("");
  const [balanceDateFrom, setBalanceDateFrom] = useState("");
  const [balanceDateTo, setBalanceDateTo] = useState("");
  const [balanceServiceType, setBalanceServiceType] = useState("");

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
      if (dailyServiceType) q.set("service_type", dailyServiceType);

      const res = await apiGet(`/api/admin/travel-sales/daily-sales?${q.toString()}`, "admin");
      setDailySales(Array.isArray(res?.rows) ? res.rows : []);
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось загрузить дневные продажи");
    } finally {
      setDailyLoading(false);
    }
  }

  async function loadPayments() {
    try {
      setPaymentsLoading(true);
      const q = new URLSearchParams();
      q.set("limit", "500");
      if (paymentsAgentId) q.set("agent_id", paymentsAgentId);
      if (paymentsDateFrom) q.set("date_from", paymentsDateFrom);
      if (paymentsDateTo) q.set("date_to", paymentsDateTo);

      const res = await apiGet(`/api/admin/travel-sales/payments?${q.toString()}`, "admin");
      setPayments(Array.isArray(res?.rows) ? res.rows : []);
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось загрузить оплаты");
    } finally {
      setPaymentsLoading(false);
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
      if (salesServiceType) q.set("service_type", salesServiceType);

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
      if (balanceServiceType) q.set("service_type", balanceServiceType);

      const res = await apiGet(
        `/api/admin/travel-sales/reports/agent-balance?${q.toString()}`,
        "admin"
      );

      setBalanceReport(Array.isArray(res?.rows) ? res.rows : []);
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
    if (tab === "daily") {
      loadDailySales();
    }
  }, [tab, dailyFilterAgentId, dailyDateFrom, dailyDateTo, dailyServiceType]);

  useEffect(() => {
    if (tab === "payments") {
      loadPayments();
    }
  }, [tab, paymentsAgentId, paymentsDateFrom, paymentsDateTo]);

  useEffect(() => {
    if (tab === "sales") {
      loadSalesReport();
    }
  }, [tab, salesAgentId, salesDateFrom, salesDateTo, salesServiceType]);

  useEffect(() => {
    if (tab === "balance") {
      loadBalanceReport();
    }
  }, [tab, balanceAgentId, balanceDateFrom, balanceDateTo, balanceServiceType]);

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

  const totalPayments = useMemo(
    () => payments.reduce((s, r) => s + Number(r.amount || 0), 0),
    [payments]
  );

  const totalBalance = useMemo(() => {
    const byAgent = new Map();

    const rowsAsc = [...balanceReport].sort((a, b) => {
      const da = String(a.txn_date || "");
      const db = String(b.txn_date || "");
      if (da !== db) return da.localeCompare(db);

      const ka = String(a.row_key || "");
      const kb = String(b.row_key || "");
      return ka.localeCompare(kb);
    });

    rowsAsc.forEach((r) => {
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
        service_type: String(saleForm.service_type || "").trim(),
        direction: String(saleForm.direction || "").trim(),
        traveller_name: String(saleForm.traveller_name || "").trim(),
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
      if (!payload.service_type) {
        tError("Выбери тип услуги");
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
      service_type: row.service_type || "airticket",
      direction: row.direction || "",
      traveller_name: row.traveller_name || "",
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

  async function handleSavePayment(e) {
    e.preventDefault();
    try {
      const payload = {
        payment_date: paymentForm.payment_date,
        agent_id: Number(paymentForm.agent_id),
        amount: Number(paymentForm.amount || 0),
        comment: String(paymentForm.comment || "").trim(),
      };

      if (!payload.agent_id) {
        tError("Выбери агента");
        return;
      }
      if (!payload.payment_date) {
        tError("Укажи дату оплаты");
        return;
      }
      if (payload.amount < 0) {
        tError("Сумма оплаты не может быть отрицательной");
        return;
      }

      if (editingPaymentId) {
        await apiPut(`/api/admin/travel-sales/payments/${editingPaymentId}`, payload, "admin");
        tSuccess("Оплата обновлена");
      } else {
        await apiPost("/api/admin/travel-sales/payments", payload, "admin");
        tSuccess("Оплата добавлена");
      }

      setEditingPaymentId(null);
      setPaymentForm(emptyPaymentForm);
      await loadPayments();
      await loadBalanceReport();
    } catch (e2) {
      console.error(e2);
      tError(e2?.message || "Ошибка сохранения оплаты");
    }
  }

  function startEditPayment(row) {
    setEditingPaymentId(row.id);
    setPaymentForm({
      payment_date: iso(row.payment_date) || todayIso,
      agent_id: String(row.agent_id || ""),
      amount: num(row.amount),
      comment: row.comment || "",
    });
    setTab("payments");
  }

  async function handleDeletePayment(id) {
    if (!window.confirm("Удалить оплату?")) return;
    try {
      await apiDelete(`/api/admin/travel-sales/payments/${id}`, "admin");
      tSuccess("Оплата удалена");
      if (editingPaymentId === id) {
        setEditingPaymentId(null);
        setPaymentForm(emptyPaymentForm);
      }
      await loadPayments();
      await loadBalanceReport();
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось удалить оплату");
    }
  }

  function exportSalesReport() {
    if (!salesReport.length) {
      tError("Нет данных для экспорта");
      return;
    }

    exportToExcel(
      `travel-sales-report-${new Date().toISOString().slice(0, 10)}.xlsx`,
      salesReport.map((row, idx) => ({
        "№": idx + 1,
        "Дата": iso(row.sale_date),
        "Агент": row.agent,
        "Тип услуги": typeLabel(row.service_type),
        "Направление": row.direction || "",
        "Name of traveller": row.traveller_name || "",
        "Сумма продажи": Number(row.sale_amount || 0),
        "Сумма нетто": Number(row.net_amount || 0),
        "Маржа": Number(row.margin || 0),
      }))
    );
  }

  function exportBalanceReport() {
    if (!balanceReport.length) {
      tError("Нет данных для экспорта");
      return;
    }

    exportToExcel(
      `travel-agent-balance-${new Date().toISOString().slice(0, 10)}.xlsx`,
      balanceReport.map((row, idx) => ({
        "№": idx + 1,
        "Дата операции": iso(row.txn_date),
        "Тип записи": ledgerTypeLabel(row.entry_type),
        "Агент": row.agent,
        "Тип услуги": typeLabel(row.service_type),
        "Направление": row.direction || "",
        "Name of traveller": row.traveller_name || "",
        "Продажа": Number(row.sale_amount || 0),
        "Оплата": Number(row.payment_amount || 0),
        "Комментарий": row.comment || "",
        "Дельта": Number(row.delta_amount || 0),
        "Баланс": Number(row.balance || 0),
      }))
    );
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
        <button className={clsTab(tab === "payments")} onClick={() => setTab("payments")}>
          Оплата агента
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
                  <label className="block text-sm text-gray-600 mb-1">Тип услуги</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2"
                    value={saleForm.service_type}
                    onChange={(e) =>
                      setSaleForm((p) => ({ ...p, service_type: e.target.value }))
                    }
                  >
                    {SERVICE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
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
                    placeholder="Например: Дели / Дубай / Ташкент"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Name of traveller</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    value={saleForm.traveller_name}
                    onChange={(e) =>
                      setSaleForm((p) => ({ ...p, traveller_name: e.target.value }))
                    }
                    placeholder="Например: Ali Valiyev"
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
                    saleForm.traveller_name ||
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

                  <select
                    className="border rounded-lg px-3 py-2 text-sm"
                    value={dailyServiceType}
                    onChange={(e) => setDailyServiceType(e.target.value)}
                  >
                    <option value="">Все типы</option>
                    {SERVICE_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
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
                      <th className="px-3 py-2">Тип</th>
                      <th className="px-3 py-2">Направление</th>
                      <th className="px-3 py-2">Name of traveller</th>
                      <th className="px-3 py-2">Продажа</th>
                      <th className="px-3 py-2">Нетто</th>
                      <th className="px-3 py-2 w-[180px]">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyLoading ? (
                      <tr>
                        <td className="px-3 py-6 text-gray-500" colSpan={9}>
                          Загрузка...
                        </td>
                      </tr>
                    ) : dailySales.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-gray-500" colSpan={9}>
                          Нет данных
                        </td>
                      </tr>
                    ) : (
                      dailySales.map((row, idx) => (
                        <tr key={row.id} className="border-b">
                          <td className="px-3 py-2">{idx + 1}</td>
                          <td className="px-3 py-2">{iso(row.sale_date)}</td>
                          <td className="px-3 py-2">{row.agent_name}</td>
                          <td className="px-3 py-2">{typeLabel(row.service_type)}</td>
                          <td className="px-3 py-2">{row.direction}</td>
                          <td className="px-3 py-2">{row.traveller_name || "—"}</td>
                          <td className="px-3 py-2">{money(row.sale_amount)}</td>
                          <td className="px-3 py-2">{money(row.net_amount)}</td>
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

      {tab === "payments" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-1">
            <Card title={editingPaymentId ? "Редактировать оплату" : "Добавить оплату"}>
              <form onSubmit={handleSavePayment} className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Дата оплаты</label>
                  <input
                    type="date"
                    className="w-full border rounded-lg px-3 py-2"
                    value={paymentForm.payment_date}
                    onChange={(e) =>
                      setPaymentForm((p) => ({ ...p, payment_date: e.target.value }))
                    }
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Агент</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2"
                    value={paymentForm.agent_id}
                    onChange={(e) =>
                      setPaymentForm((p) => ({ ...p, agent_id: e.target.value }))
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
                  <label className="block text-sm text-gray-600 mb-1">Сумма оплаты</label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2"
                    value={paymentForm.amount}
                    onChange={(e) =>
                      setPaymentForm((p) => ({ ...p, amount: e.target.value }))
                    }
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-600 mb-1">Комментарий</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2"
                    value={paymentForm.comment}
                    onChange={(e) =>
                      setPaymentForm((p) => ({ ...p, comment: e.target.value }))
                    }
                    placeholder="Комментарий"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-black text-white"
                  >
                    {editingPaymentId ? "Сохранить" : "Добавить"}
                  </button>

                  {(editingPaymentId ||
                    paymentForm.agent_id ||
                    paymentForm.amount ||
                    paymentForm.comment) && (
                    <button
                      type="button"
                      className="px-4 py-2 rounded-lg border bg-white"
                      onClick={() => {
                        setEditingPaymentId(null);
                        setPaymentForm(emptyPaymentForm);
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
              title="Список оплат"
              right={
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="border rounded-lg px-3 py-2 text-sm"
                    value={paymentsAgentId}
                    onChange={(e) => setPaymentsAgentId(e.target.value)}
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
                    value={paymentsDateFrom}
                    onChange={(e) => setPaymentsDateFrom(e.target.value)}
                  />
                  <input
                    type="date"
                    className="border rounded-lg px-3 py-2 text-sm"
                    value={paymentsDateTo}
                    onChange={(e) => setPaymentsDateTo(e.target.value)}
                  />

                  <button
                    className="px-3 py-2 rounded-lg border bg-white text-sm"
                    onClick={loadPayments}
                    type="button"
                  >
                    Фильтр
                  </button>
                </div>
              }
            >
              <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <StatCard title="Сумма оплат" value={money(totalPayments)} />
                <StatCard title="Записей" value={String(payments.length)} />
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left border-b bg-gray-50">
                      <th className="px-3 py-2">№</th>
                      <th className="px-3 py-2">Дата оплаты</th>
                      <th className="px-3 py-2">Агент</th>
                      <th className="px-3 py-2">Сумма</th>
                      <th className="px-3 py-2">Комментарий</th>
                      <th className="px-3 py-2 w-[180px]">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentsLoading ? (
                      <tr>
                        <td className="px-3 py-6 text-gray-500" colSpan={6}>
                          Загрузка...
                        </td>
                      </tr>
                    ) : payments.length === 0 ? (
                      <tr>
                        <td className="px-3 py-6 text-gray-500" colSpan={6}>
                          Нет данных
                        </td>
                      </tr>
                    ) : (
                      payments.map((row, idx) => (
                        <tr key={row.id} className="border-b">
                          <td className="px-3 py-2">{idx + 1}</td>
                          <td className="px-3 py-2">{iso(row.payment_date)}</td>
                          <td className="px-3 py-2">{row.agent_name}</td>
                          <td className="px-3 py-2">{money(row.amount)}</td>
                          <td className="px-3 py-2">{row.comment || "—"}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="px-3 py-1.5 rounded-lg border bg-white"
                                onClick={() => startEditPayment(row)}
                              >
                                Изменить
                              </button>
                              <button
                                className="px-3 py-1.5 rounded-lg border text-red-600 bg-white"
                                onClick={() => handleDeletePayment(row.id)}
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

                <select
                  className="border rounded-lg px-3 py-2 text-sm"
                  value={salesServiceType}
                  onChange={(e) => setSalesServiceType(e.target.value)}
                >
                  <option value="">Все типы</option>
                  {SERVICE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
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

                <button
                  className="px-3 py-2 rounded-lg bg-black text-white text-sm"
                  onClick={exportSalesReport}
                  type="button"
                >
                  Excel
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
                    <th className="px-3 py-2">Тип</th>
                    <th className="px-3 py-2">Направление</th>
                    <th className="px-3 py-2">Name of traveller</th>
                    <th className="px-3 py-2">Сумма продажи</th>
                    <th className="px-3 py-2">Сумма нетто</th>
                    <th className="px-3 py-2">Маржа</th>
                  </tr>
                </thead>
                <tbody>
                  {salesReportLoading ? (
                    <tr>
                      <td className="px-3 py-6 text-gray-500" colSpan={9}>
                        Загрузка...
                      </td>
                    </tr>
                  ) : salesReport.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-gray-500" colSpan={9}>
                        Нет данных
                      </td>
                    </tr>
                  ) : (
                    salesReport.map((row, idx) => (
                      <tr key={row.id} className="border-b">
                        <td className="px-3 py-2">{idx + 1}</td>
                        <td className="px-3 py-2">{iso(row.sale_date)}</td>
                        <td className="px-3 py-2">{row.agent}</td>
                        <td className="px-3 py-2">{typeLabel(row.service_type)}</td>
                        <td className="px-3 py-2">{row.direction || "—"}</td>
                        <td className="px-3 py-2">{row.traveller_name || "—"}</td>
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

                <select
                  className="border rounded-lg px-3 py-2 text-sm"
                  value={balanceServiceType}
                  onChange={(e) => setBalanceServiceType(e.target.value)}
                >
                  <option value="">Все типы</option>
                  {SERVICE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
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

                <button
                  className="px-3 py-2 rounded-lg bg-black text-white text-sm"
                  onClick={exportBalanceReport}
                  type="button"
                >
                  Excel
                </button>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b bg-gray-50">
                    <th className="px-3 py-2">№</th>
                    <th className="px-3 py-2">Дата операции</th>
                    <th className="px-3 py-2">Тип записи</th>
                    <th className="px-3 py-2">Агент</th>
                    <th className="px-3 py-2">Тип услуги</th>
                    <th className="px-3 py-2">Направление</th>
                    <th className="px-3 py-2">Name of traveller</th>
                    <th className="px-3 py-2">Продажа</th>
                    <th className="px-3 py-2">Оплата</th>
                    <th className="px-3 py-2">Комментарий</th>
                    <th className="px-3 py-2">Баланс</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceLoading ? (
                    <tr>
                      <td className="px-3 py-6 text-gray-500" colSpan={11}>
                        Загрузка...
                      </td>
                    </tr>
                  ) : balanceReport.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-gray-500" colSpan={11}>
                        Нет данных
                      </td>
                    </tr>
                  ) : (
                    balanceReport.map((row, idx) => (
                      <tr key={row.row_key || `${row.entry_type}-${idx}`} className="border-b">
                        <td className="px-3 py-2">{idx + 1}</td>
                        <td className="px-3 py-2">{iso(row.txn_date)}</td>
                        <td className="px-3 py-2">{ledgerTypeLabel(row.entry_type)}</td>
                        <td className="px-3 py-2">{row.agent}</td>
                        <td className="px-3 py-2">{typeLabel(row.service_type)}</td>
                        <td className="px-3 py-2">{row.direction || "—"}</td>
                        <td className="px-3 py-2">{row.traveller_name || "—"}</td>
                        <td className="px-3 py-2">{money(row.sale_amount)}</td>
                        <td className="px-3 py-2">{money(row.payment_amount)}</td>
                        <td className="px-3 py-2">{row.comment || "—"}</td>
                        <td
                          className={`px-3 py-2 font-semibold ${
                            Number(row.balance || 0) > 0
                              ? "text-red-600"
                              : "text-emerald-700"
                          }`}
                        >
                          {money(row.balance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 text-sm text-gray-500">
              Формула:{" "}
              <span className="font-medium">
                баланс = предыдущий баланс + продажа - оплата
              </span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
