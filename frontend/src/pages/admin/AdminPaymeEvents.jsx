// frontend/src/pages/admin/AdminPaymeEvents.jsx

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../api";
import { tError } from "../../shared/toast";

export default function AdminPaymeEvents() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [method, setMethod] = useState("");
  const [stage, setStage] = useState("");
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", "200");
    if (q.trim()) p.set("q", q.trim());
    if (method) p.set("method", method);
    if (stage) p.set("stage", stage);
    return p.toString();
  }, [q, method, stage]);

  async function load() {
    setLoading(true);
    try {
      const data = await apiGet(`/api/admin/payme/events?${query}`, "admin");
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e) {
      console.error(e);
      setRows([]);
      tError("Не удалось загрузить Payme Events");
    } finally {
      setLoading(false);
    }
  }

  async function openDetails(id) {
    setSelected(id);
    setDetails(null);
    try {
      const data = await apiGet(`/api/admin/payme/events/${id}`, "admin");
      setDetails(data?.row || null);
    } catch (e) {
      console.error(e);
      setDetails(null);
      tError("Не удалось загрузить детали события");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Payme Events</h2>
          <div className="text-sm opacity-70">
            RPC request/response logs (begin/end/error)
          </div>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <input
            className="border rounded px-3 py-2 w-full md:w-72"
            placeholder="Search: payme_id / order_id / error..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <select
            className="border rounded px-3 py-2"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="">All methods</option>
            <option value="CheckPerformTransaction">CheckPerformTransaction</option>
            <option value="CreateTransaction">CreateTransaction</option>
            <option value="PerformTransaction">PerformTransaction</option>
            <option value="CancelTransaction">CancelTransaction</option>
            <option value="CheckTransaction">CheckTransaction</option>
            <option value="GetStatement">GetStatement</option>
            <option value="SetFiscalData">SetFiscalData</option>
          </select>

          <select
            className="border rounded px-3 py-2"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
          >
            <option value="">All stages</option>
            <option value="begin">begin</option>
            <option value="end">end</option>
            <option value="error">error</option>
          </select>

          <button
            className="border rounded px-3 py-2"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Loading..." : "Reload"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border rounded-xl overflow-hidden">
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">HTTP</th>
                  <th className="px-3 py-2">Err</th>
                  <th className="px-3 py-2">ms</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-t hover:bg-gray-50 cursor-pointer ${
                      selected === r.id ? "bg-gray-50" : ""
                    }`}
                    onClick={() => openDetails(r.id)}
                  >
                    <td className="px-3 py-2">{r.id}</td>
                    <td className="px-3 py-2">
                      {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                    </td>
                    <td className="px-3 py-2">{r.method || ""}</td>
                    <td className="px-3 py-2">{r.stage || ""}</td>
                    <td className="px-3 py-2">{r.order_id ?? ""}</td>
                    <td className="px-3 py-2">{r.http_status ?? ""}</td>
                    <td className="px-3 py-2">{r.error_code ?? ""}</td>
                    <td className="px-3 py-2">{r.duration_ms ?? ""}</td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td className="px-3 py-6 opacity-60" colSpan={8}>
                      No events
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border rounded-xl p-3">
          <div className="font-semibold mb-2">Details</div>

          {!details && (
            <div className="text-sm opacity-70">
              Click an event row to view request/response.
            </div>
          )}

          {details && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <b>ID:</b> {details.id}
                </div>
                <div>
                  <b>Created:</b>{" "}
                  {details.created_at ? new Date(details.created_at).toLocaleString() : ""}
                </div>
                <div>
                  <b>Method:</b> {details.method || ""}
                </div>
                <div>
                  <b>Stage:</b> {details.stage || ""}
                </div>
                <div>
                  <b>Payme ID:</b> {details.payme_id || ""}
                </div>
                <div>
                  <b>Order ID:</b> {details.order_id ?? ""}
                </div>
                <div>
                  <b>HTTP:</b> {details.http_status ?? ""}
                </div>
                <div>
                  <b>Error:</b> {details.error_code ?? ""}{" "}
                  {details.error_message ? `— ${details.error_message}` : ""}
                </div>
                <div>
                  <b>IP:</b> {details.ip || ""}
                </div>
                <div>
                  <b>ms:</b> {details.duration_ms ?? ""}
                </div>
              </div>

              <div>
                <div className="font-semibold mb-1">Request JSON</div>
                <pre className="bg-gray-50 rounded p-2 overflow-auto max-h-72">
                  {JSON.stringify(details.req_json || null, null, 2)}
                </pre>
              </div>

              <div>
                <div className="font-semibold mb-1">Response JSON</div>
                <pre className="bg-gray-50 rounded p-2 overflow-auto max-h-72">
                  {JSON.stringify(details.res_json || null, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
