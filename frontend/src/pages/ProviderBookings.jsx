import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";

export default function ProviderBookings() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const rows = await apiGet("/api/bookings/provider"); // бронирования по услугам провайдера
      setItems(rows || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function confirm(id) {
    try {
      await apiPost(`/api/bookings/${id}/confirm`, {});
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function reject(id) {
    try {
      await apiPost(`/api/bookings/${id}/reject`, {});
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function cancel(id) {
    const reason = prompt("Причина отмены (необязательно):") || undefined;
    try {
      await apiPost(`/api/bookings/${id}/cancel`, { reason });
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto bg-white p-6 rounded-xl shadow">
      <h1 className="text-2xl font-bold mb-4">Bookings (Provider)</h1>

      {(!items || items.length === 0) ? (
        <div className="text-sm text-gray-500">Нет бронирований.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((b) => {
            const created = b.created_at ? new Date(b.created_at).toLocaleString() : "";
            const details = b.details || null;

            return (
              <div key={b.id} className="border rounded-lg p-4">
                <div className="font-semibold">
                  Booking #{b.id} · Service #{b.service_id} · Client #{b.client_id}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  Status: <b>{b.status}</b> · {created}
                </div>

                {details && (
                  <div className="mt-2 bg-gray-50 rounded p-2">
                    <div className="text-sm font-semibold mb-1">Details</div>
                    <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(details, null, 2)}</pre>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {b.status === "pending" && (
                    <>
                      <button
                        className="border border-green-600 text-green-700 py-2 px-4 rounded font-bold"
                        onClick={() => confirm(b.id)}
                      >
                        Confirm
                      </button>
                      <button
                        className="border border-red-600 text-red-700 py-2 px-4 rounded font-bold"
                        onClick={() => reject(b.id)}
                      >
                        Reject
                      </button>
                    </>
                  )}

                  {(b.status === "pending" || b.status === "confirmed") && (
                    <button
                      className="border border-gray-800 text-gray-900 py-2 px-4 rounded font-bold"
                      onClick={() => cancel(b.id)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
