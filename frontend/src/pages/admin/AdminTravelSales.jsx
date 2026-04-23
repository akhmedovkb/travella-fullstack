// frontend/src/pages/admin/AdminTravelSales.jsx

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

const PAYMENT_ENTRY_OPTIONS = [
  { value: "payment", label: "Оплата" },
  { value: "refund", label: "Возврат" },
];

const SERVICE_TYPE_LABELS = {
  airticket: "Авиабилет",
  visa: "Виза",
  tourpackage: "Турпакет",
};

const emptyAgentForm = { name: "", contact: "", address: "" };

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
  entry_type: "payment",
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

function moneyCompact(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n / 1_000_000_000)} млрд`;
  if (abs >= 1_000_000) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n / 1_000_000)} млн`;
  if (abs >= 1_000) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n / 1_000)} тыс`;
  return money(n);
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

function nowLabel() {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function typeLabel(v) {
  return SERVICE_TYPE_LABELS[v] || "—";
}

function ledgerTypeLabel(v) {
  if (v === "sale") return "Продажа";
  if (v === "payment") return "Оплата";
  if (v === "refund") return "Возврат";
  if (v === "payment_legacy") return "Оплата (старая)";
  return "—";
}

function badgeClassByServiceType(v) {
  if (v === "airticket") return "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200";
  if (v === "visa") return "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200";
  if (v === "tourpackage") return "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200";
  return "bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200";
}

function badgeClassByLedgerType(v) {
  if (v === "sale") return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
  if (v === "payment") return "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200";
  if (v === "refund") return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  if (v === "payment_legacy") return "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200";
  return "bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200";
}

function amountClass(v, mode = "default") {
  const n = Number(v || 0);
  if (mode === "balance") return n > 0 ? "text-red-600" : n < 0 ? "text-emerald-700" : "text-gray-900";
  return n < 0 ? "text-red-600" : "text-gray-900";
}

function clsTab(active) {
  return active
    ? "inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
    : "inline-flex items-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50";
}

function inputClass(extra = "") {
  return `w-full rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-200 ${extra}`;
}

function Card({ title, subtitle, children, right }) {
  return (
    <section className="rounded-[28px] border border-gray-200 bg-white p-4 shadow-[0_16px_45px_rgba(15,23,42,0.05)] md:p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
        </div>
        {right || null}
      </div>
      {children}
    </section>
  );
}

function StatCard({ title, value, hint, accent = "blue" }) {
  const accents = {
    blue: "border-blue-200 from-blue-50/90",
    emerald: "border-emerald-200 from-emerald-50/90",
    amber: "border-amber-200 from-amber-50/90",
    violet: "border-violet-200 from-violet-50/90",
    rose: "border-rose-200 from-rose-50/90",
    slate: "border-slate-200 from-slate-50/90",
  };
  return (
    <div className={`rounded-[28px] border bg-gradient-to-br to-white p-4 shadow-sm ${accents[accent] || accents.blue}`}>
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-2 text-[30px] font-semibold leading-none tracking-tight text-gray-900">{value}</div>
      {hint ? <div className="mt-2 text-xs text-gray-400">{hint}</div> : null}
    </div>
  );
}

function ActionButton({ children, variant = "default", className = "", ...props }) {
  const styles = {
    primary: "rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-black",
    default: "rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50",
    danger: "rounded-2xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50",
  };
  return <button className={`${styles[variant] || styles.default} ${className}`} {...props}>{children}</button>;
}

function Badge({ children, className = "" }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{children}</span>;
}

function TableShell({ children }) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-gray-100 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="max-w-full overflow-x-auto">{children}</div>
    </div>
  );
}

function Table({ children }) {
  return <table className="min-w-full text-sm">{children}</table>;
}

function TableHead({ children }) {
  return <thead className="bg-gray-50">{children}</thead>;
}

function TH({ children, align = "left", className = "" }) {
  return <th className={`whitespace-nowrap border-b border-gray-100 px-3 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${align === "right" ? "text-right" : "text-left"} ${className}`}>{children}</th>;
}

function TD({ children, align = "left", className = "" }) {
  return <td className={`px-3 py-3.5 align-top text-sm text-gray-700 ${align === "right" ? "text-right" : "text-left"} ${className}`}>{children}</td>;
}

function EmptyRow({ loading, colSpan }) {
  return (
    <tr>
      <td className="px-3 py-10 text-center text-sm text-gray-500" colSpan={colSpan}>
        {loading ? "Загрузка..." : "Нет данных"}
      </td>
    </tr>
  );
}

function exportToExcel(filename, rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
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
  const [paymentsEntryType, setPaymentsEntryType] = useState("");
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
      if (paymentsEntryType) q.set("entry_type", paymentsEntryType);
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
      const res = await apiGet(`/api/admin/travel-sales/reports/agent-balance?${q.toString()}`, "admin");
      setBalanceReport(Array.isArray(res?.rows) ? res.rows : []);
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось загрузить баланс агентов");
    } finally {
      setBalanceLoading(false);
    }
  }

  useEffect(() => { loadAgents(); }, []);
  useEffect(() => { if (tab === "daily") loadDailySales(); }, [tab, dailyFilterAgentId, dailyDateFrom, dailyDateTo, dailyServiceType]);
  useEffect(() => { if (tab === "payments") loadPayments(); }, [tab, paymentsAgentId, paymentsEntryType, paymentsDateFrom, paymentsDateTo]);
  useEffect(() => { if (tab === "sales") loadSalesReport(); }, [tab, salesAgentId, salesDateFrom, salesDateTo, salesServiceType]);
  useEffect(() => { if (tab === "balance") loadBalanceReport(); }, [tab, balanceAgentId, balanceDateFrom, balanceDateTo, balanceServiceType]);

  const totalSales = useMemo(() => salesReport.reduce((s, r) => s + Number(r.sale_amount || 0), 0), [salesReport]);
  const totalNet = useMemo(() => salesReport.reduce((s, r) => s + Number(r.net_amount || 0), 0), [salesReport]);
  const totalMargin = useMemo(() => salesReport.reduce((s, r) => s + Number(r.margin || 0), 0), [salesReport]);
  const totalPayments = useMemo(() => payments.reduce((s, r) => s + (String(r.entry_type || "payment") === "payment" ? Number(r.amount || 0) : 0), 0), [payments]);
  const totalRefunds = useMemo(() => payments.reduce((s, r) => s + (String(r.entry_type || "payment") === "refund" ? Number(r.amount || 0) : 0), 0), [payments]);

  const totalBalance = useMemo(() => {
    const byAgent = new Map();
    [...balanceReport]
      .sort((a, b) => `${a.txn_date || ""}${a.row_key || ""}`.localeCompare(`${b.txn_date || ""}${b.row_key || ""}`))
      .forEach((r) => byAgent.set(r.agent_id, Number(r.balance || 0)));
    return Array.from(byAgent.values()).reduce((s, n) => s + n, 0);
  }, [balanceReport]);

  const agentsWithContact = useMemo(() => agents.filter((a) => String(a.contact || "").trim()).length, [agents]);
  const agentsWithAddress = useMemo(() => agents.filter((a) => String(a.address || "").trim()).length, [agents]);
  const paymentsNet = totalPayments - totalRefunds;

  const currentTabSummary = useMemo(() => {
    if (tab === "daily") return `Продажи в фокусе • ${dailySales.length} записей`;
    if (tab === "payments") return `Оплаты в фокусе • ${payments.length} записей`;
    if (tab === "sales") return `Отчет по продажам • ${salesReport.length} строк`;
    if (tab === "balance") return `Баланс агентов • ${balanceReport.length} строк`;
    return `Справочник агентов • ${agents.length} записей`;
  }, [tab, dailySales.length, payments.length, salesReport.length, balanceReport.length, agents.length]);

  async function handleSaveAgent(e) {
    e.preventDefault();
    try {
      const payload = {
        name: agentForm.name.trim(),
        contact: agentForm.contact.trim(),
        address: agentForm.address.trim(),
      };
      if (!payload.name) return tError("Введите наименование агента");
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
    setAgentForm({ name: row.name || "", contact: row.contact || "", address: row.address || "" });
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
      if (!payload.agent_id) return tError("Выбери агента");
      if (!payload.sale_date) return tError("Укажи дату");
      if (!payload.service_type) return tError("Выбери тип услуги");
      if (!payload.direction) return tError("Укажи направление");
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
        entry_type: paymentForm.entry_type || "payment",
        amount: Number(paymentForm.amount || 0),
        comment: String(paymentForm.comment || "").trim(),
      };
      if (!payload.agent_id) return tError("Выбери агента");
      if (!payload.payment_date) return tError("Укажи дату оплаты");
      if (payload.amount < 0) return tError("Сумма оплаты не может быть отрицательной");
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
      entry_type: row.entry_type || "payment",
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
    if (!salesReport.length) return tError("Нет данных для экспорта");
    exportToExcel(`travel-sales-report-${new Date().toISOString().slice(0, 10)}.xlsx`, salesReport.map((row, idx) => ({
      "№": idx + 1,
      Дата: iso(row.sale_date),
      Агент: row.agent,
      "Тип услуги": typeLabel(row.service_type),
      Направление: row.direction || "",
      "Name of traveller": row.traveller_name || "",
      "Сумма продажи": Number(row.sale_amount || 0),
      "Сумма нетто": Number(row.net_amount || 0),
      Маржа: Number(row.margin || 0),
    })));
  }

  function exportBalanceReport() {
    if (!balanceReport.length) return tError("Нет данных для экспорта");
    exportToExcel(`travel-agent-balance-${new Date().toISOString().slice(0, 10)}.xlsx`, balanceReport.map((row, idx) => ({
      "№": idx + 1,
      "Дата операции": iso(row.txn_date),
      "Тип записи": ledgerTypeLabel(row.entry_type),
      Агент: row.agent,
      "Тип услуги": typeLabel(row.service_type),
      Направление: row.direction || "",
      "Name of traveller": row.traveller_name || "",
      Продажа: Number(row.sale_amount || 0),
      Оплата: Number(row.payment_amount || 0),
      Возврат: Number(row.refund_amount || 0),
      Комментарий: row.comment || "",
      Дельта: Number(row.delta_amount || 0),
      Баланс: Number(row.balance || 0),
    })));
  }

  return (
    <div className="space-y-6 [&_tbody_tr]:border-b [&_tbody_tr]:border-gray-100 [&_tbody_tr]:transition [&_tbody_tr:hover]:bg-gray-50/80">
      <section className="overflow-hidden rounded-[32px] border border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-6 py-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.22)] md:px-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" /> Travel Sales Admin
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight md:text-4xl">Финансы по агентам — аккуратно, ясно и по делу</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
              Улучшенный интерфейс для продаж, оплат, отчетов и баланса агентов без изменения текущей CRUD-логики.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-300">
              <span className="inline-flex items-center gap-2"><span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" /> Система в норме</span>
              <span>Сейчас работает: {agentsWithContact} агентов</span>
              <span>{currentTabSummary}</span>
              <span>{nowLabel()}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:min-w-[560px]">
            <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur"><div className="text-[11px] uppercase tracking-wide text-slate-300">Агенты</div><div className="mt-1 text-2xl font-semibold">{agents.length}</div></div>
            <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur"><div className="text-[11px] uppercase tracking-wide text-slate-300">Продажи</div><div className="mt-1 text-2xl font-semibold">{moneyCompact(totalSales)}</div></div>
            <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur"><div className="text-[11px] uppercase tracking-wide text-slate-300">Оплаты</div><div className="mt-1 text-2xl font-semibold">{moneyCompact(totalPayments)}</div></div>
            <div className="rounded-3xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur"><div className="text-[11px] uppercase tracking-wide text-slate-300">Баланс</div><div className="mt-1 text-2xl font-semibold">{moneyCompact(totalBalance)}</div></div>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 rounded-[28px] border border-gray-200 bg-white/90 p-2 shadow-sm backdrop-blur">
        <button className={clsTab(tab === "agents")} onClick={() => setTab("agents")}>Все агенты</button>
        <button className={clsTab(tab === "daily")} onClick={() => setTab("daily")}>Дневная продажа</button>
        <button className={clsTab(tab === "payments")} onClick={() => setTab("payments")}>Оплата агента</button>
        <button className={clsTab(tab === "sales")} onClick={() => setTab("sales")}>Отчет продаж</button>
        <button className={clsTab(tab === "balance")} onClick={() => setTab("balance")}>Баланс агента</button>
      </div>

      {tab === "agents" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Всего агентов" value={String(agents.length)} hint="Отображается с учетом поиска" accent="blue" />
            <StatCard title="С заполненным контактом" value={String(agentsWithContact)} hint="Есть телефон или контакт" accent="emerald" />
            <StatCard title="С указанным адресом" value={String(agentsWithAddress)} hint="Для быстрой навигации" accent="amber" />
            <StatCard title="Режим" value={editingAgentId ? "Редактирование" : "Добавление"} hint={editingAgentId ? "Открыта текущая запись" : "Создание новой записи"} accent="violet" />
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="xl:col-span-1">
              <Card title={editingAgentId ? "Редактировать агента" : "Добавить агента"} subtitle="Чистая форма без лишнего шума">
                <form onSubmit={handleSaveAgent} className="space-y-4">
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Наименование</label><input className={inputClass()} value={agentForm.name} onChange={(e) => setAgentForm((p) => ({ ...p, name: e.target.value }))} placeholder="Например: Air Broker" /></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Контакт</label><input className={inputClass()} value={agentForm.contact} onChange={(e) => setAgentForm((p) => ({ ...p, contact: e.target.value }))} placeholder="+998 ..." /></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Адрес</label><textarea className={inputClass("min-h-[110px] resize-y")} value={agentForm.address} onChange={(e) => setAgentForm((p) => ({ ...p, address: e.target.value }))} placeholder="Адрес агента" /></div>
                  <div className="flex flex-wrap gap-2"><ActionButton type="submit" variant="primary">{editingAgentId ? "Сохранить" : "Добавить"}</ActionButton>{(editingAgentId || agentForm.name || agentForm.contact || agentForm.address) && <ActionButton type="button" onClick={() => { setEditingAgentId(null); setAgentForm(emptyAgentForm); }}>Сбросить</ActionButton>}</div>
                </form>
              </Card>
            </div>
            <div className="xl:col-span-2">
              <Card title="Список агентов" subtitle="Удобнее читать, быстрее искать, приятнее смотреть" right={<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"><input className={inputClass("sm:w-64")} placeholder="Поиск по названию..." value={agentQuery} onChange={(e) => setAgentQuery(e.target.value)} /><ActionButton onClick={loadAgents} type="button">Найти</ActionButton></div>}>
                <TableShell>
                  <Table>
                    <TableHead><tr><TH>№</TH><TH>Наименование</TH><TH>Контакт</TH><TH>Адрес</TH><TH className="w-[180px]">Действия</TH></tr></TableHead>
                    <tbody>
                      {agentsLoading || agents.length === 0 ? <EmptyRow loading={agentsLoading} colSpan={5} /> : agents.map((row, idx) => (
                        <tr key={row.id}>
                          <TD className="text-gray-500">{idx + 1}</TD>
                          <TD><div className="font-semibold text-gray-900">{row.name}</div></TD>
                          <TD>{row.contact || "—"}</TD>
                          <TD className="max-w-[280px] whitespace-pre-wrap break-words">{row.address || "—"}</TD>
                          <TD><div className="flex flex-wrap gap-3"><button onClick={() => startEditAgent(row)} type="button" className="text-sm font-medium text-blue-600 transition hover:text-blue-800 hover:underline">Изменить</button><button onClick={() => handleDeleteAgent(row.id)} type="button" className="text-sm font-medium text-red-500 transition hover:text-red-700 hover:underline">Удалить</button></div></TD>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableShell>
              </Card>
            </div>
          </div>
        </>
      )}

      {tab === "daily" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Записей в таблице" value={String(dailySales.length)} hint="С учетом фильтров" accent="blue" />
            <StatCard title="Сумма продаж" value={money(dailySales.reduce((s, r) => s + Number(r.sale_amount || 0), 0))} hint={`≈ ${moneyCompact(dailySales.reduce((s, r) => s + Number(r.sale_amount || 0), 0))}`} accent="emerald" />
            <StatCard title="Сумма нетто" value={money(dailySales.reduce((s, r) => s + Number(r.net_amount || 0), 0))} hint={`≈ ${moneyCompact(dailySales.reduce((s, r) => s + Number(r.net_amount || 0), 0))}`} accent="amber" />
            <StatCard title="Режим" value={editingSaleId ? "Редактирование" : "Новая продажа"} hint={editingSaleId ? "Открыта текущая запись" : "Ввод новой продажи"} accent="violet" />
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="xl:col-span-1">
              <Card title={editingSaleId ? "Редактировать продажу" : "Добавить продажу"} subtitle="Форма остается прежней по логике, но выглядит чище">
                <form onSubmit={handleSaveSale} className="space-y-4">
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Дата</label><input type="date" className={inputClass()} value={saleForm.sale_date} onChange={(e) => setSaleForm((p) => ({ ...p, sale_date: e.target.value }))} /></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Агент</label><select className={inputClass()} value={saleForm.agent_id} onChange={(e) => setSaleForm((p) => ({ ...p, agent_id: e.target.value }))}><option value="">Выберите агента</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Тип услуги</label><select className={inputClass()} value={saleForm.service_type} onChange={(e) => setSaleForm((p) => ({ ...p, service_type: e.target.value }))}>{SERVICE_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Направление</label><input className={inputClass()} value={saleForm.direction} onChange={(e) => setSaleForm((p) => ({ ...p, direction: e.target.value }))} placeholder="Например: Дели / Дубай / Ташкент" /></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Name of traveller</label><input className={inputClass()} value={saleForm.traveller_name} onChange={(e) => setSaleForm((p) => ({ ...p, traveller_name: e.target.value }))} placeholder="Например: Ali Valiyev" /></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Сумма продажи</label><input type="number" className={inputClass()} value={saleForm.sale_amount} onChange={(e) => setSaleForm((p) => ({ ...p, sale_amount: e.target.value }))} placeholder="0" /></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Сумма нетто</label><input type="number" className={inputClass()} value={saleForm.net_amount} onChange={(e) => setSaleForm((p) => ({ ...p, net_amount: e.target.value }))} placeholder="0" /></div>
                  <div className="flex flex-wrap gap-2"><ActionButton type="submit" variant="primary">{editingSaleId ? "Сохранить" : "Добавить"}</ActionButton>{(editingSaleId || saleForm.agent_id || saleForm.direction || saleForm.traveller_name || saleForm.sale_amount || saleForm.net_amount) && <ActionButton type="button" onClick={() => { setEditingSaleId(null); setSaleForm(emptySaleForm); }}>Сбросить</ActionButton>}</div>
                </form>
              </Card>
            </div>
            <div className="xl:col-span-2">
              <Card title="Список продаж" subtitle="Акцент на важных цифрах" right={<div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end"><select className={inputClass("lg:w-[180px]")} value={dailyFilterAgentId} onChange={(e) => setDailyFilterAgentId(e.target.value)}><option value="">Все агенты</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className={inputClass("lg:w-[170px]")} value={dailyServiceType} onChange={(e) => setDailyServiceType(e.target.value)}><option value="">Все типы</option>{SERVICE_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select><input type="date" className={inputClass("lg:w-[160px]")} value={dailyDateFrom} onChange={(e) => setDailyDateFrom(e.target.value)} /><input type="date" className={inputClass("lg:w-[160px]")} value={dailyDateTo} onChange={(e) => setDailyDateTo(e.target.value)} /><ActionButton className="lg:w-auto" onClick={loadDailySales} type="button">Фильтр</ActionButton></div>}>
                <TableShell>
                  <Table>
                    <TableHead><tr><TH>№</TH><TH>Дата</TH><TH>Агент</TH><TH>Тип</TH><TH>Направление</TH><TH>Name of traveller</TH><TH align="right">Продажа</TH><TH align="right">Нетто</TH><TH className="w-[180px]">Действия</TH></tr></TableHead>
                    <tbody>
                      {dailyLoading || dailySales.length === 0 ? <EmptyRow loading={dailyLoading} colSpan={9} /> : dailySales.map((row, idx) => (
                        <tr key={row.id}>
                          <TD className="text-gray-500">{idx + 1}</TD>
                          <TD>{iso(row.sale_date)}</TD>
                          <TD><div className="font-medium text-gray-900">{row.agent_name || row.agent}</div></TD>
                          <TD><Badge className={badgeClassByServiceType(row.service_type)}>{typeLabel(row.service_type)}</Badge></TD>
                          <TD className="max-w-[220px] whitespace-pre-wrap break-words">{row.direction || "—"}</TD>
                          <TD>{row.traveller_name || "—"}</TD>
                          <TD align="right" className="font-semibold text-gray-900">{money(row.sale_amount)}</TD>
                          <TD align="right" className="font-semibold text-gray-900">{money(row.net_amount)}</TD>
                          <TD><div className="flex flex-wrap gap-3"><button onClick={() => startEditSale(row)} type="button" className="text-sm font-medium text-blue-600 transition hover:text-blue-800 hover:underline">Изменить</button><button onClick={() => handleDeleteSale(row.id)} type="button" className="text-sm font-medium text-red-500 transition hover:text-red-700 hover:underline">Удалить</button></div></TD>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableShell>
              </Card>
            </div>
          </div>
        </>
      )}

      {tab === "payments" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Сумма оплат" value={money(totalPayments)} hint={`≈ ${moneyCompact(totalPayments)}`} accent="blue" />
            <StatCard title="Сумма возвратов" value={money(totalRefunds)} hint={`≈ ${moneyCompact(totalRefunds)}`} accent="amber" />
            <StatCard title="Чистый эффект" value={money(paymentsNet)} hint={`≈ ${moneyCompact(paymentsNet)}`} accent="emerald" />
            <StatCard title="Записей" value={String(payments.length)} hint="По текущим фильтрам" accent="violet" />
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="xl:col-span-1">
              <Card title={editingPaymentId ? "Редактировать оплату" : "Добавить оплату"} subtitle="Оплаты и возвраты теперь читаются легче">
                <form onSubmit={handleSavePayment} className="space-y-4">
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Дата оплаты</label><input type="date" className={inputClass()} value={paymentForm.payment_date} onChange={(e) => setPaymentForm((p) => ({ ...p, payment_date: e.target.value }))} /></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Агент</label><select className={inputClass()} value={paymentForm.agent_id} onChange={(e) => setPaymentForm((p) => ({ ...p, agent_id: e.target.value }))}><option value="">Выберите агента</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Тип записи</label><select className={inputClass()} value={paymentForm.entry_type} onChange={(e) => setPaymentForm((p) => ({ ...p, entry_type: e.target.value }))}>{PAYMENT_ENTRY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Сумма оплаты</label><input type="number" className={inputClass()} value={paymentForm.amount} onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0" /></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Комментарий</label><textarea className={inputClass("min-h-[100px] resize-y")} value={paymentForm.comment} onChange={(e) => setPaymentForm((p) => ({ ...p, comment: e.target.value }))} placeholder="Комментарий" /></div>
                  <div className="flex flex-wrap gap-2"><ActionButton type="submit" variant="primary">{editingPaymentId ? "Сохранить" : "Добавить"}</ActionButton>{(editingPaymentId || paymentForm.agent_id || paymentForm.amount || paymentForm.comment) && <ActionButton type="button" onClick={() => { setEditingPaymentId(null); setPaymentForm(emptyPaymentForm); }}>Сбросить</ActionButton>}</div>
                </form>
              </Card>
            </div>
            <div className="xl:col-span-2">
              <Card title="Список оплат" subtitle="Суммы и типы операций выделены визуально" right={<div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end"><select className={inputClass("lg:w-[180px]")} value={paymentsAgentId} onChange={(e) => setPaymentsAgentId(e.target.value)}><option value="">Все агенты</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className={inputClass("lg:w-[170px]")} value={paymentsEntryType} onChange={(e) => setPaymentsEntryType(e.target.value)}><option value="">Все записи</option>{PAYMENT_ENTRY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select><input type="date" className={inputClass("lg:w-[160px]")} value={paymentsDateFrom} onChange={(e) => setPaymentsDateFrom(e.target.value)} /><input type="date" className={inputClass("lg:w-[160px]")} value={paymentsDateTo} onChange={(e) => setPaymentsDateTo(e.target.value)} /><ActionButton className="lg:w-auto" onClick={loadPayments} type="button">Фильтр</ActionButton></div>}>
                <TableShell>
                  <Table>
                    <TableHead><tr><TH>№</TH><TH>Дата оплаты</TH><TH>Агент</TH><TH>Тип записи</TH><TH align="right">Сумма</TH><TH>Комментарий</TH><TH className="w-[180px]">Действия</TH></tr></TableHead>
                    <tbody>
                      {paymentsLoading || payments.length === 0 ? <EmptyRow loading={paymentsLoading} colSpan={7} /> : payments.map((row, idx) => (
                        <tr key={row.id}>
                          <TD className="text-gray-500">{idx + 1}</TD>
                          <TD>{iso(row.payment_date)}</TD>
                          <TD><div className="font-medium text-gray-900">{row.agent_name || row.agent}</div></TD>
                          <TD><Badge className={badgeClassByLedgerType(row.entry_type)}>{ledgerTypeLabel(row.entry_type)}</Badge></TD>
                          <TD align="right" className="font-semibold text-gray-900">{money(row.amount)}</TD>
                          <TD className="max-w-[260px] whitespace-pre-wrap break-words">{row.comment || "—"}</TD>
                          <TD><div className="flex flex-wrap gap-3"><button onClick={() => startEditPayment(row)} type="button" className="text-sm font-medium text-blue-600 transition hover:text-blue-800 hover:underline">Изменить</button><button onClick={() => handleDeletePayment(row.id)} type="button" className="text-sm font-medium text-red-500 transition hover:text-red-700 hover:underline">Удалить</button></div></TD>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableShell>
              </Card>
            </div>
          </div>
        </>
      )}

      {tab === "sales" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Сумма продаж" value={money(totalSales)} hint={`≈ ${moneyCompact(totalSales)}`} accent="blue" />
            <StatCard title="Сумма нетто" value={money(totalNet)} hint={`≈ ${moneyCompact(totalNet)}`} accent="amber" />
            <StatCard title="Маржа" value={money(totalMargin)} hint={`≈ ${moneyCompact(totalMargin)}`} accent="emerald" />
            <StatCard title="Записей" value={String(salesReport.length)} hint="По текущим фильтрам" accent="violet" />
          </div>
          <Card title="Отчет продаж" subtitle="Сильный акцент на деньгах и марже" right={<div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end"><select className={inputClass("lg:w-[180px]")} value={salesAgentId} onChange={(e) => setSalesAgentId(e.target.value)}><option value="">Все агенты</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className={inputClass("lg:w-[170px]")} value={salesServiceType} onChange={(e) => setSalesServiceType(e.target.value)}><option value="">Все типы</option>{SERVICE_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select><input type="date" className={inputClass("lg:w-[160px]")} value={salesDateFrom} onChange={(e) => setSalesDateFrom(e.target.value)} /><input type="date" className={inputClass("lg:w-[160px]")} value={salesDateTo} onChange={(e) => setSalesDateTo(e.target.value)} /><ActionButton onClick={loadSalesReport} type="button">Фильтр</ActionButton><ActionButton variant="primary" onClick={exportSalesReport} type="button">Excel</ActionButton></div>}>
            <TableShell>
              <Table>
                <TableHead><tr><TH>№</TH><TH>Дата</TH><TH>Агент</TH><TH>Тип</TH><TH>Направление</TH><TH>Name of traveller</TH><TH align="right">Сумма продажи</TH><TH align="right">Сумма нетто</TH><TH align="right">Маржа</TH></tr></TableHead>
                <tbody>
                  {salesReportLoading || salesReport.length === 0 ? <EmptyRow loading={salesReportLoading} colSpan={9} /> : salesReport.map((row, idx) => (
                    <tr key={row.id || `${row.sale_date}-${idx}`}>
                      <TD className="text-gray-500">{idx + 1}</TD>
                      <TD>{iso(row.sale_date)}</TD>
                      <TD><div className="font-medium text-gray-900">{row.agent}</div></TD>
                      <TD><Badge className={badgeClassByServiceType(row.service_type)}>{typeLabel(row.service_type)}</Badge></TD>
                      <TD className="max-w-[220px] whitespace-pre-wrap break-words">{row.direction || "—"}</TD>
                      <TD>{row.traveller_name || "—"}</TD>
                      <TD align="right" className="font-semibold text-gray-900">{money(row.sale_amount)}</TD>
                      <TD align="right" className="font-semibold text-gray-900">{money(row.net_amount)}</TD>
                      <TD align="right" className="font-semibold text-emerald-700">{money(row.margin)}</TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableShell>
          </Card>
        </>
      )}

      {tab === "balance" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Общий баланс" value={money(totalBalance)} hint={`≈ ${moneyCompact(totalBalance)}`} accent="rose" />
            <StatCard title="Строк в отчете" value={String(balanceReport.length)} hint="По текущим фильтрам" accent="blue" />
            <StatCard title="Продажи в отчете" value={money(balanceReport.reduce((s, r) => s + Number(r.sale_amount || 0), 0))} hint={`≈ ${moneyCompact(balanceReport.reduce((s, r) => s + Number(r.sale_amount || 0), 0))}`} accent="emerald" />
            <StatCard title="Оплаты + возвраты" value={money(balanceReport.reduce((s, r) => s + Number(r.payment_amount || 0) + Number(r.refund_amount || 0), 0))} hint={`≈ ${moneyCompact(balanceReport.reduce((s, r) => s + Number(r.payment_amount || 0) + Number(r.refund_amount || 0), 0))}`} accent="amber" />
          </div>
          <Card title="Баланс агента" subtitle="Лучше читается последовательность операций и текущий баланс" right={<div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end"><select className={inputClass("lg:w-[180px]")} value={balanceAgentId} onChange={(e) => setBalanceAgentId(e.target.value)}><option value="">Все агенты</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className={inputClass("lg:w-[170px]")} value={balanceServiceType} onChange={(e) => setBalanceServiceType(e.target.value)}><option value="">Все типы</option>{SERVICE_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select><input type="date" className={inputClass("lg:w-[160px]")} value={balanceDateFrom} onChange={(e) => setBalanceDateFrom(e.target.value)} /><input type="date" className={inputClass("lg:w-[160px]")} value={balanceDateTo} onChange={(e) => setBalanceDateTo(e.target.value)} /><ActionButton onClick={loadBalanceReport} type="button">Фильтр</ActionButton><ActionButton variant="primary" onClick={exportBalanceReport} type="button">Excel</ActionButton></div>}>
            <TableShell>
              <Table>
                <TableHead><tr><TH>№</TH><TH>Дата операции</TH><TH>Тип записи</TH><TH>Агент</TH><TH>Тип услуги</TH><TH>Направление</TH><TH>Name of traveller</TH><TH align="right">Продажа</TH><TH align="right">Оплата</TH><TH align="right">Возврат</TH><TH>Комментарий</TH><TH align="right">Баланс</TH></tr></TableHead>
                <tbody>
                  {balanceLoading || balanceReport.length === 0 ? <EmptyRow loading={balanceLoading} colSpan={12} /> : balanceReport.map((row, idx) => (
                    <tr key={row.row_key || `${row.entry_type}-${idx}`}>
                      <TD className="text-gray-500">{idx + 1}</TD>
                      <TD>{iso(row.txn_date)}</TD>
                      <TD><Badge className={badgeClassByLedgerType(row.entry_type)}>{ledgerTypeLabel(row.entry_type)}</Badge></TD>
                      <TD><div className="font-medium text-gray-900">{row.agent}</div></TD>
                      <TD>{row.service_type ? <Badge className={badgeClassByServiceType(row.service_type)}>{typeLabel(row.service_type)}</Badge> : "—"}</TD>
                      <TD className="max-w-[220px] whitespace-pre-wrap break-words">{row.direction || "—"}</TD>
                      <TD>{row.traveller_name || "—"}</TD>
                      <TD align="right">{Number(row.sale_amount || 0) ? money(row.sale_amount) : "0"}</TD>
                      <TD align="right">{Number(row.payment_amount || 0) ? money(row.payment_amount) : "0"}</TD>
                      <TD align="right">{Number(row.refund_amount || 0) ? money(row.refund_amount) : "0"}</TD>
                      <TD className="max-w-[260px] whitespace-pre-wrap break-words">{row.comment || "—"}</TD>
                      <TD align="right" className={`font-semibold ${amountClass(row.balance, "balance")}`}>{money(row.balance)}</TD>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableShell>
          </Card>
        </>
      )}
    </div>
  );
}
