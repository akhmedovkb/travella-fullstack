//frontend/src/pages/admin/AdminContactBalance.jsx
  
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../../api";
import { tError, tSuccess } from "../../shared/toast";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}
function fmtTs(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("ru-RU");
  } catch {
    return String(ts);
  }
}
function sign(n) {
  const v = toNum(n);
  return v > 0 ? `+${money(v)}` : `${money(v)}`;
}

export default function AdminContactBalance() {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);

  const [selected, setSelected] = useState(null);

  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState([]);

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("admin_adjust");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const canSearch = useMemo(() => String(q || "").trim().length >= 2, [q]);

  async function search() {
    const qq = String(q || "").trim();
    if (qq.length < 2) return;

    setSearching(true);
    try {
      // ожидается: { items: [...] } или просто [...]
      const data = await apiGet(`/api/admin/clients/search?q=${encodeURIComponent(qq)}`, "admin");
      const items = Array.isArray(data) ? data : (data?.items || data?.rows || []);
      setResults(items);
    } catch (e) {
      console.error(e);
      tError("Не удалось выполнить поиск клиентов");
    } finally {
      setSearching(false);
    }
  }

  async function loadClient(client) {
    if (!client?.id) return;
    setSelected(client);
    setLoading(true);
    try {
      const data = await apiGet(`/api/admin/clients/${client.id}/contact-balance`, "admin");
      setBalance(toNum(data?.balance || 0));
      setLedger(Array.isArray(data?.ledger) ? data.ledger : (data?.items || data?.rows || []));
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить баланс клиента");
      setBalance(0);
      setLedger([]);
    } finally {
      setLoading(false);
    }
  }

  async function adjust(delta) {
    if (!selected?.id) return;
    const a = delta !== undefined ? toNum(delta) : toNum(amount);
    if (!a) {
      tError("Укажите сумму (amount)");
      return;
    }
    setSaving(true);
    try {
      await apiPost(
        `/api/admin/clients/${selected.id}/contact-balance/adjust`,
        { amount: a, reason: String(reason || "admin_adjust"), note: String(note || "") },
        "admin"
      );
      tSuccess("Готово");
      setAmount("");
      setNote("");
      await loadClient(selected);
    } catch (e) {
      console.error(e);
      tError("Не удалось изменить баланс");
    } finally {
      setSaving(false);
    }
  }

  // Enter -> search
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Enter" && canSearch) search();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSearch, q]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Баланс контактов (Admin)</h1>
        <p className="text-sm text-gray-500">
          Поиск клиента → баланс → корректировка → история операций.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: search + results */}
        <div className="lg:col-span-4">
          <div className="bg-white rounded-xl shadow p-4">
            <div className="font-medium mb-2">Поиск клиента</div>
            <div className="flex gap-2">
              <input
                className="flex-1 border rounded-lg px-3 py-2 outline-none focus:ring"
                placeholder="Телефон / email / tg id / имя…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button
                className="px-3 py-2 rounded-lg bg-black text-white disabled:opacity-50"
                disabled={!canSearch || searching}
                onClick={search}
              >
                {searching ? "..." : "Найти"}
              </button>
            </div>

            <div className="mt-3 text-xs text-gray-500">
              Подсказка: введи минимум 2 символа и нажми Enter.
            </div>

            <div className="mt-4">
              <div className="text-sm font-medium mb-2">Результаты</div>

              {results?.length ? (
                <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                  {results.map((c) => {
                    const active = selected?.id === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => loadClient(c)}
                        className={[
                          "w-full text-left border rounded-lg p-3 hover:bg-gray-50",
                          active ? "border-black" : "border-gray-200",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">
                            {c.full_name || c.name || c.username || `Client #${c.id}`}
                          </div>
                          <div className="text-xs text-gray-500">ID: {c.id}</div>
                        </div>
                        <div className="text-sm text-gray-600 mt-1">
                          {c.phone ? `📞 ${c.phone}` : ""}
                          {c.email ? `  •  ✉️ ${c.email}` : ""}
                          {c.telegram_chat_id ? `  •  TG ${c.telegram_chat_id}` : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm text-gray-500">Пока пусто</div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: selected client */}
        <div className="lg:col-span-8">
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">Клиент</div>
                <div className="text-sm text-gray-600">
                  {selected
                    ? (selected.full_name || selected.name || selected.username || `Client #${selected.id}`)
                    : "Не выбран"}
                </div>
                {selected ? (
                  <div className="text-xs text-gray-500 mt-1">
                    ID: {selected.id}
                    {selected.phone ? ` • phone: ${selected.phone}` : ""}
                    {selected.telegram_chat_id ? ` • tg: ${selected.telegram_chat_id}` : ""}
                  </div>
                ) : null}
              </div>

              <div className="text-right">
                <div className="text-sm text-gray-500">Баланс</div>
                <div className="text-2xl font-semibold">
                  {loading ? "…" : `${money(balance)} сум`}
                </div>
              </div>
            </div>

            <div className="mt-4 border-t pt-4">
              <div className="font-medium mb-2">Корректировка</div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                <div className="md:col-span-3">
                  <input
                    className="w-full border rounded-lg px-3 py-2 outline-none focus:ring"
                    placeholder="amount (например 10000 или -10000)"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={!selected || saving}
                  />
                </div>

                <div className="md:col-span-3">
                  <select
                    className="w-full border rounded-lg px-3 py-2 outline-none focus:ring"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={!selected || saving}
                  >
                    <option value="admin_adjust">admin_adjust</option>
                    <option value="topup_manual">topup_manual</option>
                    <option value="refund">refund</option>
                    <option value="promo">promo</option>
                    <option value="fix_bug">fix_bug</option>
                  </select>
                </div>

                <div className="md:col-span-4">
                  <input
                    className="w-full border rounded-lg px-3 py-2 outline-none focus:ring"
                    placeholder="Комментарий (note)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    disabled={!selected || saving}
                  />
                </div>

                <div className="md:col-span-2">
                  <button
                    className="w-full px-3 py-2 rounded-lg bg-black text-white disabled:opacity-50"
                    disabled={!selected || saving}
                    onClick={() => adjust()}
                  >
                    {saving ? "…" : "Применить"}
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50"
                  disabled={!selected || saving}
                  onClick={() => adjust(10000)}
                >
                  +10 000
                </button>
                <button
                  className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50"
                  disabled={!selected || saving}
                  onClick={() => adjust(50000)}
                >
                  +50 000
                </button>
                <button
                  className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50"
                  disabled={!selected || saving}
                  onClick={() => adjust(100000)}
                >
                  +100 000
                </button>
                <button
                  className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50"
                  disabled={!selected || saving}
                  onClick={() => adjust(-10000)}
                >
                  −10 000
                </button>

                <button
                  className="ml-auto px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50"
                  disabled={!selected || loading}
                  onClick={() => loadClient(selected)}
                >
                  🔄 Обновить
                </button>
              </div>
            </div>

            <div className="mt-6 border-t pt-4">
              <div className="flex items-center justify-between">
                <div className="font-medium">История операций (ledger)</div>
                <div className="text-xs text-gray-500">
                  показываем последние {Math.min(ledger?.length || 0, 100)} записей
                </div>
              </div>

              <div className="mt-2 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-3">Дата</th>
                      <th className="py-2 pr-3">Сумма</th>
                      <th className="py-2 pr-3">Reason</th>
                      <th className="py-2 pr-3">Service</th>
                      <th className="py-2 pr-3">Source</th>
                      <th className="py-2 pr-3">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger?.length ? (
                      ledger.slice(0, 100).map((r) => (
                        <tr key={r.id || `${r.created_at}-${Math.random()}`} className="border-b">
                          <td className="py-2 pr-3 whitespace-nowrap">{fmtTs(r.created_at)}</td>
                          <td className="py-2 pr-3 whitespace-nowrap font-medium">
                            {sign(r.amount)}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">{r.reason || r.type || "—"}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {r.service_id ? `#${r.service_id}` : "—"}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">{r.source || "—"}</td>
                          <td className="py-2 pr-3">{r.note || (r.meta ? JSON.stringify(r.meta) : "—")}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="py-3 text-gray-500" colSpan={6}>
                          Нет операций
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-2 text-xs text-gray-500">
                Важно: корректировки лучше делать через ledger (а не напрямую править clients.contact_balance).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
