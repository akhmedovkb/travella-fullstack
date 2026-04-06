// frontend/src/pages/admin/AdminFinance.jsx

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import AdminPaymeHealth from "./AdminPaymeHealth";
import AdminBilling from "./AdminBilling";
import AdminContactBalance from "./AdminContactBalance";
import AdminUnlockFunnel from "./AdminUnlockFunnel";
import AdminUnlockNudgeAnalytics from "./AdminUnlockNudgeAnalytics";
import PaymeDashboard from "./PaymeDashboard";
import AdminPaymeEvents from "./AdminPaymeEvents";
import PaymePayments from "./PaymePayments";
import AdminTravelSales from "./AdminTravelSales";

const VALID_TABS = new Set([
  "clients",
  "payme",
  "events",
  "funnel",
  "nudges",
  "audit",
  "health",
  "payments",
  "travel",
]);

function normalizeTab(x) {
  const t = String(x || "").trim().toLowerCase();
  return VALID_TABS.has(t) ? t : "clients";
}

export default function AdminFinance() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = useMemo(() => {
    return normalizeTab(searchParams.get("tab"));
  }, [searchParams]);

  function setTabAndUrl(nextTab) {
    const p = new URLSearchParams(searchParams);
    p.set("tab", normalizeTab(nextTab));
    setSearchParams(p);
  }

  const TabBtn = ({ id, children }) => (
    <button
      className={`px-3 py-2 rounded-lg text-sm ${
        tab === id ? "bg-black text-white" : "border bg-white"
      }`}
      onClick={() => setTabAndUrl(id)}
    >
      {children}
    </button>
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Finance (Admin)</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TabBtn id="clients">Clients</TabBtn>
          <TabBtn id="payme">Payme</TabBtn>
          <TabBtn id="events">Events</TabBtn>
          <TabBtn id="funnel">Funnel</TabBtn>
          <TabBtn id="nudges">Nudges</TabBtn>
          <TabBtn id="audit">Audit</TabBtn>
          <TabBtn id="health">Health</TabBtn>
          <TabBtn id="payments">Payments</TabBtn>
          <TabBtn id="travel">Travel Sales</TabBtn>
        </div>
      </div>

      {tab === "clients" && <AdminContactBalance />}
      {tab === "payme" && <PaymeDashboard />}
      {tab === "events" && <AdminPaymeEvents />}
      {tab === "funnel" && <AdminUnlockFunnel />}
      {tab === "nudges" && <AdminUnlockNudgeAnalytics />}
      {tab === "audit" && <AdminBilling />}
      {tab === "health" && <AdminPaymeHealth />}
      {tab === "payments" && <PaymePayments />}
      {tab === "travel" && <AdminTravelSales />}
    </div>
  );
}
