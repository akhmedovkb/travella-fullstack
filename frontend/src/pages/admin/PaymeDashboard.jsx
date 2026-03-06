// frontend/src/pages/admin/PaymeDashboard.jsx

import { useEffect, useState } from "react";
import { apiGet } from "../../api";
import { tError } from "../../shared/toast";

export default function PaymeDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet("/api/admin/payme/dashboard", "admin");
      setStats(data);
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить Payme Dashboard");
      setStats(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading && !stats) {
    return <div className="p-4">Loading...</div>;
  }

  if (!stats) {
    return <div className="p-4 text-sm text-gray-500">Нет данных</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-end">
        <button
          className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-60"
          onClick={load}
          disabled={loading}
        >
          {loading ? "Загрузка..." : "Обновить"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
    </div>
  );
}
