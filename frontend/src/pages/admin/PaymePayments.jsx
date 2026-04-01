//frontend/src/pages/admin/PaymePayments.jsx

import { useEffect, useState } from "react";
import { apiGet } from "../../api";

export default function PaymePayments() {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const data = await apiGet("/api/admin/payme/payments", "admin");
    setRows(data?.rows || []);
  }

  return (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-4">Payme Payments</h2>

      <div className="border rounded-xl overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Performed</th>
              <th className="px-3 py-2">Payme ID</th>
              <th className="px-3 py-2">Order</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">{r.name || r.client_id}</td>
                <td className="px-3 py-2">{r.phone}</td>
                <td className="px-3 py-2 font-semibold">
                  {Number(r.amount) / 100} сум
                </td>
                <td className="px-3 py-2">{r.state}</td>
                <td className="px-3 py-2">
                  {r.created_at && new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  {r.perform_time && new Date(r.perform_time).toLocaleString()}
                </td>
                <td className="px-3 py-2">{r.payme_id}</td>
                <td className="px-3 py-2">{r.order_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
