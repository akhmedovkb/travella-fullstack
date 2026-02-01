import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n) {
  const v = Math.round(toNum(n));
  return v.toLocaleString("ru-RU");
}

function normalizeYm(v) {
  // input[type=month] => "YYYY-MM" or ""
  if (!v) return "";
  return String(v).slice(0, 7);
}

export default function DonasDosasFinanceAdjustments() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [rows, setRows] = useState([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const [fMonth, setFMonth] = useState("");
  const [fKind, setFKind] = useState("in");
  const [fAmount, setFAmount] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fNotes, setFNotes] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError(null);

      const q = new URLSearchParams();
      if (normalizeYm(from)) q.set("from", normalizeYm(from));
      if (normalizeYm(to)) q.set("to", normalizeYm(to));

      const res = await apiGet(`/api/admin/donas/finance/adjustments?${q.toString()}`);
      setRows(Array.isArray(res?.rows) ? res.rows : []);
    } catch (e) {
      setError(e?.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const ym = r?.ym || "";
      if (!m.has(ym)) m.set(ym, []);
      m.get(ym).push(r);
    }
    // sort groups newest first
    const keys = Array.from(m.keys()).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    return keys.map((k) => ({ ym: k, items: m.get(k) }));
  }, [rows]);

  const totalsByYm = useMemo(() => {
    const m = {};
    for (const r of rows) {
      const ym = r?.ym || "";
      const sign = r?.kind === "out" ? -1 : 1;
      m[ym] = (m[ym] || 0) + sign * toNum(r?.amount);
    }
    return m;
  }, [rows]);

  function openCreate() {
    setEditing(null);
    setFMonth("");
    setFKind("in");
    setFAmount("");
    setFTitle("");
    setFNotes("");
    setIsModalOpen(true);
  }

  function openEdit(r) {
    setEditing(r);
    setFMonth(r?.ym || "");
    setFKind(r?.kind || "in");
    setFAmount(String(r?.amount ?? ""));
    setFTitle(r?.title || "");
    setFNotes(r?.notes || "");
    setIsModalOpen(true);
  }

  async function save() {
    try {
      setError(null);

      const ym = normalizeYm(fMonth);
      if (!ym) {
        setError("Выберите месяц");
        return;
      }

      const amount = toNum(fAmount);
      if (amount < 0) {
        setError("Сумма не может быть отрицательной");
        return;
      }

      const payload = {
        month: ym,
        kind: fKind === "out" ? "out" : "in",
        amount,
        title: String(fTitle || "").trim(),
        notes: String(fNotes || "").trim(),
      };

      if (editing?.id) {
        await apiPut(`/api/admin/donas/finance/adjustments/${editing.id}`, payload);
      } else {
        await apiPost(`/api/admin/donas/finance/adjustments`, payload);
      }

      setIsModalOpen(false);
      await load();
    } catch (e) {
      // locked month comes as 409 from backend
      setError(e?.message || "Не удалось сохранить");
    }
  }

  async function remove(r) {
    if (!r?.id) return;
    // eslint-disable-next-line no-alert
    if (!confirm("Удалить корректировку?")) return;

    try {
      setError(null);
      await apiDelete(`/api/admin/donas/finance/adjustments/${r.id}`);
      await load();
    } catch (e) {
      setError(e?.message || "Не удалось удалить");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Dona’s Dosas — Adjustments</h2>
          <p className="text-sm text-gray-500">
            Ручные корректировки cashflow (вход / расход). Сумма всегда ≥ 0; направление задаётся полем kind.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            В locked-месяцах корректировки запрещены (Unlock или Re-snapshot).
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
            disabled={loading}
          >
            Refresh
          </button>
          <button
            onClick={openCreate}
            className="px-3 py-2 rounded-lg bg-black text-white hover:bg-gray-800"
          >
            + Add
          </button>
        </div>
      </div>

      <div className="p-4 rounded-2xl border bg-white">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-gray-500 mb-1">From</div>
            <input
              type="month"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">To</div>
            <input
              type="month"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded-lg px-3 py-2"
            />
          </div>
          <button
            onClick={load}
            className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
            disabled={loading}
          >
            Apply
          </button>
        </div>

        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

        <div className="mt-4">
          {loading ? (
            <div className="text-sm text-gray-500">Загрузка…</div>
          ) : grouped.length === 0 ? (
            <div className="text-sm text-gray-500">Нет корректировок по фильтру.</div>
          ) : (
            <div className="space-y-6">
              {grouped.map((g) => (
                <div key={g.ym} className="border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                    <div className="font-medium">{g.ym}</div>
                    <div className="text-sm text-gray-600">
                      Net: <span className="font-semibold">{fmtMoney(totalsByYm[g.ym] || 0)}</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-xs text-gray-500">
                        <tr className="border-b">
                          <th className="text-left px-4 py-3">Kind</th>
                          <th className="text-right px-4 py-3">Amount</th>
                          <th className="text-left px-4 py-3">Title</th>
                          <th className="text-left px-4 py-3">Notes</th>
                          <th className="text-right px-4 py-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.items.map((r) => (
                          <tr key={r.id} className="border-b last:border-b-0">
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${
                                  r.kind === "out" ? "bg-red-50 border-red-200 text-red-700" : "bg-green-50 border-green-200 text-green-700"
                                }`}
                              >
                                {r.kind === "out" ? "out" : "in"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {r.kind === "out" ? "−" : "+"}
                              {fmtMoney(r.amount)}
                            </td>
                            <td className="px-4 py-3">{r.title || "—"}</td>
                            <td className="px-4 py-3 text-gray-600">{r.notes || "—"}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex gap-2">
                                <button
                                  onClick={() => openEdit(r)}
                                  className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => remove(r)}
                                  className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white border shadow-lg overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div className="font-semibold">{editing ? "Edit adjustment" : "New adjustment"}</div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Month</div>
                  <input
                    type="month"
                    value={fMonth}
                    onChange={(e) => setFMonth(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Kind</div>
                  <select
                    value={fKind}
                    onChange={(e) => setFKind(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="in">in (cash in)</option>
                    <option value="out">out (cash out)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Amount</div>
                  <input
                    type="number"
                    value={fAmount}
                    onChange={(e) => setFAmount(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    min="0"
                    step="1"
                  />
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Title</div>
                  <input
                    type="text"
                    value={fTitle}
                    onChange={(e) => setFTitle(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2"
                    placeholder="Например: возврат / штраф / разовый расход"
                  />
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Notes</div>
                <textarea
                  value={fNotes}
                  onChange={(e) => setFNotes(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 min-h-[90px]"
                />
              </div>

              {error ? <div className="text-sm text-red-600">{error}</div> : null}

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  className="px-4 py-2 rounded-lg bg-black text-white hover:bg-gray-800"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
