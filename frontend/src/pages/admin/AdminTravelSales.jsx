// frontend/src/pages/admin/AdminTravelSales.jsx

import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

const SERVICE_TYPE_OPTIONS = [
  { value: "airticket", label: "Авиабилет" },
  { value: "railticket", label: "ЖД билет" },
  { value: "visa", label: "Виза" },
  { value: "tourpackage", label: "Турпакет" },
];

const SERVICE_TYPE_LABELS = Object.fromEntries(SERVICE_TYPE_OPTIONS.map((x) => [x.value, x.label]));

const AGENT_KIND_OPTIONS = [
  { value: "agent", label: "Агент продаж" },
  { value: "supplier", label: "Поставщик" },
  { value: "both", label: "Агент + поставщик" },
];

const PAYMENT_ENTRY_OPTIONS = [
  { value: "payment", label: "Оплата / перечисление поставщику" },
  { value: "refund", label: "Возврат от поставщика" },
];

function localTodayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const todayIso = localTodayIso();

const emptyAgentForm = {
  name: "",
  contact: "",
  address: "",
  agent_kind: "agent",
};

const emptySaleForm = {
  sale_date: todayIso,
  agent_id: "",
  supplier_agent_id: "",
  service_type: "airticket",
  direction: "",
  traveller_name: "",
  fare_amount: "",
  taxes_amount: "",
  commission_percent: "",
  sale_amount: "",
  vat_percent: "",
};

const emptyPaymentForm = {
  payment_date: todayIso,
  agent_id: "",
  entry_type: "payment",
  amount: "",
  comment: "",
};

const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

function numeric(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function calculateSaleFinance(form) {
  const fare = Math.max(0, numeric(form.fare_amount));
  const taxes = Math.max(0, numeric(form.taxes_amount));
  const commissionPercent = Math.max(0, numeric(form.commission_percent));
  const sale = Math.max(0, numeric(form.sale_amount));
  const vatPercent = Math.max(0, numeric(form.vat_percent));

  const commissionAmount = roundMoney((fare * commissionPercent) / 100);
  const netAmount = roundMoney(fare + taxes - commissionAmount);
  const baseWithoutVat = vatPercent > 0 ? roundMoney(sale / (1 + vatPercent / 100)) : sale;
  const markupAmount = roundMoney(Math.max(0, baseWithoutVat - netAmount));
  const vatAmount = roundMoney(Math.max(0, sale - netAmount - markupAmount));

  return {
    fare_amount: fare,
    taxes_amount: taxes,
    commission_percent: commissionPercent,
    commission_amount: commissionAmount,
    net_amount: netAmount,
    sale_amount: sale,
    vat_percent: vatPercent,
    vat_amount: vatAmount,
    markup_amount: markupAmount,
    margin: markupAmount,
  };
}

function money(v) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(v || 0));
}

function moneyCompact(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n / 1_000_000_000)} млрд`;
  if (abs >= 1_000_000) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n / 1_000_000)} млн`;
  if (abs >= 1_000) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n / 1_000)} тыс`;
  return money(n);
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

function typeLabel(v) {
  return SERVICE_TYPE_LABELS[v] || "—";
}

function agentKindLabel(v) {
  return AGENT_KIND_OPTIONS.find((x) => x.value === v)?.label || "Агент продаж";
}

function ledgerTypeLabel(v) {
  if (v === "supply") return "Поставка";
  if (v === "legacy_sale") return "Продажа (старая)";
  if (v === "payment") return "Оплата";
  if (v === "refund") return "Возврат";
  if (v === "payment_legacy") return "Оплата (старая)";
  return "—";
}

function badgeClassByServiceType(v) {
  if (v === "airticket") return "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200";
  if (v === "railticket") return "bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-200";
  if (v === "visa") return "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200";
  if (v === "tourpackage") return "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200";
  return "bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200";
}

function badgeClassByLedgerType(v) {
  if (v === "supply") return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
  if (v === "legacy_sale") return "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200";
  if (v === "payment") return "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200";
  if (v === "refund") return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  if (v === "payment_legacy") return "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200";
  return "bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200";
}

function balanceStatus(v) {
  const n = Number(v || 0);
  if (n > 0) {
    return { label: "ДОЛГ", cls: "bg-red-50 text-red-700 ring-red-200", rowCls: "bg-red-50/35 hover:bg-red-50/70" };
  }
  if (n < 0) {
    return { label: "ПЕРЕПЛАТА", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", rowCls: "bg-emerald-50/25 hover:bg-emerald-50/60" };
  }
  return { label: "ЗАКРЫТО", cls: "bg-gray-100 text-gray-600 ring-gray-200", rowCls: "" };
}

function inputClass(extra = "") {
  return `w-full rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-200 ${extra}`;
}

function clsTab(active) {
  return active
    ? "inline-flex items-center rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
    : "inline-flex items-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50";
}

function ActionButton({ children, variant = "default", className = "", ...props }) {
  const styles = {
    primary: "rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-black",
    default: "rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50",
    danger: "rounded-2xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50",
  };
  return <button className={`${styles[variant] || styles.default} ${className}`} {...props}>{children}</button>;
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

function Badge({ children, className = "", title = "" }) {
  return <span title={title} className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{children}</span>;
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

function TH({ children, align = "left", className = "" }) {
  return <th className={`whitespace-nowrap border-b border-gray-100 bg-gray-50 px-3 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${align === "right" ? "text-right" : "text-left"} ${className}`}>{children}</th>;
}

function TD({ children, align = "left", className = "" }) {
  return <td className={`px-3 py-3.5 align-top text-sm text-gray-700 ${align === "right" ? "text-right" : "text-left"} ${className}`}>{children}</td>;
}

function EmptyRow({ loading, colSpan }) {
  return (
    <tr>
      <td className="px-3 py-10 text-center text-sm text-gray-500" colSpan={colSpan}>{loading ? "Загрузка..." : "Нет данных"}</td>
    </tr>
  );
}

function exportToExcel(filename, rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([buffer], { type: "application/octet-stream" }), filename);
}

function sortByName(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => collator.compare(String(a.name || ""), String(b.name || "")));
}

function groupByDate(rows, dateKey) {
  const map = new Map();
  rows.forEach((row) => {
    const date = iso(row[dateKey]) || "Без даты";
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(row);
  });
  return Array.from(map.entries()).map(([date, items]) => ({ date, items })).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export default function AdminTravelSales() {
  const [tab, setTab] = useState("agents");
  const [agents, setAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentQuery, setAgentQuery] = useState("");
  const [agentForm, setAgentForm] = useState(emptyAgentForm);
  const [editingAgentId, setEditingAgentId] = useState(null);

  const [dailySales, setDailySales] = useState([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [saleForm, setSaleForm] = useState(emptySaleForm);
  const [editingSaleId, setEditingSaleId] = useState(null);
  const [dailyFilterAgentId, setDailyFilterAgentId] = useState("");
  const [dailyFilterSupplierId, setDailyFilterSupplierId] = useState("");
  const [dailyServiceType, setDailyServiceType] = useState("");
  const [dailyDateFrom, setDailyDateFrom] = useState("");
  const [dailyDateTo, setDailyDateTo] = useState("");

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
  const [salesSupplierId, setSalesSupplierId] = useState("");
  const [salesDateFrom, setSalesDateFrom] = useState("");
  const [salesDateTo, setSalesDateTo] = useState("");
  const [salesServiceType, setSalesServiceType] = useState("");

  const [balanceReport, setBalanceReport] = useState([]);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceAgentId, setBalanceAgentId] = useState("");
  const [balanceDateFrom, setBalanceDateFrom] = useState("");
  const [balanceDateTo, setBalanceDateTo] = useState("");
  const [balanceServiceType, setBalanceServiceType] = useState("");

  const sortedAgents = useMemo(() => sortByName(agents), [agents]);
  const salesAgents = useMemo(() => sortedAgents.filter((a) => ["agent", "both", ""].includes(String(a.agent_kind || "agent"))), [sortedAgents]);
  const suppliers = useMemo(() => sortedAgents.filter((a) => ["supplier", "both"].includes(String(a.agent_kind || "agent"))), [sortedAgents]);
  const finance = useMemo(() => calculateSaleFinance(saleForm), [saleForm]);

  const totals = useMemo(() => ({
    dailySale: dailySales.reduce((s, r) => s + Number(r.sale_amount || 0), 0),
    dailyNet: dailySales.reduce((s, r) => s + Number(r.net_amount || 0), 0),
    dailyCommission: dailySales.reduce((s, r) => s + Number(r.commission_amount || 0), 0),
    dailyMarkup: dailySales.reduce((s, r) => s + Number(r.markup_amount || 0), 0),
    reportSale: salesReport.reduce((s, r) => s + Number(r.sale_amount || 0), 0),
    reportNet: salesReport.reduce((s, r) => s + Number(r.net_amount || 0), 0),
    reportCommission: salesReport.reduce((s, r) => s + Number(r.commission_amount || 0), 0),
    reportMarkup: salesReport.reduce((s, r) => s + Number(r.markup_amount || r.margin || 0), 0),
    payments: payments.reduce((s, r) => s + (String(r.entry_type || "payment") === "payment" ? Number(r.amount || 0) : 0), 0),
    refunds: payments.reduce((s, r) => s + (String(r.entry_type || "payment") === "refund" ? Number(r.amount || 0) : 0), 0),
  }), [dailySales, salesReport, payments]);

  const totalBalance = useMemo(() => {
    const latestByAgent = new Map();
    [...balanceReport]
      .sort((a, b) => `${iso(a.txn_date)}-${a.row_key}`.localeCompare(`${iso(b.txn_date)}-${b.row_key}`))
      .forEach((r) => latestByAgent.set(r.agent_id, Number(r.balance || 0)));
    return Array.from(latestByAgent.values()).reduce((s, n) => s + n, 0);
  }, [balanceReport]);

  async function loadAgents() {
    try {
      setAgentsLoading(true);
      const q = new URLSearchParams();
      q.set("limit", "1000");
      if (agentQuery.trim()) q.set("q", agentQuery.trim());
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
      q.set("limit", "1000");
      if (dailyFilterAgentId) q.set("agent_id", dailyFilterAgentId);
      if (dailyFilterSupplierId) q.set("supplier_agent_id", dailyFilterSupplierId);
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
      q.set("limit", "1000");
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
      q.set("limit", "3000");
      if (salesAgentId) q.set("agent_id", salesAgentId);
      if (salesSupplierId) q.set("supplier_agent_id", salesSupplierId);
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
      q.set("limit", "5000");
      if (balanceAgentId) q.set("agent_id", balanceAgentId);
      if (balanceDateFrom) q.set("date_from", balanceDateFrom);
      if (balanceDateTo) q.set("date_to", balanceDateTo);
      if (balanceServiceType) q.set("service_type", balanceServiceType);
      const res = await apiGet(`/api/admin/travel-sales/reports/agent-balance?${q.toString()}`, "admin");
      setBalanceReport(Array.isArray(res?.rows) ? res.rows : []);
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось загрузить баланс");
    } finally {
      setBalanceLoading(false);
    }
  }

  useEffect(() => { loadAgents(); }, []);
  useEffect(() => { if (tab === "daily") loadDailySales(); }, [tab, dailyFilterAgentId, dailyFilterSupplierId, dailyDateFrom, dailyDateTo, dailyServiceType]);
  useEffect(() => { if (tab === "payments") loadPayments(); }, [tab, paymentsAgentId, paymentsEntryType, paymentsDateFrom, paymentsDateTo]);
  useEffect(() => { if (tab === "sales") loadSalesReport(); }, [tab, salesAgentId, salesSupplierId, salesDateFrom, salesDateTo, salesServiceType]);
  useEffect(() => { if (tab === "balance") loadBalanceReport(); }, [tab, balanceAgentId, balanceDateFrom, balanceDateTo, balanceServiceType]);

  async function handleSaveAgent(e) {
    e.preventDefault();
    const payload = {
      name: agentForm.name.trim(),
      contact: agentForm.contact.trim(),
      address: agentForm.address.trim(),
      agent_kind: agentForm.agent_kind || "agent",
    };
    if (!payload.name) return tError("Введите наименование");
    try {
      if (editingAgentId) {
        await apiPut(`/api/admin/travel-sales/agents/${editingAgentId}`, payload, "admin");
        tSuccess("Запись обновлена");
      } else {
        await apiPost("/api/admin/travel-sales/agents", payload, "admin");
        tSuccess("Запись добавлена");
      }
      setEditingAgentId(null);
      setAgentForm(emptyAgentForm);
      await loadAgents();
    } catch (e2) {
      console.error(e2);
      tError(e2?.message || "Ошибка сохранения");
    }
  }

  function startEditAgent(row) {
    setEditingAgentId(row.id);
    setAgentForm({
      name: row.name || "",
      contact: row.contact || "",
      address: row.address || "",
      agent_kind: row.agent_kind || "agent",
    });
    setTab("agents");
  }

  async function handleDeleteAgent(id) {
    if (!window.confirm("Удалить запись?")) return;
    try {
      await apiDelete(`/api/admin/travel-sales/agents/${id}`, "admin");
      tSuccess("Удалено");
      await loadAgents();
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось удалить");
    }
  }

  async function handleSaveSale(e) {
    e.preventDefault();
    const calculated = calculateSaleFinance(saleForm);
    const payload = {
      sale_date: saleForm.sale_date,
      agent_id: Number(saleForm.agent_id),
      supplier_agent_id: Number(saleForm.supplier_agent_id),
      service_type: saleForm.service_type,
      direction: saleForm.direction.trim(),
      traveller_name: saleForm.traveller_name.trim(),
      fare_amount: calculated.fare_amount,
      taxes_amount: calculated.taxes_amount,
      commission_percent: calculated.commission_percent,
      sale_amount: calculated.sale_amount,
      net_amount: calculated.net_amount,
      vat_percent: calculated.vat_percent,
    };
    if (!payload.sale_date) return tError("Укажи дату");
    if (!payload.agent_id) return tError("Выбери агента продаж");
    if (!payload.supplier_agent_id) return tError("Выбери поставщика");
    if (!payload.service_type) return tError("Выбери тип услуги");
    if (!payload.direction) return tError("Укажи направление");
    if (payload.sale_amount < 0) return tError("Сумма продажи не может быть отрицательной");

    try {
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
      sale_date: iso(row.sale_date) || todayIso,
      agent_id: String(row.agent_id || ""),
      supplier_agent_id: String(row.supplier_agent_id || ""),
      service_type: row.service_type || "airticket",
      direction: row.direction || "",
      traveller_name: row.traveller_name || "",
      fare_amount: row.fare_amount ?? "",
      taxes_amount: row.taxes_amount ?? "",
      commission_percent: row.commission_percent ?? "",
      sale_amount: row.sale_amount ?? "",
      vat_percent: row.vat_percent ?? "",
    });
    setTab("daily");
  }

  async function handleDeleteSale(id) {
    if (!window.confirm("Удалить продажу?")) return;
    try {
      await apiDelete(`/api/admin/travel-sales/daily-sales/${id}`, "admin");
      tSuccess("Продажа удалена");
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
    const payload = {
      payment_date: paymentForm.payment_date,
      agent_id: Number(paymentForm.agent_id),
      entry_type: paymentForm.entry_type || "payment",
      amount: Number(paymentForm.amount || 0),
      comment: paymentForm.comment.trim(),
    };
    if (!payload.agent_id) return tError("Выбери агента/поставщика");
    if (!payload.payment_date) return tError("Укажи дату");
    if (payload.amount < 0) return tError("Сумма не может быть отрицательной");
    try {
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
      amount: row.amount ?? "",
      comment: row.comment || "",
    });
    setTab("payments");
  }

  async function handleDeletePayment(id) {
    if (!window.confirm("Удалить оплату?")) return;
    try {
      await apiDelete(`/api/admin/travel-sales/payments/${id}`, "admin");
      tSuccess("Оплата удалена");
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
      Агент: row.agent || "",
      Поставщик: row.supplier_agent || "",
      "Тип услуги": typeLabel(row.service_type),
      Направление: row.direction || "",
      "Name of traveller": row.traveller_name || "",
      Тариф: Number(row.fare_amount || 0),
      Таксы: Number(row.taxes_amount || 0),
      "Комиссия %": Number(row.commission_percent || 0),
      "Комиссия сумма": Number(row.commission_amount || 0),
      "Сумма продажи": Number(row.sale_amount || 0),
      "Сумма нетто": Number(row.net_amount || 0),
      "НДС %": Number(row.vat_percent || 0),
      "НДС сумма": Number(row.vat_amount || 0),
      Наценка: Number(row.markup_amount || row.margin || 0),
    })));
  }

  function exportBalanceReport() {
    if (!balanceReport.length) return tError("Нет данных для экспорта");
    exportToExcel(`travel-agents-balance-${new Date().toISOString().slice(0, 10)}.xlsx`, balanceReport.map((row, idx) => ({
      "№": idx + 1,
      "Дата операции": iso(row.txn_date),
      "Тип записи": ledgerTypeLabel(row.entry_type),
      "Агент/поставщик": row.agent || "",
      "Тип услуги": typeLabel(row.service_type),
      Направление: row.direction || "",
      "Name of traveller": row.traveller_name || "",
      Тариф: Number(row.fare_amount || 0),
      Таксы: Number(row.taxes_amount || 0),
      "Комиссия сумма": Number(row.commission_amount || 0),
      Поставка: Number(row.supply_amount || 0),
      Оплата: Number(row.payment_amount || 0),
      Возврат: Number(row.refund_amount || 0),
      Баланс: Number(row.balance || 0),
      Комментарий: row.comment || "",
    })));
  }

  const dailyGroups = useMemo(() => groupByDate(dailySales, "sale_date"), [dailySales]);
  const salesGroups = useMemo(() => groupByDate(salesReport, "sale_date"), [salesReport]);
  const balanceGroups = useMemo(() => groupByDate(balanceReport, "txn_date"), [balanceReport]);
  const paymentGroups = useMemo(() => groupByDate(payments, "payment_date"), [payments]);

  const resetSaleVisible = editingSaleId || Object.entries(saleForm).some(([k, v]) => k !== "sale_date" && k !== "service_type" && String(v || "").trim());

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setTab("agents")} className={clsTab(tab === "agents")}>Все агенты</button>
          <button type="button" onClick={() => setTab("daily")} className={clsTab(tab === "daily")}>Дневная продажа</button>
          <button type="button" onClick={() => setTab("payments")} className={clsTab(tab === "payments")}>Оплата / перечисление</button>
          <button type="button" onClick={() => setTab("sales")} className={clsTab(tab === "sales")}>Отчет продаж</button>
          <button type="button" onClick={() => setTab("balance")} className={clsTab(tab === "balance")}>Баланс агентов</button>
        </div>
      </div>

      {tab === "agents" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Всего записей" value={String(agents.length)} hint="Агенты и поставщики" accent="blue" />
            <StatCard title="Поставщиков" value={String(suppliers.length)} hint="agent_kind = supplier/both" accent="emerald" />
            <StatCard title="Агентов продаж" value={String(salesAgents.length)} hint="agent_kind = agent/both" accent="amber" />
            <StatCard title="Режим" value={editingAgentId ? "Редактирование" : "Новая запись"} hint="Справочник Travel Finance" accent="violet" />
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card title={editingAgentId ? "Редактировать запись" : "Добавить агента / поставщика"} subtitle="Один справочник, но с разными ролями">
              <form onSubmit={handleSaveAgent} className="space-y-4">
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Наименование</label><input className={inputClass()} value={agentForm.name} onChange={(e) => setAgentForm((p) => ({ ...p, name: e.target.value }))} /></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Роль</label><select className={inputClass()} value={agentForm.agent_kind} onChange={(e) => setAgentForm((p) => ({ ...p, agent_kind: e.target.value }))}>{AGENT_KIND_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Контакт</label><input className={inputClass()} value={agentForm.contact} onChange={(e) => setAgentForm((p) => ({ ...p, contact: e.target.value }))} /></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Адрес</label><input className={inputClass()} value={agentForm.address} onChange={(e) => setAgentForm((p) => ({ ...p, address: e.target.value }))} /></div>
                <div className="flex flex-wrap gap-2"><ActionButton type="submit" variant="primary">{editingAgentId ? "Сохранить" : "Добавить"}</ActionButton>{editingAgentId ? <ActionButton type="button" onClick={() => { setEditingAgentId(null); setAgentForm(emptyAgentForm); }}>Сбросить</ActionButton> : null}</div>
              </form>
            </Card>
            <div className="xl:col-span-2">
              <Card title="Справочник" subtitle="Здесь задается, кто может быть агентом продаж, а кто поставщиком" right={<div className="flex gap-2"><input className={inputClass("w-[260px]")} placeholder="Поиск" value={agentQuery} onChange={(e) => setAgentQuery(e.target.value)} /><ActionButton type="button" onClick={loadAgents}>Поиск</ActionButton></div>}>
                <TableShell><Table><thead><tr><TH>№</TH><TH>Наименование</TH><TH>Роль</TH><TH>Контакт</TH><TH>Адрес</TH><TH>Действия</TH></tr></thead><tbody>
                  {agentsLoading || sortedAgents.length === 0 ? <EmptyRow loading={agentsLoading} colSpan={6} /> : sortedAgents.map((row, idx) => (
                    <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/70">
                      <TD>{idx + 1}</TD><TD><b>{row.name}</b></TD><TD>{agentKindLabel(row.agent_kind)}</TD><TD>{row.contact || "—"}</TD><TD>{row.address || "—"}</TD><TD><div className="flex gap-3"><button type="button" onClick={() => startEditAgent(row)} className="text-blue-600">Изменить</button><button type="button" onClick={() => handleDeleteAgent(row.id)} className="text-red-500">Удалить</button></div></TD>
                    </tr>
                  ))}
                </tbody></Table></TableShell>
              </Card>
            </div>
          </div>
        </>
      )}

      {tab === "daily" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Записей" value={String(dailySales.length)} hint="По текущим фильтрам" accent="blue" />
            <StatCard title="Сумма продаж" value={money(totals.dailySale)} hint={`≈ ${moneyCompact(totals.dailySale)}`} accent="emerald" />
            <StatCard title="Нетто / поставка" value={money(totals.dailyNet)} hint={`≈ ${moneyCompact(totals.dailyNet)}`} accent="amber" />
            <StatCard title="Комиссия поставщиков" value={money(totals.dailyCommission)} hint={`Наценка: ${money(totals.dailyMarkup)}`} accent="violet" />
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card title={editingSaleId ? "Редактировать продажу" : "Добавить продажу"} subtitle="Тариф + таксы - комиссия = нетто поставщика">
              <form onSubmit={handleSaveSale} className="space-y-4">
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Дата</label><input type="date" className={inputClass()} value={saleForm.sale_date} onChange={(e) => setSaleForm((p) => ({ ...p, sale_date: e.target.value }))} /></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Агент продаж</label><select className={inputClass()} value={saleForm.agent_id} onChange={(e) => setSaleForm((p) => ({ ...p, agent_id: e.target.value }))}><option value="">Выберите агента</option>{salesAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Поставщик</label><select className={inputClass()} value={saleForm.supplier_agent_id} onChange={(e) => setSaleForm((p) => ({ ...p, supplier_agent_id: e.target.value }))}><option value="">Выберите поставщика</option>{suppliers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Тип услуги</label><select className={inputClass()} value={saleForm.service_type} onChange={(e) => setSaleForm((p) => ({ ...p, service_type: e.target.value }))}>{SERVICE_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Направление</label><input className={inputClass()} value={saleForm.direction} onChange={(e) => setSaleForm((p) => ({ ...p, direction: e.target.value }))} placeholder="Например: TAS / IST / TAS" /></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Name of traveller</label><input className={inputClass()} value={saleForm.traveller_name} onChange={(e) => setSaleForm((p) => ({ ...p, traveller_name: e.target.value }))} placeholder="Например: Ali Valiyev" /></div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Тариф</label><input type="number" className={inputClass()} value={saleForm.fare_amount} onChange={(e) => setSaleForm((p) => ({ ...p, fare_amount: e.target.value }))} placeholder="0" /></div>
                  <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Таксы</label><input type="number" className={inputClass()} value={saleForm.taxes_amount} onChange={(e) => setSaleForm((p) => ({ ...p, taxes_amount: e.target.value }))} placeholder="0" /></div>
                </div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Комиссия % от тарифа</label><input type="number" className={inputClass()} value={saleForm.commission_percent} onChange={(e) => setSaleForm((p) => ({ ...p, commission_percent: e.target.value }))} placeholder="Например: 5" /></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Сумма продажи</label><input type="number" className={inputClass()} value={saleForm.sale_amount} onChange={(e) => setSaleForm((p) => ({ ...p, sale_amount: e.target.value }))} placeholder="0" /></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">НДС %</label><input type="number" className={inputClass()} value={saleForm.vat_percent} onChange={(e) => setSaleForm((p) => ({ ...p, vat_percent: e.target.value }))} placeholder="0" /></div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div className="grid grid-cols-2 gap-3">
                    <div><div className="text-xs text-slate-500">Комиссия сумма авто</div><b className="text-slate-900">{money(finance.commission_amount)}</b></div>
                    <div><div className="text-xs text-slate-500">Нетто / поставка авто</div><b className="text-slate-900">{money(finance.net_amount)}</b></div>
                    <div><div className="text-xs text-slate-500">НДС сумма авто</div><b className="text-slate-900">{money(finance.vat_amount)}</b></div>
                    <div><div className="text-xs text-slate-500">Наценка авто</div><b className="text-emerald-700">{money(finance.markup_amount)}</b></div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">Формулы: комиссия = тариф × % / 100. Нетто = тариф + таксы − комиссия. Наценка считается из суммы продажи без НДС.</p>
                </div>
                <div className="flex flex-wrap gap-2"><ActionButton type="submit" variant="primary">{editingSaleId ? "Сохранить" : "Добавить"}</ActionButton>{resetSaleVisible ? <ActionButton type="button" onClick={() => { setEditingSaleId(null); setSaleForm(emptySaleForm); }}>Сбросить</ActionButton> : null}</div>
              </form>
            </Card>

            <div className="xl:col-span-2">
              <Card title="Список продаж" subtitle="Поставщик фиксируется сразу и попадает в баланс" right={<div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end"><select className={inputClass("lg:w-[170px]")} value={dailyFilterAgentId} onChange={(e) => setDailyFilterAgentId(e.target.value)}><option value="">Все агенты</option>{salesAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className={inputClass("lg:w-[190px]")} value={dailyFilterSupplierId} onChange={(e) => setDailyFilterSupplierId(e.target.value)}><option value="">Все поставщики</option>{suppliers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className={inputClass("lg:w-[150px]")} value={dailyServiceType} onChange={(e) => setDailyServiceType(e.target.value)}><option value="">Все типы</option>{SERVICE_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select><input type="date" className={inputClass("lg:w-[150px]")} value={dailyDateFrom} onChange={(e) => setDailyDateFrom(e.target.value)} /><input type="date" className={inputClass("lg:w-[150px]")} value={dailyDateTo} onChange={(e) => setDailyDateTo(e.target.value)} /><ActionButton onClick={loadDailySales} type="button">Фильтр</ActionButton></div>}>
                <TableShell><Table><thead><tr><TH>№</TH><TH>Дата</TH><TH>Агент</TH><TH>Поставщик</TH><TH>Тип</TH><TH>Направление</TH><TH>Traveller</TH><TH align="right">Тариф</TH><TH align="right">Таксы</TH><TH align="right">Комиссия</TH><TH align="right">Продажа</TH><TH align="right">Нетто</TH><TH align="right">НДС</TH><TH align="right">Наценка</TH><TH>Действия</TH></tr></thead><tbody>
                  {dailyLoading || dailySales.length === 0 ? <EmptyRow loading={dailyLoading} colSpan={15} /> : dailyGroups.flatMap((group) => {
                    const header = <tr key={`daily-${group.date}`}><td colSpan={15} className="px-3 py-3"><div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><b>{group.date}</b><span className="ml-3 text-xs text-slate-500">Продаж: {group.items.length}</span><span className="ml-3 text-xs font-semibold text-slate-700">Сумма: {money(group.items.reduce((s, r) => s + Number(r.sale_amount || 0), 0))}</span><span className="ml-3 text-xs font-semibold text-emerald-700">Наценка: {money(group.items.reduce((s, r) => s + Number(r.markup_amount || 0), 0))}</span></div></td></tr>;
                    const rows = group.items.map((row, idx) => <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/70"><TD>{idx + 1}</TD><TD>{iso(row.sale_date)}</TD><TD><b>{row.agent_name}</b></TD><TD>{row.supplier_agent_name || "—"}</TD><TD><Badge className={badgeClassByServiceType(row.service_type)}>{typeLabel(row.service_type)}</Badge></TD><TD>{row.direction || "—"}</TD><TD>{row.traveller_name || "—"}</TD><TD align="right">{money(row.fare_amount)}</TD><TD align="right">{money(row.taxes_amount)}</TD><TD align="right">{money(row.commission_amount)}</TD><TD align="right"><b>{money(row.sale_amount)}</b></TD><TD align="right"><b>{money(row.net_amount)}</b></TD><TD align="right">{money(row.vat_amount)}</TD><TD align="right" className="font-semibold text-emerald-700">{money(row.markup_amount)}</TD><TD><div className="flex gap-2"><ActionButton type="button" onClick={() => startEditSale(row)}>Изменить</ActionButton><ActionButton type="button" variant="danger" onClick={() => handleDeleteSale(row.id)}>Удалить</ActionButton></div></TD></tr>);
                    return [header, ...rows];
                  })}
                </tbody></Table></TableShell>
              </Card>
            </div>
          </div>
        </>
      )}

      {tab === "payments" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Оплаты" value={money(totals.payments)} hint={`≈ ${moneyCompact(totals.payments)}`} accent="blue" />
            <StatCard title="Возвраты" value={money(totals.refunds)} hint={`≈ ${moneyCompact(totals.refunds)}`} accent="amber" />
            <StatCard title="Чистый эффект" value={money(totals.payments - totals.refunds)} hint="Оплаты минус возвраты" accent="emerald" />
            <StatCard title="Записей" value={String(payments.length)} hint="По фильтрам" accent="violet" />
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card title={editingPaymentId ? "Редактировать оплату" : "Добавить оплату"} subtitle="Здесь фиксируются реальные перечисления поставщикам">
              <form onSubmit={handleSavePayment} className="space-y-4">
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Дата</label><input type="date" className={inputClass()} value={paymentForm.payment_date} onChange={(e) => setPaymentForm((p) => ({ ...p, payment_date: e.target.value }))} /></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Агент</label><select className={inputClass()} value={paymentForm.agent_id} onChange={(e) => setPaymentForm((p) => ({ ...p, agent_id: e.target.value }))}><option value="">Выберите</option>{sortedAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Тип записи</label><select className={inputClass()} value={paymentForm.entry_type} onChange={(e) => setPaymentForm((p) => ({ ...p, entry_type: e.target.value }))}>{PAYMENT_ENTRY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Сумма</label><input type="number" className={inputClass()} value={paymentForm.amount} onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))} /></div>
                <div><label className="mb-1.5 block text-sm font-medium text-gray-700">Комментарий</label><textarea className={inputClass("min-h-[100px] resize-y")} value={paymentForm.comment} onChange={(e) => setPaymentForm((p) => ({ ...p, comment: e.target.value }))} /></div>
                <div className="flex gap-2"><ActionButton type="submit" variant="primary">{editingPaymentId ? "Сохранить" : "Добавить"}</ActionButton>{editingPaymentId ? <ActionButton type="button" onClick={() => { setEditingPaymentId(null); setPaymentForm(emptyPaymentForm); }}>Сбросить</ActionButton> : null}</div>
              </form>
            </Card>
            <div className="xl:col-span-2">
              <Card title="Список оплат" subtitle="Оплаты уменьшают баланс поставщика" right={<div className="flex flex-wrap gap-2"><select className={inputClass("w-[190px]")} value={paymentsAgentId} onChange={(e) => setPaymentsAgentId(e.target.value)}><option value="">Все</option>{sortedAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className={inputClass("w-[170px]")} value={paymentsEntryType} onChange={(e) => setPaymentsEntryType(e.target.value)}><option value="">Все типы</option>{PAYMENT_ENTRY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select><input type="date" className={inputClass("w-[150px]")} value={paymentsDateFrom} onChange={(e) => setPaymentsDateFrom(e.target.value)} /><input type="date" className={inputClass("w-[150px]")} value={paymentsDateTo} onChange={(e) => setPaymentsDateTo(e.target.value)} /><ActionButton type="button" onClick={loadPayments}>Фильтр</ActionButton></div>}>
                <TableShell><Table><thead><tr><TH>№</TH><TH>Дата</TH><TH>Агент</TH><TH>Тип</TH><TH align="right">Сумма</TH><TH>Комментарий</TH><TH>Действия</TH></tr></thead><tbody>{paymentsLoading || payments.length === 0 ? <EmptyRow loading={paymentsLoading} colSpan={7} /> : paymentGroups.flatMap((group) => [<tr key={`pay-${group.date}`}><td colSpan={7} className="px-3 py-3"><div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><b>{group.date}</b><span className="ml-3 text-xs text-slate-500">Операций: {group.items.length}</span></div></td></tr>, ...group.items.map((row, idx) => <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/70"><TD>{idx + 1}</TD><TD>{iso(row.payment_date)}</TD><TD><b>{row.agent_name}</b></TD><TD><Badge className={badgeClassByLedgerType(row.entry_type)}>{ledgerTypeLabel(row.entry_type)}</Badge></TD><TD align="right"><b>{money(row.amount)}</b></TD><TD>{row.comment || "—"}</TD><TD><div className="flex gap-2"><ActionButton type="button" onClick={() => startEditPayment(row)}>Изменить</ActionButton><ActionButton type="button" variant="danger" onClick={() => handleDeletePayment(row.id)}>Удалить</ActionButton></div></TD></tr>)])}</tbody></Table></TableShell>
              </Card>
            </div>
          </div>
        </>
      )}

      {tab === "sales" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Сумма продаж" value={money(totals.reportSale)} hint={`≈ ${moneyCompact(totals.reportSale)}`} accent="blue" />
            <StatCard title="Нетто / поставка" value={money(totals.reportNet)} hint={`≈ ${moneyCompact(totals.reportNet)}`} accent="amber" />
            <StatCard title="Комиссия поставщиков" value={money(totals.reportCommission)} hint={`≈ ${moneyCompact(totals.reportCommission)}`} accent="violet" />
            <StatCard title="Наценка" value={money(totals.reportMarkup)} hint={`≈ ${moneyCompact(totals.reportMarkup)}`} accent="emerald" />
          </div>
          <Card title="Отчет продаж" subtitle="Для сверки с поставщиками и внутренней маржи" right={<div className="flex flex-wrap gap-2"><select className={inputClass("w-[170px]")} value={salesAgentId} onChange={(e) => setSalesAgentId(e.target.value)}><option value="">Все агенты</option>{salesAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className={inputClass("w-[190px]")} value={salesSupplierId} onChange={(e) => setSalesSupplierId(e.target.value)}><option value="">Все поставщики</option>{suppliers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className={inputClass("w-[150px]")} value={salesServiceType} onChange={(e) => setSalesServiceType(e.target.value)}><option value="">Все типы</option>{SERVICE_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select><input type="date" className={inputClass("w-[150px]")} value={salesDateFrom} onChange={(e) => setSalesDateFrom(e.target.value)} /><input type="date" className={inputClass("w-[150px]")} value={salesDateTo} onChange={(e) => setSalesDateTo(e.target.value)} /><ActionButton type="button" onClick={loadSalesReport}>Фильтр</ActionButton><ActionButton type="button" variant="primary" onClick={exportSalesReport}>Excel</ActionButton></div>}>
            <TableShell><Table><thead><tr><TH>№</TH><TH>Дата</TH><TH>Агент</TH><TH>Поставщик</TH><TH>Тип</TH><TH>Направление</TH><TH>Traveller</TH><TH align="right">Тариф</TH><TH align="right">Таксы</TH><TH align="right">Комиссия</TH><TH align="right">Продажа</TH><TH align="right">Нетто</TH><TH align="right">НДС</TH><TH align="right">Наценка</TH></tr></thead><tbody>{salesReportLoading || salesReport.length === 0 ? <EmptyRow loading={salesReportLoading} colSpan={14} /> : salesGroups.flatMap((group) => [<tr key={`rep-${group.date}`}><td colSpan={14} className="px-3 py-3"><div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><b>{group.date}</b><span className="ml-3 text-xs text-slate-500">Продаж: {group.items.length}</span><span className="ml-3 text-xs font-semibold">Продажа: {money(group.items.reduce((s, r) => s + Number(r.sale_amount || 0), 0))}</span><span className="ml-3 text-xs font-semibold text-emerald-700">Наценка: {money(group.items.reduce((s, r) => s + Number(r.markup_amount || r.margin || 0), 0))}</span></div></td></tr>, ...group.items.map((row, idx) => <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50/70"><TD>{idx + 1}</TD><TD>{iso(row.sale_date)}</TD><TD><b>{row.agent}</b></TD><TD>{row.supplier_agent || "—"}</TD><TD><Badge className={badgeClassByServiceType(row.service_type)}>{typeLabel(row.service_type)}</Badge></TD><TD>{row.direction || "—"}</TD><TD>{row.traveller_name || "—"}</TD><TD align="right">{money(row.fare_amount)}</TD><TD align="right">{money(row.taxes_amount)}</TD><TD align="right">{money(row.commission_amount)}</TD><TD align="right"><b>{money(row.sale_amount)}</b></TD><TD align="right"><b>{money(row.net_amount)}</b></TD><TD align="right">{money(row.vat_amount)}</TD><TD align="right" className="font-semibold text-emerald-700">{money(row.markup_amount || row.margin)}</TD></tr>)])}</tbody></Table></TableShell>
          </Card>
        </>
      )}

      {tab === "balance" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Общий баланс" value={money(totalBalance)} hint={`≈ ${moneyCompact(totalBalance)}`} accent="rose" />
            <StatCard title="Строк" value={String(balanceReport.length)} hint="По текущим фильтрам" accent="blue" />
            <StatCard title="Поставки" value={money(balanceReport.reduce((s, r) => s + Number(r.supply_amount || 0), 0))} hint="Нетто из дневных продаж" accent="emerald" />
            <StatCard title="Оплаты + возвраты" value={money(balanceReport.reduce((s, r) => s + Number(r.payment_amount || 0) + Number(r.refund_amount || 0), 0))} hint="Реальные движения денег" accent="amber" />
          </div>
          <Card title="Баланс агентов" subtitle="Поставки приходят из дневной продажи, оплаты — из перечислений" right={<div className="flex flex-wrap gap-2"><select className={inputClass("w-[190px]")} value={balanceAgentId} onChange={(e) => setBalanceAgentId(e.target.value)}><option value="">Все агенты</option>{sortedAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select><select className={inputClass("w-[150px]")} value={balanceServiceType} onChange={(e) => setBalanceServiceType(e.target.value)}><option value="">Все типы</option>{SERVICE_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select><input type="date" className={inputClass("w-[150px]")} value={balanceDateFrom} onChange={(e) => setBalanceDateFrom(e.target.value)} /><input type="date" className={inputClass("w-[150px]")} value={balanceDateTo} onChange={(e) => setBalanceDateTo(e.target.value)} /><ActionButton type="button" onClick={loadBalanceReport}>Фильтр</ActionButton><ActionButton type="button" variant="primary" onClick={exportBalanceReport}>Excel</ActionButton></div>}>
            <TableShell><Table><thead><tr><TH>№</TH><TH>Дата</TH><TH>Тип</TH><TH>Агент</TH><TH>Тип услуги</TH><TH>Направление</TH><TH>Traveller</TH><TH align="right">Тариф</TH><TH align="right">Таксы</TH><TH align="right">Комиссия</TH><TH align="right">Поставка</TH><TH align="right">Оплата</TH><TH align="right">Возврат</TH><TH>Комментарий</TH><TH align="right">Баланс</TH></tr></thead><tbody>{balanceLoading || balanceReport.length === 0 ? <EmptyRow loading={balanceLoading} colSpan={15} /> : balanceGroups.flatMap((group) => [<tr key={`bal-${group.date}`}><td colSpan={15} className="px-3 py-3"><div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><b>{group.date}</b><span className="ml-3 text-xs text-slate-500">Операций: {group.items.length}</span><span className="ml-3 text-xs font-semibold text-emerald-700">Поставки: {money(group.items.reduce((s, r) => s + Number(r.supply_amount || 0), 0))}</span><span className="ml-3 text-xs font-semibold text-sky-700">Оплаты: {money(group.items.reduce((s, r) => s + Number(r.payment_amount || 0), 0))}</span></div></td></tr>, ...group.items.map((row, idx) => { const status = balanceStatus(row.balance); return <tr key={row.row_key || `${row.entry_type}-${idx}`} className={`border-b border-gray-100 ${status.rowCls}`}><TD>{idx + 1}</TD><TD>{iso(row.txn_date)}</TD><TD><Badge className={badgeClassByLedgerType(row.entry_type)}>{ledgerTypeLabel(row.entry_type)}</Badge></TD><TD><b>{row.agent}</b></TD><TD>{row.service_type ? <Badge className={badgeClassByServiceType(row.service_type)}>{typeLabel(row.service_type)}</Badge> : "—"}</TD><TD>{row.direction || "—"}</TD><TD>{row.traveller_name || "—"}</TD><TD align="right">{money(row.fare_amount)}</TD><TD align="right">{money(row.taxes_amount)}</TD><TD align="right">{money(row.commission_amount)}</TD><TD align="right"><b>{money(row.supply_amount)}</b></TD><TD align="right">{money(row.payment_amount)}</TD><TD align="right">{money(row.refund_amount)}</TD><TD>{row.comment || "—"}</TD><TD align="right"><div className="flex items-center justify-end gap-2"><b className={Number(row.balance || 0) > 0 ? "text-red-600" : Number(row.balance || 0) < 0 ? "text-emerald-700" : "text-gray-900"}>{money(row.balance)}</b><Badge className={`ring-1 ${status.cls}`}>{status.label}</Badge></div></TD></tr>; })])}</tbody></Table></TableShell>
          </Card>
        </>
      )}
    </div>
  );
}
