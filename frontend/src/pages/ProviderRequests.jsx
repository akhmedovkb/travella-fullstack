import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";

export default function ProviderRequests() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyTextById, setReplyTextById] = useState({});
  const [proposalById, setProposalById] = useState({}); // текстовое поле с JSON

  async function load() {
    setLoading(true);
    try {
      const rows = await apiGet("/api/requests/my", "provider"); // заявки по услугам провайдера
      setItems(rows || []);
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function sendReply(id) {
    const text = (replyTextById[id] || "").trim();
    if (!text) return;
    try {
      await apiPost(`/api/requests/${id}/reply`, { text }, "provider");
      setReplyTextById((p) => ({ ...p, [id]: "" }));
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function sendProposal(id) {
    const raw = (proposalById[id] || "").trim();
    if (!raw) {
      alert('Введите JSON, напр. {"price":1200,"hotel":"Taj","room":"TRPL"}');
      return;
    }
    let json;
    try { json = JSON.parse(raw); } catch { alert("Неверный JSON"); return; }
    try {
      await apiPost(`/api/requests/${id}/proposal`, { proposal: json }, "provider");
      setProposalById((p) => ({ ...p, [id]: "" }));
      await load();
    } catch (e) {
      alert(e.message);
    }
  }

  if (loading) return <div className="p-4">Loading...</div>;
  const list = Array.isArray(items) ? items : [];

  return (
    <div className="max-w-6xl mx-auto bg-white p-6 rounded-xl shadow">
      <h1 className="text-2xl font-bold mb-4">Requests (Provider)</h1>

      {list.length === 0 ? (
        <div className="text-sm text-gray-500">Нет заявок.</div>
      ) : (
        <div className="space-y-4">
          {list.map((r) => (
            <div key={r.id} className="border rounded-lg p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div className="font-semibold">
                  Request #{r.id} · Service #{r.service_id} · Client #{r.client_id}
                </div>
                <div className="text-sm text-gray-600">
                  Status: <b>{r.status}</b> · {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                </div>
              </div>

              {/* Сообщения */}
              <div className="mt-3 bg-gray-50 rounded p-3 max-h-56 overflow-auto">
                {Array.isArray(r.messages) && r.messages.length > 0 ? (
                  r.messages.map((m) => (
                    <div key={m.id} className="text-sm mb-2">
                      <span className="font-semibold">{m.sender_role}</span>: {m.text}{" "}
                      <span className="text-gray-500">· {new Date(m.created_at).toLocaleString()}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-gray-500">Нет сообщений.</div>
                )}
              </div>

              {/* Текущее предложение (если есть) */}
              {r.proposal && (
                <div className="mt-3 border rounded p-3">
                  <div className="font-semibold mb-1">Текущее предложение</div>
                  <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(r.proposal, null, 2)}</pre>
                </div>
              )}

              {/* Ответ и отправка нового предложения */}
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex gap-2">
                  <input
                    className="flex-1 border px-3 py-2 rounded text-sm"
                    placeholder="Сообщение клиенту…"
                    value={replyTextById[r.id] || ""}
                    onChange={(e) => setReplyTextById((p) => ({ ...p, [r.id]: e.target.value }))}
                  />
                  <button
                    className="w-36 bg-orange-500 text-white py-2 rounded font-bold"
                    onClick={() => sendReply(r.id)}
                  >
                    Отправить
                  </button>
                </div>

                <div>
                  <textarea
                    className="w-full border px-3 py-2 rounded text-sm"
                    rows={3}
                    placeholder='JSON-предложение (напр. {"price":1200,"hotel":"Taj","room":"TRPL"})'
                    value={proposalById[r.id] || ""}
                    onChange={(e) => setProposalById((p) => ({ ...p, [r.id]: e.target.value }))}
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      className="w-44 border border-gray-800 text-gray-900 py-2 rounded font-bold"
                      onClick={() => sendProposal(r.id)}
                    >
                      Отправить предложение
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-2 text-xs text-gray-500">
                После того как клиент примет предложение (status = accepted), он сможет оформить бронирование.
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
