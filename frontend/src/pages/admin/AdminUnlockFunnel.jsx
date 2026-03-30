//frontend/src/pages/admin/AdminUnlockFunnel.jsx

import { useEffect, useState } from "react";
import { apiGet } from "../../api";

export default function AdminUnlockFunnel() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet("/api/admin/unlock-funnel");
      if (res?.success) setData(res.data || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="bg-white rounded-xl p-4 shadow">
      <h2 className="text-lg font-semibold mb-3">Unlock Funnel</h2>

      {loading && <div>Loading...</div>}

      {!loading && (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Client</th>
                <th className="text-left p-2">Phone</th>
                <th className="text-left p-2">Service</th>
                <th className="text-left p-2">Step</th>
                <th className="text-left p-2">Source</th>
                <th className="text-left p-2">Balance</th>
                <th className="text-left p-2">Date</th>
              </tr>
            </thead>

            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-b hover:bg-gray-50">
                  <td className="p-2">{row.client_name || row.client_id}</td>
                  <td className="p-2">{row.client_phone}</td>
                  <td className="p-2">{row.service_title}</td>
                  <td className="p-2 font-semibold">{row.step}</td>
                  <td className="p-2">{row.source}</td>
                  <td className="p-2">
                    {row.balance_before} → {row.balance_after}
                  </td>
                  <td className="p-2">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
