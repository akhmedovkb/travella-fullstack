// frontend/src/pages/admin/PaymeDashboard.jsx

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../../api";
import { tError } from "../../shared/toast";

function StatCard({ title, value, tone = "default", onClick }) {
  const valueClass =
    tone === "red"
      ? "text-red-600"
      : tone === "yellow"
      ? "text-yellow-600"
      : "text-gray-900";

  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white shadow rounded p-4 text-left cursor-pointer hover:bg-gray-50 transition disabled:cursor-default disabled:hover:bg-white"
    >
      <div className="text-sm text-gray-500">{title}</div>
      <div className={`text-2xl font-bold mt-1 ${valueClass}`}>{value}</div>
    </button>
  );
}

export default function PaymeDashboard() {
  const nav = useNavigate();

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

  function goToPayments(params = {}) {
    const p = new URLSearchParams();
    p.set("tab", "payments");

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value) !== "") {
        p.set(key, String(value));
      }
    });

    nav(`/admin/finance?${p.toString()}`);
  }

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
        <StatCard
          title="Total Topups Today"
          value={stats.today_topups ?? 0}
          onClick={() => goToPayments({ state: "2" })}
        />

        <StatCard
          title="Successful Payments"
          value={stats.success ?? 0}
          onClick={() => goToPayments({ state: "2" })}
        />

        <StatCard
          title="Failed Payments"
          value={stats.failed ?? 0}
          tone="red"
          onClick={() => goToPayments({ state: "-1" })}
        />

        <StatCard
          title="Refunds"
          value={stats.refunds ?? 0}
          tone="yellow"
          onClick={() => goToPayments({ state: "-2" })}
        />

        <StatCard
          title="Ledger Credits"
          value={stats.ledger_credits ?? 0}
          onClick={() => nav("/admin/finance?tab=audit")}
        />

        <StatCard
          title="Broken Transactions"
          value={stats.broken ?? 0}
          tone="red"
          onClick={() => nav("/admin/finance?tab=health&onlyProblems=1")}
        />
      </div>
    </div>
  );
}
