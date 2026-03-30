// frontend/src/pages/admin/AdminFinance.jsx

import { useState } from "react";
import AdminPaymeHealth from "./AdminPaymeHealth";
import AdminBilling from "./AdminBilling";
import AdminContactBalance from "./AdminContactBalance";
import AdminUnlockFunnel from "./AdminUnlockFunnel";

export default function AdminFinance() {
  const [tab, setTab] = useState("clients");

  const TabBtn = ({ id, children }) => (
    <button
      className={`px-3 py-2 rounded-lg text-sm ${
        tab === id ? "bg-black text-white" : "border bg-white"
      }`}
      onClick={() => setTab(id)}
    >
      {children}
    </button>
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Finance (Admin)</h1>
          <p className="text-sm text-gray-500">
            Clients — работа по конкретному клиенту.  
            Payme — платежи, monitoring и диагностика.  
            Funnel — кого можно дожимать по открытию контактов.  
            Audit — системный контроль и integrity guard.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TabBtn id="clients">Clients</TabBtn>
          <TabBtn id="payme">Payme</TabBtn>
          <TabBtn id="funnel">Funnel</TabBtn>
          <TabBtn id="audit">Audit</TabBtn>
        </div>
      </div>

      {tab === "clients" && <AdminContactBalance />}
      {tab === "payme" && <AdminPaymeHealth />}
      {tab === "funnel" && <AdminUnlockFunnel />}
      {tab === "audit" && <AdminBilling />}
    </div>
  );
}
