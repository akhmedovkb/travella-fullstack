//frontend/src/pages/admin/AdminContactBalance.jsx
  
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "../../api";
import { tError, tSuccess } from "../../shared/toast";
import { formatTiyinToSum, sumToTiyin } from "../../utils/money";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}


function fmtTs(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(ts);
  }
}

function fmtMs(ms) {
  if (!ms) return "—";
  try {
    return new Date(Number(ms)).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(ms);
  }
}

function sign(n) {
  const v = toNum(n);
  const abs = formatTiyinToSum(Math.abs(v));
  return v > 0 ? `+${abs}` : v < 0 ? `-${abs}` : abs;
}

function reasonLabel(reason) {
  const r = String(reason || "").toLowerCase();

  if (r === "topup") return "Topup";
  if (r === "refund") return "Refund";
  if (r === "unlock_contact") return "Unlock";
  if (r === "admin_adjust") return "Admin adjust";
  if (r === "topup_manual") return "Manual topup";
  if (r === "promo") return "Promo";
  if (r === "fix_bug") return "Fix bug";

  return reason || "—";
}

function paymeStateLabel(state) {
  const s = Number(state);
  if (s === 1) return "CREATED";
  if (s === 2) return "PERFORMED";
  if (s === -1) return "CANCELED";
  if (s === -2) return "CANCELED_AFTER_PERFORM";
  return String(state ?? "—");
}

function paymeStateClass(state) {
  const s = Number(state);
  if (s === 2) return "text-green-700";
  if (s === 1) return "text-yellow-700";
  if (s === -1 || s === -2) return "text-red-600";
  return "text-gray-700";
}

function StatCard({ title, value, tone = "default", subtitle = "" }) {
  const toneCls =
    tone === "green"
      ? "text-green-700"
      : tone === "red"
      ? "text-red-600"
      : tone === "yellow"
      ? "text-yellow-700"
      : "text-gray-900";

  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneCls}`}>{value}</div>
      {subtitle ? <div className="mt-1 text-xs text-gray-400">{subtitle}</div> : null}
    </div>
  );
}

export default function AdminContactBalance() {
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);

  const [selected, setSelected] = useState(null);

  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState([]);
  const [stats, setStats] = useState(null);
  const [paymeStats, setPaymeStats] = useState(null);
  const [paymeTx, setPaymeTx] = useState([]);

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
      const data = await apiGet(`/api/admin/clients/search?q=${encodeURIComponent(qq)}`, "admin");
      const items = Array.isArray(data) ? data : data?.items || data?.rows || [];
      setResults(items);
    } catch (e) {
      console.error(e);
      tError("Не удалось выполнить поиск клиентов");
    } finally {
      setSearching(false);
    }
  }

    async function loadClientById(clientId) {
    const id = Number(clientId);
    if (!Number.isFinite(id) || id <= 0) return;

    setLoading(true);
    try {
      const data = await apiGet(`/api/admin/clients/${id}/contact-balance`, "admin");

      const client = data?.client || { id };
      setSelected(client);
      setBalance(toNum(data?.balance || 0));
      setStats(data?.stats || null);
      setPaymeStats(data?.payme_stats || null);
      setLedger(Array.isArray(data?.ledger) ? data.ledger : []);
      setPaymeTx(Array.isArray(data?.payme_transactions) ? data.payme_transactions : []);
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить клиента по client_id");
    } finally {
      setLoading(false);
    }
  }

  async function loadClient(client) {
    if (!client?.id) return;

    setSelected(client);
    setLoading(true);

    try {
      const data = await apiGet(`/api/admin/clients/${client.id}/contact-balance`, "admin");

      setSelected(data?.client || client);
      setBalance(toNum(data?.balance || 0));
      setStats(data?.stats || null);
      setPaymeStats(data?.payme_stats || null);
      setLedger(Array.isArray(data?.ledger) ? data.ledger : []);
      setPaymeTx(Array.isArray(data?.payme_transactions) ? data.payme_transactions : []);
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить баланс клиента");
      setBalance(0);
      setStats(null);
      setPaymeStats(null);
      setLedger([]);
      setPaymeTx([]);
    } finally {
      setLoading(false);
    }
  }

  async function adjust(delta) {
    if (!selected?.id) return;

    const a = delta !== undefined ? toNum(delta) : toNum(amount);
    if (!a) {
      tError("Укажите сумму");
      return;
    }

    setSaving(true);
    try {
      await apiPost(
        `/api/admin/clients/${selected.id}/contact-balance/adjust`,
        {
          amount: a,
          reason: String(reason || "admin_adjust"),
          note: String(note || ""),
        },
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

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Enter" && canSearch) search();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSearch]);

    useEffect(() => {
    const qpClientId = String(searchParams.get("client_id") || "").trim();
    if (!qpClientId) return;
    loadClientById(qpClientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const fallbackStats = useMemo(() => {
    const rows = Array.isArray(ledger) ? ledger : [];

    let totalIn = 0;
    let totalOut = 0;
    let unlockCount = 0;
    let topupCount = 0;
    let refundCount = 0;
    let adminAdjustCount = 0;

    for (const r of rows) {
      const amt = toNum(r?.amount);
      const rsn = String(r?.reason || r?.type || "").toLowerCase();

      if (amt > 0) totalIn += amt;
      if (amt < 0) totalOut += Math.abs(amt);

      if (rsn === "unlock_contact") unlockCount += 1;
      if (rsn === "topup") topupCount += 1;
      if (rsn === "refund") refundCount += 1;
      if (rsn === "admin_adjust") adminAdjustCount += 1;
    }

    const topupSum = rows
      .filter((r) => String(r?.reason || "").toLowerCase() === "topup")
      .reduce((s, r) => s + toNum(r?.amount), 0);

    const refundSum = rows
      .filter((r) => String(r?.reason || "").toLowerCase() === "refund")
      .reduce((s, r) => s + Math.abs(toNum(r?.amount)), 0);

    const unlockSum = rows
      .filter((r) => String(r?.reason || "").toLowerCase() === "unlock_contact")
      .reduce((s, r) => s + Math.abs(toNum(r?.amount)), 0);

    const adminAdjustSum = rows
      .filter((r) => String(r?.reason || "").toLowerCase() === "admin_adjust")
      .reduce((s, r) => s + toNum(r?.amount), 0);

    const lastOperationAt = rows.length ? rows[0]?.created_at || null : null;

    return {
      total_in: totalIn,
      total_out: totalOut,
      unlock_count: unlockCount,
      topup_count: topupCount,
      refund_count: refundCount,
      admin_adjust_count: adminAdjustCount,
      topup_sum: topupSum,
      refund_sum: refundSum,
      unlock_sum: unlockSum,
      admin_adjust_sum: adminAdjustSum,
      last_operation_at: lastOperationAt,
      ledger_rows: rows.length,
    };
  }, [ledger]);

  const s = stats || fallbackStats;
  const p = paymeStats || {
    tx_count: 0,
    created_count: 0,
    performed_count: 0,
    canceled_count: 0,
    performed_sum: 0,
    canceled_sum: 0,
    last_payme_time: null,
  };

  const selectedTitle = selected
    ? selected.full_name || selected.name || selected.username || `Client #${selected.id}`
    : "Не выбран";

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Clients</h1>
        <p className="text-sm text-gray-500">
          Одна рабочая страница по клиенту: balance, ledger, Payme transactions и корректировки.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4 space-y-4">
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
              Минимум 2 символа. Можно искать по телефону, email, tg id, имени.
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <div className="text-sm font-medium mb-3">Результаты</div>

            {results?.length ? (
              <div className="space-y-2 max-h-[560px] overflow-auto pr-1">
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
                        {c.email ? ` • ✉️ ${c.email}` : ""}
                        {c.telegram_chat_id ? ` • TG ${c.telegram_chat_id}` : ""}
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

        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-sm text-gray-500">Клиент</div>
                <div className="text-xl font-semibold">{selectedTitle}</div>

                {selected ? (
                  <div className="mt-2 text-sm text-gray-600 space-y-1">
                    <div>ID: {selected.id}</div>
                    <div>{selected.phone ? `Телефон: ${selected.phone}` : "Телефон: —"}</div>
                    <div>{selected.email ? `Email: ${selected.email}` : "Email: —"}</div>
                    <div>
                      {selected.telegram_chat_id
                        ? `Telegram: ${selected.telegram_chat_id}`
                        : "Telegram: —"}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-gray-500">Выбери клиента слева.</div>
                )}
              </div>

              <div className="text-right">
                <div className="text-sm text-gray-500">Текущий баланс</div>
                <div className="text-3xl font-semibold">
                  {loading ? "…" : `${formatTiyinToSum(balance)} сум`}
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  last operation: {fmtTs(s?.last_operation_at)}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              title="Total in"
              value={formatTiyinToSum(s?.total_in)}
              tone="green"
              subtitle={`topups: ${toNum(s?.topup_count)}`}
            />
            <StatCard
              title="Total out"
              value={formatTiyinToSum(s?.total_out)}
              tone="red"
              subtitle="refunds + unlocks + debits"
            />
            <StatCard
              title="Unlocks"
              value={String(toNum(s?.unlock_count))}
              subtitle={`sum: ${formatTiyinToSum(s?.unlock_sum)} сум`}
            />
            <StatCard
              title="Refunds"
              value={String(toNum(s?.refund_count))}
              subtitle={`sum: ${formatTiyinToSum(s?.refund_sum)} сум`}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              title="Topups"
              value={String(toNum(s?.topup_count))}
              subtitle={`sum: ${formatTiyinToSum(s?.topup_sum)} сум`}
            />
            <StatCard
              title="Admin adjust"
              value={String(toNum(s?.admin_adjust_count))}
              subtitle={`net: ${formatTiyinToSum(s?.admin_adjust_sum)} сум`}
            />
            <StatCard
              title="Ledger rows"
              value={String(toNum(s?.ledger_rows))}
            />
            <StatCard
              title="Mirror balance"
              value={formatTiyinToSum(balance)}
              subtitle="clients.contact_balance"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              title="Payme tx"
              value={String(toNum(p?.tx_count))}
              subtitle={`last: ${fmtMs(p?.last_payme_time)}`}
            />
            <StatCard
              title="Performed"
              value={String(toNum(p?.performed_count))}
              tone="green"
              subtitle={`sum: ${formatTiyinToSum(p?.performed_sum)} сум`}
            />
            <StatCard
              title="Created"
              value={String(toNum(p?.created_count))}
              tone="yellow"
            />
            <StatCard
              title="Canceled"
              value={String(toNum(p?.canceled_count))}
              tone="red"
              subtitle={`sum: ${formatTiyinToSum(p?.canceled_sum)} сум`}
            />
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <div className="font-medium mb-3">Быстрая корректировка</div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
              <div className="md:col-span-3">
                <input
                  className="w-full border rounded-lg px-3 py-2 outline-none focus:ring"
                  placeholder="amount в сумах, например 10000"
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
                  placeholder="Комментарий"
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
                className="px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50"
                disabled={!selected || saving}
                onClick={() => adjust(-50000)}
              >
                −50 000
              </button>

              <button
                className="ml-auto px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-50"
                disabled={!selected || loading}
                onClick={() => loadClient(selected)}
              >
                🔄 Обновить
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-500">
              Корректировки делай через ledger, а не прямым изменением `clients.contact_balance`.
            </div>
          </div>

          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="p-3 border-b flex items-center justify-between">
              <div className="text-sm font-medium">Payme transactions</div>
              <div className="text-xs text-gray-400">
                последние {Math.min(paymeTx?.length || 0, 100)} записей
              </div>
            </div>

            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2">payme_id</th>
                    <th className="text-left px-3 py-2">order_id</th>
                    <th className="text-left px-3 py-2">amount</th>
                    <th className="text-left px-3 py-2">state</th>
                    <th className="text-left px-3 py-2">order_status</th>
                    <th className="text-left px-3 py-2">create</th>
                    <th className="text-left px-3 py-2">perform</th>
                    <th className="text-left px-3 py-2">cancel</th>
                    <th className="text-left px-3 py-2">tools</th>
                  </tr>
                </thead>
                <tbody>
                  {paymeTx?.length ? (
                    paymeTx.map((r, idx) => (
                      <tr key={`${r.payme_id}_${idx}`} className="border-t">
                        <td className="px-3 py-2 break-all">{r.payme_id}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.order_id}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatTiyinToSum(r.amount_tiyin)} сум</td>
                        <td className={`px-3 py-2 whitespace-nowrap font-medium ${paymeStateClass(r.state)}`}>
                          {paymeStateLabel(r.state)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.order_status || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtMs(r.create_time)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtMs(r.perform_time)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{fmtMs(r.cancel_time)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex gap-2">
                          
                          <button
                          className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                          onClick={() =>
                          window.open(
                          `/admin/payme-health?payme_id=${encodeURIComponent(r.payme_id)}`,
                          "_blank"
                          )
                          }
                          >
                          🔎 Health
                          </button>
                          
                          <button
                          className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
                          onClick={() =>
                          window.open(
                          `/admin/payme-lab?seed_payme_id=${encodeURIComponent(r.payme_id)}`,
                          "_blank"
                          )
                          }
                          >
                          🧪 Lab
                          </button>
                          
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-3 py-6 text-gray-500 text-center" colSpan={8}>
                        Нет Payme transactions
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="p-3 border-b flex items-center justify-between">
              <div className="text-sm font-medium">Ledger клиента</div>
              <div className="text-xs text-gray-400">
                последние {Math.min(ledger?.length || 0, 200)} записей
              </div>
            </div>

            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2">Дата</th>
                    <th className="text-left px-3 py-2">Сумма</th>
                    <th className="text-left px-3 py-2">Reason</th>
                    <th className="text-left px-3 py-2">Service</th>
                    <th className="text-left px-3 py-2">Source</th>
                    <th className="text-left px-3 py-2">Note / Meta</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger?.length ? (
                    ledger.slice(0, 200).map((r, idx) => (
                      <tr key={r.id || `${r.created_at}-${idx}`} className="border-t">
                        <td className="px-3 py-2 whitespace-nowrap">{fmtTs(r.created_at)}</td>
                        <td
                          className={`px-3 py-2 whitespace-nowrap font-medium ${
                            toNum(r.amount) < 0 ? "text-red-600" : "text-green-700"
                          }`}
                        >
                          {sign(r.amount)} сум
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {reasonLabel(r.reason || r.type)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.service_id ? `#${r.service_id}` : "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.source || "—"}</td>
                        <td className="px-3 py-2">
                          {r.note || (r.meta ? JSON.stringify(r.meta) : "—")}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="px-3 py-6 text-gray-500 text-center" colSpan={6}>
                        Нет операций
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
