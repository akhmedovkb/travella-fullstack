//frontend/src/pages/admin/PaymeDashboard.jsx

import { useEffect, useState } from "react";
import axios from "axios";

export default function PaymeDashboard() {

  const [stats,setStats]=useState(null);

  async function load() {
    const res = await axios.get("/api/admin/payme/dashboard");
    setStats(res.data);
  }

  useEffect(()=>{
    load();
  },[]);

  if(!stats) return <div className="p-4">Loading...</div>;

  return (
    <div className="p-4 grid grid-cols-3 gap-4">

      <div className="bg-white shadow rounded p-4">
        <div className="text-sm text-gray-500">Total Topups Today</div>
        <div className="text-2xl font-bold">{stats.today_topups}</div>
      </div>

      <div className="bg-white shadow rounded p-4">
        <div className="text-sm text-gray-500">Successful Payments</div>
        <div className="text-2xl font-bold">{stats.success}</div>
      </div>

      <div className="bg-white shadow rounded p-4">
        <div className="text-sm text-gray-500">Failed Payments</div>
        <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
      </div>

      <div className="bg-white shadow rounded p-4">
        <div className="text-sm text-gray-500">Refunds</div>
        <div className="text-2xl font-bold text-yellow-600">{stats.refunds}</div>
      </div>

      <div className="bg-white shadow rounded p-4">
        <div className="text-sm text-gray-500">Ledger Credits</div>
        <div className="text-2xl font-bold">{stats.ledger_credits}</div>
      </div>

      <div className="bg-white shadow rounded p-4">
        <div className="text-sm text-gray-500">Broken Transactions</div>
        <div className="text-2xl font-bold text-red-600">{stats.broken}</div>
      </div>

    </div>
  );
}
