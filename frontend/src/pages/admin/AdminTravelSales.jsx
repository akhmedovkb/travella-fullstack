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
    ? "group inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
    : "group inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition";
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

function badgeClassByLedgerType(v) {
  if (v === "sale") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200";
  }
  if (v === "payment") {
    return "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200";
  }
  if (v === "refund") {
    return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  }
  if (v === "payment_legacy") {
    return "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200";
  }
  return "bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200";
}

function badgeClassByServiceType(v) {
  if (v === "airticket") {
    return "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200";
  }
  if (v === "visa") {
    return "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200";
  }
  if (v === "tourpackage") {
    return "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200";
  }
  return "bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200";
}

function amountClass(v, mode = "default") {
  const n = Number(v || 0);
  if (mode === "balance") {
    return n > 0 ? "text-red-600" : n < 0 ? "text-emerald-700" : "text-gray-900";
  }
  if (n > 0) return "text-gray-900";
  if (n < 0) return "text-red-600";
  return "text-gray-500";
}

function IconWrap({ tone = "slate", children }) {
  const toneMap = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    emerald: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    blue: "bg-blue-100 text-blue-700 ring-blue-200",
    amber: "bg-amber-100 text-amber-700 ring-amber-200",
    violet: "bg-violet-100 text-violet-700 ring-violet-200",
    rose: "bg-rose-100 text-rose-700 ring-rose-200",
  };
  return (
    <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ring-1 ring-inset ${toneMap[tone] || toneMap.slate}`}>
      {children}
    </span>
  );
}

function SvgIcon({ kind = "wallet", className = "h-5 w-5" }) {
  const common = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  if (kind === "wallet") return <svg {...common}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1H5.5A2.5 2.5 0 0 0 3 10.5v-3Z"/><path d="M3 10.5A2.5 2.5 0 0 1 5.5 8H20a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5v-6Z"/><path d="M16 14h2"/></svg>;
  if (kind === "doc") return <svg {...common}><path d="M8 3.5h6l4 4V20a1 1 0 0 1-1 1H8a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z"/><path d="M14 3.5V8h4"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>;
  if (kind === "trend") return <svg {...common}><path d="M4 16 10 10l4 4 6-8"/><path d="M20 6h-5"/><path d="M20 6v5"/></svg>;
  if (kind === "coin") return <svg {...common}><path d="M12 3c4.418 0 8 1.79 8 4s-3.582 4-8 4-8-1.79-8-4 3.582-4 8-4Z"/><path d="M4 7v5c0 2.21 3.582 4 8 4s8-1.79 8-4V7"/><path d="M4 12v5c0 2.21 3.582 4 8 4s8-1.79 8-4v-5"/></svg>;
  if (kind === "percent") return <svg {...common}><path d="M19 5 5 19"/><path d="M7.5 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M16.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>;
  if (kind === "users") return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  if (kind === "calendar") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 10h18"/></svg>;
  if (kind === "credit") return <svg {...common}><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19"/><path d="M7 15h2"/></svg>;
  if (kind === "chart") return <svg {...common}><path d="M4 19V5"/><path d="M10 19v-8"/><path d="M16 19V9"/><path d="M22 19V3"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/></svg>;
}

function tabIcon(name) {
  if (name === "agents") return "users";
  if (name === "daily") return "calendar";
  if (name === "payments") return "credit";
  if (name === "sales") return "chart";
  if (name === "balance") return "wallet";
  return "doc";
}

function Card({ title, subtitle, children, right }) {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white shadow-[0_10px_35px_rgba(17,24,39,0.05)]">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-gray-900">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
        </div>
        {right || null}
      </div>
      <div className="p-5 md:p-6">{children}</div>
    </section>
  );
}

function StatCard({ title, value, hint, tone = "slate", icon = "wallet" }) {
  const toneMap = {
    slate: "from-slate-50 via-white to-white border-slate-200",
    emerald: "from-emerald-50 via-white to-white border-emerald-200",
    blue: "from-blue-50 via-white to-white border-blue-200",
    amber: "from-amber-50 via-white to-white border-amber-200",
    violet: "from-violet-50 via-white to-white border-violet-200",
    rose: "from-rose-50 via-white to-white border-rose-200",
  };

  return (
    <div className={`rounded-3xl border bg-gradient-to-br p-4 shadow-sm ${toneMap[tone] || toneMap.slate}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-500">{title}</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-gray-900">{value}</div>
          {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
        </div>
        <IconWrap tone={tone}>
          <SvgIcon kind={icon} />
        </IconWrap>
      </div>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint ? <div className="text-xs text-gray-400">{hint}</div> : null}
    </div>
  );
}

function inputClassName(extra = "") {
  return `w-full rounded-2xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-200 ${extra}`;
}

function ActionButton({ children, variant = "default", className = "", ...props }) {
  const variants = {
    primary:
      "bg-gray-900 text-white border border-gray-900 hover:bg-black shadow-sm",
    default:
      "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50",
    danger:
      "bg-white text-red-600 border border-red-200 hover:bg-red-50",
    ghost:
      "bg-gray-50 text-gray-700 border border-gray-100 hover:bg-gray-100",
  };

  return (
    <button
      className={`inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
        variants[variant] || variants.default
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function Badge({ children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

function TableShell({ children }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white">
      <div className="max-w-full overflow-x-auto">{children}</div>
    </div>
  );
}

function Table({ children }) {
  return <table className="min-w-full text-sm">{children}</table>;
}


function MiniBar({ label, value, max, tone = "blue" }) {
  const widths = max > 0 ? Math.max(6, Math.round((Number(value || 0) / max) * 100)) : 0;
  const toneMap = {
    blue: "bg-blue-500",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    rose: "bg-rose-500",
    violet: "bg-violet-500",
    slate: "bg-slate-500",
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="truncate text-gray-600">{label}</span>
        <span className="whitespace-nowrap font-semibold text-gray-900">{money(value)}</span>
      </div>
      <div className="h-2.5 rounded-full bg-gray-100">
        <div
          className={`h-2.5 rounded-full ${toneMap[tone] || toneMap.blue}`}
          style={{ width: `${widths}%` }}
        />
      </div>
    </div>
  );
}

function MiniTrend({ data = [], lines = [] }) {
  const width = 560;
  const height = 220;
  const pad = 24;
  const values = [];
  data.forEach((item) => {
    lines.forEach((line) => values.push(Number(item?.[line.key] || 0)));
  });
  const max = Math.max(...values, 1);
  const stepX = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;

  function buildPath(key) {
    return data
      .map((item, idx) => {
        const x = pad + idx * stepX;
        const y = height - pad - ((Number(item?.[key] || 0) / max) * (height - pad * 2));
        return `${idx === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-xs font-medium text-gray-500">
        {lines.map((line) => (
          <div key={line.key} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: line.color }} />
            <span>{line.label}</span>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-gradient-to-b from-white to-gray-50 px-3 py-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full">
          {[0, 0.25, 0.5, 0.75, 1].map((tick, idx) => {
            const y = height - pad - tick * (height - pad * 2);
            return <line key={idx} x1={pad} x2={width - pad} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />;
          })}
          {lines.map((line) => (
            <path
              key={line.key}
              d={buildPath(line.key)}
              fill="none"
              stroke={line.color}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {data.map((item, idx) => {
            const x = pad + idx * stepX;
            return (
              <text key={idx} x={x} y={height - 4} textAnchor="middle" fontSize="11" fill="#6b7280">
                {item.label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function TableHead({ children }) {
  return (
    <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur supports-[backdrop-filter]:bg-gray-50/80">
      {children}
    </thead>
  );
}

function TH({ children, align = "left", className = "" }) {
  const alignClass = align === "right" ? "text-right" : "text-left";
  return (
    <th
      className={`whitespace-nowrap border-b border-gray-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${alignClass} ${className}`}
    >
      {children}
    </th>
  );
}

function TD({ children, align = "left", className = "" }) {
  const alignClass = align === "right" ? "text-right" : "text-left";
  return (
    <td className={`px-4 py-3.5 align-top text-sm text-gray-700 ${alignClass} ${className}`}>
      {children}
    </td>
  );
}

function EmptyRow({ loading, colSpan }) {
  return (
    <tr>
      <td className="px-4 py-10 text-center text-sm text-gray-500" colSpan={colSpan}>
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
  }, [tab, paymentsAgentId, paymentsEntryType, paymentsDateFrom, paymentsDateTo]);

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
    () =>
      payments.reduce(
        (s, r) =>
          s +
          (String(r.entry_type || "payment") === "payment"
            ? Number(r.amount || 0)
            : 0),
        0
      ),
    [payments]
  );

  const totalRefunds = useMemo(
    () =>
      payments.reduce(
        (s, r) =>
          s +
          (String(r.entry_type || "payment") === "refund"
            ? Number(r.amount || 0)
            : 0),
        0
      ),
    [payments]
  );



  const salesTrend = useMemo(() => {
    const map = new Map();
    [...salesReport]
      .sort((a, b) => String(a.sale_date || "").localeCompare(String(b.sale_date || "")))
      .forEach((row) => {
        const key = iso(row.sale_date);
        const current = map.get(key) || { label: key ? key.slice(5).split('-').reverse().join('.') : '—', sales: 0, net: 0, margin: 0 };
        current.sales += Number(row.sale_amount || 0);
        current.net += Number(row.net_amount || 0);
        current.margin += Number(row.margin || 0);
        map.set(key, current);
      });
    return Array.from(map.values()).slice(-7);
  }, [salesReport]);

  const paymentsTrend = useMemo(() => {
    const map = new Map();
    [...payments]
      .sort((a, b) => String(a.payment_date || "").localeCompare(String(b.payment_date || "")))
      .forEach((row) => {
        const key = iso(row.payment_date);
        const current = map.get(key) || { label: key ? key.slice(5).split('-').reverse().join('.') : '—', payment: 0, refund: 0 };
        if (String(row.entry_type || 'payment') === 'refund') current.refund += Number(row.amount || 0);
        else current.payment += Number(row.amount || 0);
        map.set(key, current);
      });
    return Array.from(map.values()).slice(-7);
  }, [payments]);

  const salesTopAgents = useMemo(() => {
    const map = new Map();
    salesReport.forEach((row) => {
      const key = row.agent || '—';
      const current = map.get(key) || { agent: key, sales: 0, net: 0, margin: 0 };
      current.sales += Number(row.sale_amount || 0);
      current.net += Number(row.net_amount || 0);
      current.margin += Number(row.margin || 0);
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => b.sales - a.sales).slice(0, 5);
  }, [salesReport]);

  const balanceTopAgents = useMemo(() => {
    const map = new Map();
    balanceReport.forEach((row) => {
      const key = row.agent || '—';
      const current = map.get(key) || { agent: key, sales: 0, payments: 0, refunds: 0, balance: 0 };
      current.sales += Number(row.sale_amount || 0);
      current.payments += Number(row.payment_amount || 0);
      current.refunds += Number(row.refund_amount || 0);
      current.balance = Number(row.balance || 0);
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 5);
  }, [balanceReport]);

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
        entry_type: paymentForm.entry_type || "payment",
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
    if (!salesReport.length) {
      tError("Нет данных для экспорта");
      return;
    }

    exportToExcel(
      `travel-sales-report-${new Date().toISOString().slice(0, 10)}.xlsx`,
      salesReport.map((row, idx) => ({
        "№": idx + 1,
        Дата: iso(row.sale_date),
        Агент: row.agent,
        "Тип услуги": typeLabel(row.service_type),
        Направление: row.direction || "",
        "Name of traveller": row.traveller_name || "",
        "Сумма продажи": Number(row.sale_amount || 0),
        "Сумма нетто": Number(row.net_amount || 0),
        Маржа: Number(row.margin || 0),
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
      }))
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-gray-200 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 px-5 py-6 text-white shadow-[0_20px_50px_rgba(15,23,42,0.18)] md:px-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              Travel Sales Admin
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">Финансы по агентам — аккуратно, ясно и по делу</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
              Улучшенный интерфейс для продаж, оплат, отчетов и баланса агентов без изменения твоей текущей CRUD-логики.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:min-w-[480px]">
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-300">Агенты</div>
              <div className="mt-1 text-xl font-semibold">{agents.length}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-300">Продажи</div>
              <div className="mt-1 text-xl font-semibold">{money(totalSales)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-300">Оплаты</div>
              <div className="mt-1 text-xl font-semibold">{money(totalPayments)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-300">Баланс</div>
              <div className="mt-1 text-xl font-semibold">{money(totalBalance)}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-center gap-2 rounded-3xl border border-gray-200 bg-white/90 p-2 shadow-sm backdrop-blur">
          <button className={clsTab(tab === "agents")} onClick={() => setTab("agents")}>
            <SvgIcon kind={tabIcon("agents")} className="h-4 w-4 opacity-80 group-hover:opacity-100" />
            <span>Все агенты</span>
          </button>
          <button className={clsTab(tab === "daily")} onClick={() => setTab("daily")}>
            <SvgIcon kind={tabIcon("daily")} className="h-4 w-4 opacity-80 group-hover:opacity-100" />
            <span>Дневная продажа</span>
          </button>
          <button className={clsTab(tab === "payments")} onClick={() => setTab("payments")}>
            <SvgIcon kind={tabIcon("payments")} className="h-4 w-4 opacity-80 group-hover:opacity-100" />
            <span>Оплата агента</span>
          </button>
          <button className={clsTab(tab === "sales")} onClick={() => setTab("sales")}>
            <SvgIcon kind={tabIcon("sales")} className="h-4 w-4 opacity-80 group-hover:opacity-100" />
            <span>Отчет продаж</span>
          </button>
          <button className={clsTab(tab === "balance")} onClick={() => setTab("balance")}>
            <SvgIcon kind={tabIcon("balance")} className="h-4 w-4 opacity-80 group-hover:opacity-100" />
            <span>Баланс агента</span>
          </button>
        </div>
      </div>

      {tab === "agents" && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-4">
            <StatCard
              title="Всего агентов"
              value={String(agents.length)}
              hint="Отображается с учетом поиска"
              tone="blue"
              icon="users"
            />
            <StatCard
              title="С заполненным контактом"
              value={String(agents.filter((a) => String(a.contact || "").trim()).length)}
              hint="Есть телефон или контакт"
              tone="emerald"
              icon="credit"
            />
            <StatCard
              title="С указанным адресом"
              value={String(agents.filter((a) => String(a.address || "").trim()).length)}
              hint="Для быстрой навигации"
              tone="amber"
              icon="doc"
            />
            <StatCard
              title="Режим"
              value={editingAgentId ? "Редактирование" : "Добавление"}
              hint={editingAgentId ? "Сейчас открыт существующий агент" : "Создание новой записи"}
              tone="violet"
              icon="wallet"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="xl:col-span-1">
              <Card
                title={editingAgentId ? "Редактировать агента" : "Добавить агента"}
                subtitle="Чистая форма без лишнего шума"
              >
                <form onSubmit={handleSaveAgent} className="space-y-4">
                  <Field label="Наименование">
                    <input
                      className={inputClassName()}
                      value={agentForm.name}
                      onChange={(e) => setAgentForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Например: Air Broker"
                    />
                  </Field>

                  <Field label="Контакт">
                    <input
                      className={inputClassName()}
                      value={agentForm.contact}
                      onChange={(e) => setAgentForm((p) => ({ ...p, contact: e.target.value }))}
                      placeholder="+998 ..."
                    />
                  </Field>

                  <Field label="Адрес">
                    <textarea
                      className={inputClassName("min-h-[112px] resize-y")}
                      value={agentForm.address}
                      onChange={(e) => setAgentForm((p) => ({ ...p, address: e.target.value }))}
                      placeholder="Адрес агента"
                    />
                  </Field>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <ActionButton type="submit" variant="primary">
                      {editingAgentId ? "Сохранить" : "Добавить"}
                    </ActionButton>

                    {(editingAgentId || agentForm.name || agentForm.contact || agentForm.address) && (
                      <ActionButton
                        type="button"
                        onClick={() => {
                          setEditingAgentId(null);
                          setAgentForm(emptyAgentForm);
                        }}
                      >
                        Сбросить
                      </ActionButton>
                    )}
                  </div>
                </form>
              </Card>
            </div>

            <div className="xl:col-span-2">
              <Card
                title="Список агентов"
                subtitle="Удобнее читать, быстрее искать, приятнее смотреть"
                right={
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                    <input
                      className={inputClassName("sm:w-64")}
                      placeholder="Поиск по названию..."
                      value={agentQuery}
                      onChange={(e) => setAgentQuery(e.target.value)}
                    />
                    <ActionButton onClick={loadAgents} type="button">
                      Найти
                    </ActionButton>
                  </div>
                }
              >
                <TableShell>
                  <Table>
                    <TableHead>
                      <tr>
                        <TH>№</TH>
                        <TH>Наименование</TH>
                        <TH>Контакт</TH>
                        <TH>Адрес</TH>
                        <TH className="w-[180px]">Действия</TH>
                      </tr>
                    </TableHead>
                    <tbody>
                      {agentsLoading || agents.length === 0 ? (
                        <EmptyRow loading={agentsLoading} colSpan={5} />
                      ) : (
                        agents.map((row, idx) => (
                          <tr key={row.id} className="border-b border-gray-100 transition hover:bg-gray-50/70">
                            <TD className="text-gray-500">{idx + 1}</TD>
                            <TD>
                              <div className="font-semibold text-gray-900">{row.name}</div>
                            </TD>
                            <TD>{row.contact || "—"}</TD>
                            <TD className="max-w-[280px] whitespace-pre-wrap break-words">
                              {row.address || "—"}
                            </TD>
                            <TD>
                              <div className="flex flex-wrap gap-2">
                                <ActionButton onClick={() => startEditAgent(row)} type="button">
                                  Изменить
                                </ActionButton>
                                <ActionButton
                                  variant="danger"
                                  onClick={() => handleDeleteAgent(row.id)}
                                  type="button"
                                >
                                  Удалить
                                </ActionButton>
                              </div>
                            </TD>
                          </tr>
                        ))
                      )}
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-4">
            <StatCard
              title="Записей в таблице"
              value={String(dailySales.length)}
              hint="С учетом фильтров"
              tone="blue"
            />
            <StatCard
              title="Сумма продаж"
              icon="trend"
              value={money(dailySales.reduce((s, r) => s + Number(r.sale_amount || 0), 0))}
              hint="По открытой выборке"
              tone="emerald"
            />
            <StatCard
              title="Сумма нетто"
              value={money(dailySales.reduce((s, r) => s + Number(r.net_amount || 0), 0))}
              hint="По открытой выборке"
              tone="amber"
            />
            <StatCard
              title="Режим"
              value={editingSaleId ? "Редактирование" : "Новая продажа"}
              hint={editingSaleId ? "Открыта существующая запись" : "Ввод новой продажи"}
              tone="violet"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="xl:col-span-1">
              <Card
                title={editingSaleId ? "Редактировать продажу" : "Добавить продажу"}
                subtitle="Форма остается прежней по логике, но выглядит чище"
              >
                <form onSubmit={handleSaveSale} className="space-y-4">
                  <Field label="Дата">
                    <input
                      type="date"
                      className={inputClassName()}
                      value={saleForm.sale_date}
                      onChange={(e) => setSaleForm((p) => ({ ...p, sale_date: e.target.value }))}
                    />
                  </Field>

                  <Field label="Агент">
                    <select
                      className={inputClassName()}
                      value={saleForm.agent_id}
                      onChange={(e) => setSaleForm((p) => ({ ...p, agent_id: e.target.value }))}
                    >
                      <option value="">Выберите агента</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Тип услуги">
                    <select
                      className={inputClassName()}
                      value={saleForm.service_type}
                      onChange={(e) => setSaleForm((p) => ({ ...p, service_type: e.target.value }))}
                    >
                      {SERVICE_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Направление">
                    <input
                      className={inputClassName()}
                      value={saleForm.direction}
                      onChange={(e) => setSaleForm((p) => ({ ...p, direction: e.target.value }))}
                      placeholder="Например: Дели / Дубай / Ташкент"
                    />
                  </Field>

                  <Field label="Name of traveller">
                    <input
                      className={inputClassName()}
                      value={saleForm.traveller_name}
                      onChange={(e) =>
                        setSaleForm((p) => ({ ...p, traveller_name: e.target.value }))
                      }
                      placeholder="Например: Ali Valiyev"
                    />
                  </Field>

                  <Field label="Сумма продажи">
                    <input
                      type="number"
                      className={inputClassName()}
                      value={saleForm.sale_amount}
                      onChange={(e) => setSaleForm((p) => ({ ...p, sale_amount: e.target.value }))}
                      placeholder="0"
                    />
                  </Field>

                  <Field label="Сумма нетто">
                    <input
                      type="number"
                      className={inputClassName()}
                      value={saleForm.net_amount}
                      onChange={(e) => setSaleForm((p) => ({ ...p, net_amount: e.target.value }))}
                      placeholder="0"
                    />
                  </Field>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <ActionButton type="submit" variant="primary">
                      {editingSaleId ? "Сохранить" : "Добавить"}
                    </ActionButton>

                    {(editingSaleId ||
                      saleForm.agent_id ||
                      saleForm.direction ||
                      saleForm.traveller_name ||
                      saleForm.sale_amount ||
                      saleForm.net_amount) && (
                      <ActionButton
                        type="button"
                        onClick={() => {
                          setEditingSaleId(null);
                          setSaleForm(emptySaleForm);
                        }}
                      >
                        Сбросить
                      </ActionButton>
                    )}
                  </div>
                </form>
              </Card>
            </div>

            <div className="xl:col-span-2">
              <Card
                title="Список продаж"
                subtitle="Более аккуратная таблица с акцентом на важные цифры"
                right={
                  <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
                    <select
                      className={inputClassName("lg:w-[180px]")}
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
                      className={inputClassName("lg:w-[170px]")}
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
                      className={inputClassName("lg:w-[160px]")}
                      value={dailyDateFrom}
                      onChange={(e) => setDailyDateFrom(e.target.value)}
                    />
                    <input
                      type="date"
                      className={inputClassName("lg:w-[160px]")}
                      value={dailyDateTo}
                      onChange={(e) => setDailyDateTo(e.target.value)}
                    />

                    <ActionButton className="lg:w-auto" onClick={loadDailySales} type="button">
                      Фильтр
                    </ActionButton>
                  </div>
                }
              >
                <TableShell>
                  <Table>
                    <TableHead>
                      <tr>
                        <TH>№</TH>
                        <TH>Дата</TH>
                        <TH>Агент</TH>
                        <TH>Тип</TH>
                        <TH>Направление</TH>
                        <TH>Name of traveller</TH>
                        <TH align="right">Продажа</TH>
                        <TH align="right">Нетто</TH>
                        <TH className="w-[180px]">Действия</TH>
                      </tr>
                    </TableHead>
                    <tbody>
                      {dailyLoading || dailySales.length === 0 ? (
                        <EmptyRow loading={dailyLoading} colSpan={9} />
                      ) : (
                        dailySales.map((row, idx) => (
                          <tr key={row.id} className="border-b border-gray-100 transition hover:bg-gray-50/70">
                            <TD className="text-gray-500">{idx + 1}</TD>
                            <TD>{iso(row.sale_date)}</TD>
                            <TD>
                              <div className="font-medium text-gray-900">{row.agent_name}</div>
                            </TD>
                            <TD>
                              <Badge className={badgeClassByServiceType(row.service_type)}>
                                {typeLabel(row.service_type)}
                              </Badge>
                            </TD>
                            <TD className="max-w-[200px] whitespace-pre-wrap break-words">
                              {row.direction}
                            </TD>
                            <TD>{row.traveller_name || "—"}</TD>
                            <TD align="right" className="font-semibold text-gray-900">
                              {money(row.sale_amount)}
                            </TD>
                            <TD align="right" className="font-semibold text-gray-900">
                              {money(row.net_amount)}
                            </TD>
                            <TD>
                              <div className="flex flex-wrap gap-2">
                                <ActionButton onClick={() => startEditSale(row)} type="button">
                                  Изменить
                                </ActionButton>
                                <ActionButton
                                  variant="danger"
                                  onClick={() => handleDeleteSale(row.id)}
                                  type="button"
                                >
                                  Удалить
                                </ActionButton>
                              </div>
                            </TD>
                          </tr>
                        ))
                      )}
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
            <StatCard title="Сумма оплат" value={money(totalPayments)} tone="blue" />
            <StatCard title="Сумма возвратов" value={money(totalRefunds)} tone="amber" />
            <StatCard title="Чистый эффект" value={money(totalPayments - totalRefunds)} tone="emerald" />
            <StatCard title="Записей" value={String(payments.length)} tone="violet" />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="xl:col-span-1">
              <Card
                title={editingPaymentId ? "Редактировать оплату" : "Добавить оплату"}
                subtitle="Оплаты и возвраты теперь читаются легче"
              >
                <form onSubmit={handleSavePayment} className="space-y-4">
                  <Field label="Дата оплаты">
                    <input
                      type="date"
                      className={inputClassName()}
                      value={paymentForm.payment_date}
                      onChange={(e) =>
                        setPaymentForm((p) => ({ ...p, payment_date: e.target.value }))
                      }
                    />
                  </Field>

                  <Field label="Агент">
                    <select
                      className={inputClassName()}
                      value={paymentForm.agent_id}
                      onChange={(e) => setPaymentForm((p) => ({ ...p, agent_id: e.target.value }))}
                    >
                      <option value="">Выберите агента</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Тип записи">
                    <select
                      className={inputClassName()}
                      value={paymentForm.entry_type}
                      onChange={(e) =>
                        setPaymentForm((p) => ({ ...p, entry_type: e.target.value }))
                      }
                    >
                      {PAYMENT_ENTRY_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Сумма оплаты">
                    <input
                      type="number"
                      className={inputClassName()}
                      value={paymentForm.amount}
                      onChange={(e) => setPaymentForm((p) => ({ ...p, amount: e.target.value }))}
                      placeholder="0"
                    />
                  </Field>

                  <Field label="Комментарий">
                    <input
                      className={inputClassName()}
                      value={paymentForm.comment}
                      onChange={(e) => setPaymentForm((p) => ({ ...p, comment: e.target.value }))}
                      placeholder="Комментарий"
                    />
                  </Field>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <ActionButton type="submit" variant="primary">
                      {editingPaymentId ? "Сохранить" : "Добавить"}
                    </ActionButton>

                    {(editingPaymentId ||
                      paymentForm.agent_id ||
                      paymentForm.amount ||
                      paymentForm.comment) && (
                      <ActionButton
                        type="button"
                        onClick={() => {
                          setEditingPaymentId(null);
                          setPaymentForm(emptyPaymentForm);
                        }}
                      >
                        Сбросить
                      </ActionButton>
                    )}
                  </div>
                </form>
              </Card>
            </div>

            <div className="xl:col-span-2">
              <Card
                title="Список оплат"
                subtitle="Суммы и типы операций выделены визуально"
                right={
                  <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
                    <select
                      className={inputClassName("lg:w-[180px]")}
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
                    <select
                      className={inputClassName("lg:w-[170px]")}
                      value={paymentsEntryType}
                      onChange={(e) => setPaymentsEntryType(e.target.value)}
                    >
                      <option value="">Все записи</option>
                      <option value="payment">Только оплаты</option>
                      <option value="refund">Только возвраты</option>
                    </select>

                    <input
                      type="date"
                      className={inputClassName("lg:w-[160px]")}
                      value={paymentsDateFrom}
                      onChange={(e) => setPaymentsDateFrom(e.target.value)}
                    />
                    <input
                      type="date"
                      className={inputClassName("lg:w-[160px]")}
                      value={paymentsDateTo}
                      onChange={(e) => setPaymentsDateTo(e.target.value)}
                    />

                    <ActionButton onClick={loadPayments} type="button">
                      Фильтр
                    </ActionButton>
                  </div>
                }
              >
                <TableShell>
                  <Table>
                    <TableHead>
                      <tr>
                        <TH>№</TH>
                        <TH>Дата оплаты</TH>
                        <TH>Агент</TH>
                        <TH>Тип записи</TH>
                        <TH align="right">Сумма</TH>
                        <TH>Комментарий</TH>
                        <TH className="w-[180px]">Действия</TH>
                      </tr>
                    </TableHead>
                    <tbody>
                      {paymentsLoading || payments.length === 0 ? (
                        <EmptyRow loading={paymentsLoading} colSpan={7} />
                      ) : (
                        payments.map((row, idx) => (
                          <tr key={row.id} className="border-b border-gray-100 transition hover:bg-gray-50/70">
                            <TD className="text-gray-500">{idx + 1}</TD>
                            <TD>{iso(row.payment_date)}</TD>
                            <TD>
                              <div className="font-medium text-gray-900">{row.agent_name}</div>
                            </TD>
                            <TD>
                              <Badge className={badgeClassByLedgerType(row.entry_type)}>
                                {ledgerTypeLabel(row.entry_type)}
                              </Badge>
                            </TD>
                            <TD align="right" className="font-semibold text-gray-900">
                              {money(row.amount)}
                            </TD>
                            <TD className="max-w-[320px] whitespace-pre-wrap break-words">
                              {row.comment || "—"}
                            </TD>
                            <TD>
                              <div className="flex flex-wrap gap-2">
                                <ActionButton onClick={() => startEditPayment(row)} type="button">
                                  Изменить
                                </ActionButton>
                                <ActionButton
                                  variant="danger"
                                  onClick={() => handleDeletePayment(row.id)}
                                  type="button"
                                >
                                  Удалить
                                </ActionButton>
                              </div>
                            </TD>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </Table>
                </TableShell>
              </Card>
            </div>
          </div>
        </>
      )}

      {tab === "sales" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Сумма продаж" value={money(totalSales)} tone="blue" />
            <StatCard title="Сумма нетто" value={money(totalNet)} tone="amber" />
            <StatCard title="Маржа" value={money(totalMargin)} tone="emerald" />
            <StatCard title="Записей" value={String(salesReport.length)} tone="violet" />
          </div>



          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card title="Динамика за период" subtitle="Последние 7 дат по открытой выборке">
              <MiniTrend
                data={salesTrend}
                lines={[
                  { key: "sales", label: "Продажи", color: "#3b82f6" },
                  { key: "margin", label: "Маржа", color: "#10b981" },
                ]}
              />
            </Card>

            <Card title="Структура суммы" subtitle="Сравнение продаж, нетто и маржи">
              <div className="space-y-4">
                <MiniBar
                  label="Продажи"
                  value={totalSales}
                  max={Math.max(totalSales, totalNet, totalMargin, 1)}
                  tone="blue"
                />
                <MiniBar
                  label="Нетто"
                  value={totalNet}
                  max={Math.max(totalSales, totalNet, totalMargin, 1)}
                  tone="amber"
                />
                <MiniBar
                  label="Маржа"
                  value={totalMargin}
                  max={Math.max(totalSales, totalNet, totalMargin, 1)}
                  tone="emerald"
                />
              </div>
            </Card>

            <Card title="Топ агентов" subtitle="По обороту в текущем фильтре">
              <div className="space-y-4">
                {salesTopAgents.length ? salesTopAgents.map((row) => (
                  <div key={row.agent} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-gray-900">{row.agent}</div>
                        <div className="text-xs text-gray-500">Маржа: {money(row.margin)}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-gray-900">{money(row.sales)}</div>
                        <div className="text-xs text-gray-500">Нетто: {money(row.net)}</div>
                      </div>
                    </div>
                  </div>
                )) : <div className="text-sm text-gray-500">Нет данных для аналитики</div>}
              </div>
            </Card>
          </div>

          <Card
            title="Отчет продаж"
            subtitle="Сильный акцент на деньгах и марже"
            right={
              <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
                <select
                  className={inputClassName("lg:w-[180px]")}
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
                  className={inputClassName("lg:w-[170px]")}
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
                  className={inputClassName("lg:w-[160px]")}
                  value={salesDateFrom}
                  onChange={(e) => setSalesDateFrom(e.target.value)}
                />
                <input
                  type="date"
                  className={inputClassName("lg:w-[160px]")}
                  value={salesDateTo}
                  onChange={(e) => setSalesDateTo(e.target.value)}
                />

                <ActionButton onClick={loadSalesReport} type="button">
                  Фильтр
                </ActionButton>

                <ActionButton variant="primary" onClick={exportSalesReport} type="button">
                  Excel
                </ActionButton>
              </div>
            }
          >
            <TableShell>
              <Table>
                <TableHead>
                  <tr>
                    <TH>№</TH>
                    <TH>Дата</TH>
                    <TH>Агент</TH>
                    <TH>Тип</TH>
                    <TH>Направление</TH>
                    <TH>Name of traveller</TH>
                    <TH align="right">Сумма продажи</TH>
                    <TH align="right">Сумма нетто</TH>
                    <TH align="right">Маржа</TH>
                  </tr>
                </TableHead>
                <tbody>
                  {salesReportLoading || salesReport.length === 0 ? (
                    <EmptyRow loading={salesReportLoading} colSpan={9} />
                  ) : (
                    salesReport.map((row, idx) => (
                      <tr key={row.id} className="border-b border-gray-100 transition hover:bg-gray-50/70">
                        <TD className="text-gray-500">{idx + 1}</TD>
                        <TD>{iso(row.sale_date)}</TD>
                        <TD>
                          <div className="font-medium text-gray-900">{row.agent}</div>
                        </TD>
                        <TD>
                          <Badge className={badgeClassByServiceType(row.service_type)}>
                            {typeLabel(row.service_type)}
                          </Badge>
                        </TD>
                        <TD className="max-w-[220px] whitespace-pre-wrap break-words">
                          {row.direction || "—"}
                        </TD>
                        <TD>{row.traveller_name || "—"}</TD>
                        <TD align="right" className="font-semibold text-gray-900">
                          {money(row.sale_amount)}
                        </TD>
                        <TD align="right" className="font-semibold text-gray-900">
                          {money(row.net_amount)}
                        </TD>
                        <TD align="right" className="font-semibold text-emerald-700">
                          {money(row.margin)}
                        </TD>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </TableShell>
          </Card>
        </div>
      )}

      {tab === "balance" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Общий баланс" value={money(totalBalance)} tone="rose" />
            <StatCard title="Строк в отчете" value={String(balanceReport.length)} tone="blue" />
            <StatCard
              title="Продажи в отчете"
              value={money(balanceReport.reduce((s, r) => s + Number(r.sale_amount || 0), 0))}
              tone="emerald"
            />
            <StatCard
              title="Оплаты + возвраты"
              value={money(
                balanceReport.reduce(
                  (s, r) =>
                    s + Number(r.payment_amount || 0) + Number(r.refund_amount || 0),
                  0
                )
              )}
              tone="amber"
            />
          </div>



          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card title="Поток движения" subtitle="Продажи и возвраты по датам">
              <MiniTrend
                data={paymentsTrend}
                lines={[
                  { key: "payment", label: "Оплаты", color: "#3b82f6" },
                  { key: "refund", label: "Возвраты", color: "#f59e0b" },
                ]}
              />
            </Card>

            <Card title="Состав баланса" subtitle="Что сильнее влияет на итог">
              <div className="space-y-4">
                <MiniBar
                  label="Продажи"
                  value={balanceReport.reduce((s, r) => s + Number(r.sale_amount || 0), 0)}
                  max={Math.max(
                    balanceReport.reduce((s, r) => s + Number(r.sale_amount || 0), 0),
                    balanceReport.reduce((s, r) => s + Number(r.payment_amount || 0), 0),
                    balanceReport.reduce((s, r) => s + Number(r.refund_amount || 0), 0),
                    1
                  )}
                  tone="emerald"
                />
                <MiniBar
                  label="Оплаты"
                  value={balanceReport.reduce((s, r) => s + Number(r.payment_amount || 0), 0)}
                  max={Math.max(
                    balanceReport.reduce((s, r) => s + Number(r.sale_amount || 0), 0),
                    balanceReport.reduce((s, r) => s + Number(r.payment_amount || 0), 0),
                    balanceReport.reduce((s, r) => s + Number(r.refund_amount || 0), 0),
                    1
                  )}
                  tone="blue"
                />
                <MiniBar
                  label="Возвраты"
                  value={balanceReport.reduce((s, r) => s + Number(r.refund_amount || 0), 0)}
                  max={Math.max(
                    balanceReport.reduce((s, r) => s + Number(r.sale_amount || 0), 0),
                    balanceReport.reduce((s, r) => s + Number(r.payment_amount || 0), 0),
                    balanceReport.reduce((s, r) => s + Number(r.refund_amount || 0), 0),
                    1
                  )}
                  tone="amber"
                />
              </div>
            </Card>

            <Card title="Агенты с самым заметным балансом" subtitle="По модулю остатка">
              <div className="space-y-4">
                {balanceTopAgents.length ? balanceTopAgents.map((row) => (
                  <div key={row.agent} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-gray-900">{row.agent}</div>
                        <div className="text-xs text-gray-500">
                          Продажи: {money(row.sales)} • Оплаты: {money(row.payments)}
                        </div>
                      </div>
                      <div className={`text-right font-semibold ${amountClass(row.balance, "balance")}`}>
                        {money(row.balance)}
                      </div>
                    </div>
                  </div>
                )) : <div className="text-sm text-gray-500">Нет данных для аналитики</div>}
              </div>
            </Card>
          </div>

          <Card
            title="Баланс агента"
            subtitle="Лучше читается последовательность операций и текущий баланс"
            right={
              <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:flex-wrap lg:items-center lg:justify-end">
                <select
                  className={inputClassName("lg:w-[180px]")}
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
                  className={inputClassName("lg:w-[170px]")}
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
                  className={inputClassName("lg:w-[160px]")}
                  value={balanceDateFrom}
                  onChange={(e) => setBalanceDateFrom(e.target.value)}
                />
                <input
                  type="date"
                  className={inputClassName("lg:w-[160px]")}
                  value={balanceDateTo}
                  onChange={(e) => setBalanceDateTo(e.target.value)}
                />

                <ActionButton onClick={loadBalanceReport} type="button">
                  Фильтр
                </ActionButton>

                <ActionButton variant="primary" onClick={exportBalanceReport} type="button">
                  Excel
                </ActionButton>
              </div>
            }
          >
            <TableShell>
              <Table>
                <TableHead>
                  <tr>
                    <TH>№</TH>
                    <TH>Дата операции</TH>
                    <TH>Тип записи</TH>
                    <TH>Агент</TH>
                    <TH>Тип услуги</TH>
                    <TH>Направление</TH>
                    <TH>Name of traveller</TH>
                    <TH align="right">Продажа</TH>
                    <TH align="right">Оплата</TH>
                    <TH align="right">Возврат</TH>
                    <TH>Комментарий</TH>
                    <TH align="right">Баланс</TH>
                  </tr>
                </TableHead>
                <tbody>
                  {balanceLoading || balanceReport.length === 0 ? (
                    <EmptyRow loading={balanceLoading} colSpan={12} />
                  ) : (
                    balanceReport.map((row, idx) => (
                      <tr
                        key={row.row_key || `${row.entry_type}-${idx}`}
                        className="border-b border-gray-100 transition hover:bg-gray-50/70"
                      >
                        <TD className="text-gray-500">{idx + 1}</TD>
                        <TD>{iso(row.txn_date)}</TD>
                        <TD>
                          <Badge className={badgeClassByLedgerType(row.entry_type)}>
                            {ledgerTypeLabel(row.entry_type)}
                          </Badge>
                        </TD>
                        <TD>
                          <div className="font-medium text-gray-900">{row.agent}</div>
                        </TD>
                        <TD>
                          <Badge className={badgeClassByServiceType(row.service_type)}>
                            {typeLabel(row.service_type)}
                          </Badge>
                        </TD>
                        <TD className="max-w-[220px] whitespace-pre-wrap break-words">
                          {row.direction || "—"}
                        </TD>
                        <TD>{row.traveller_name || "—"}</TD>
                        <TD align="right" className="font-medium text-gray-900">
                          {money(row.sale_amount)}
                        </TD>
                        <TD align="right" className="font-medium text-gray-900">
                          {money(row.payment_amount)}
                        </TD>
                        <TD align="right" className="font-medium text-gray-900">
                          {money(row.refund_amount)}
                        </TD>
                        <TD className="max-w-[320px] whitespace-pre-wrap break-words">
                          {row.comment || "—"}
                        </TD>
                        <TD
                          align="right"
                          className={`font-semibold ${amountClass(row.balance, "balance")}`}
                        >
                          {money(row.balance)}
                        </TD>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </TableShell>

            <div className="mt-4 rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
              Формула:&nbsp;
              <span className="font-semibold text-gray-900">
                баланс = предыдущий баланс + продажа - оплата - возврат
              </span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
