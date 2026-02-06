// frontend/src/pages/admin/DonasDosasMonthlySalesMargin.jsx
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../../api";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function money(n) {
  return Math.round(toNum(n)).toLocaleString("ru-RU");
}

function pct(v) {
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function ymNow() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}`;
}

function ymFromDateLike(x) {
  const s = String(x || "");
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return "";
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

export default function DonasDosasMonthlySalesMargin() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [month, setMonth] = useState(ymNow());
  const [sales, setSales] = useState([]);

  const [months, setMonths] = useState([]); // finance months (for locked flag)

  const locked = useMemo(() => {
    const ym = String(month || "");
    const m = (months || []).find((x) => ymFromDateLike(x.month) === ym);
    return m ? hasLockedTag(m.notes) : false;
  }, [months, month]);

  const load = async () => {
    if (month && !isYm(month)) return;

    setLoading(true);
    setErr("");
    try {
      const [rows, ms] = await Promise.all([
        apiGet(`/api/admin/donas/sales?month=${encodeURIComponent(month)}`),
        apiGet("/api/admin/donas/finance/months"),
      ]);

      setSales(Array.isArray(rows) ? rows : []);
      const arr = Array.isArray(ms) ? ms : Array.isArray(ms?.months) ? ms.months : [];
      setMonths(arr);
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || "Failed to load monthly sales margin");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const totals = useMemo(() => {
    const revenue = (sales || []).reduce((s, r) => s + toNum(r.revenue_total), 0);
    const cogs = (sales || []).reduce((s, r) => s + toNum(r.cogs_total), 0);
    const profit = revenue - cogs;
    const margin = revenue > 0 ? (profit / revenue) * 100 : NaN;

    const count = (sales || []).length;
    const qty = (sales || []).reduce((s, r) => s + toNum(r.qty), 0);

    return { revenue, cogs, profit, margin, count, qty };
  }, [sales]);

  const byItem = useMemo(() => {
    const map = new Map();

    (sales || []).forEach((r) => {
      const id = String(r.menu_item_id ?? "—");
      const name = r.menu_item_name || "—";

      const cur = map.get(id) || {
        menu_item_id: id,
        menu_item_name: name,
        qty: 0,
        revenue: 0,
        cogs: 0,
      };

      cur.qty += toNum(r.qty);
      cur.revenue += toNum(r.revenue_total);
      cur.cogs += toNum(r.cogs_total);

      map.set(id, cur);
    });

    const arr = Array.from(map.values()).map((x) => {
      const profit = x.revenue - x.cogs;
      const margin = x.revenue > 0 ? (profit / x.revenue) * 100 : NaN;
      return { ...x, profit, margin };
    });

    arr.sort((a, b) => b.revenue - a.revenue);
    return arr;
  }, [sales]);

  const byDay = useMemo(() => {
    const map = new Map();

    (sales || []).forEach((r) => {
      const d = String(r.sold_at || "").slice(0, 10); // YYYY-MM-DD
      if (!d) return;

      const cur = map.get(d) || { day: d, qty: 0, revenue: 0, cogs: 0 };
      cur.qty += toNum(r.qty);
      cur.revenue += toNum(r.revenue_total);
      cur.cogs += toNum(r.cogs_total);
      map.set(d, cur);
    });

    const arr = Array.from(map.values()).map((x) => {
      const profit = x.revenue - x.cogs;
      const margin = x.revenue > 0 ? (profit / x.revenue) * 100 : NaN;
      return { ...x, profit, margin };
    });

    arr.sort((a, b) => String(a.day).localeCompare(String(b.day)));
    return arr;
  }, [sales]);

  return (
    <div className="rounded-2xl bg-white border border-gray-200 p-5 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-xl font-semibold">Monthly Sales Margin</div>
          <div className="text-sm text-gray-600">
            Агрегация из Sales за месяц (Revenue / COGS / Profit / Margin). {locked ? "Месяц locked." : ""}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-50"
            onClick={load}
            disabled={loading}
          >
            Обновить
          </button>
        </div>
      </div>

      {err && (
        <div className="p-3 rounded-xl bg-red-50 text-red-700 border border-red-200">{err}</div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-sm font-medium text-gray-700">Month (YYYY-MM)</div>
        <input
          className="border rounded-lg px-3 py-2 text-sm"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          placeholder="YYYY-MM"
        />

        {locked && (
          <span className="text-xs px-2 py-1 rounded-full border bg-white">
            locked (#locked)
          </span>
        )}

        <div className="ml-auto text-sm text-gray-700 flex items-center gap-3 flex-wrap">
          <span>
            Revenue: <b>{money(totals.revenue)}</b>
          </span>
          <span>
            COGS: <b>{money(totals.cogs)}</b>
          </span>
          <span>
            Profit: <b>{money(totals.profit)}</b>
          </span>
          <span>
            Margin: <b>{pct(totals.margin)}</b>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-gray-200 p-4">
          <div className="text-sm font-medium text-gray-900">Summary</div>
          <div className="mt-3 space-y-2 text-sm text-gray-700">
            <div className="flex justify-between">
              <span>Sales rows</span>
              <b>{totals.count}</b>
            </div>
            <div className="flex justify-between">
              <span>Total qty</span>
              <b>{money(totals.qty)}</b>
            </div>
            <div className="flex justify-between">
              <span>Avg margin</span>
              <b>{pct(totals.margin)}</b>
            </div>
          </div>

          <div className="mt-4 text-xs text-gray-500">
            Источник: <code>donas_sales</code>. COGS берётся из снапшота продажи (<code>cogs_unit</code>/<code>cogs_total</code>).
          </div>
        </div>

        <div className="lg:col-span-2 rounded-2xl border border-gray-200 p-4">
          <div className="text-sm font-medium text-gray-900">By menu item</div>

          <div className="overflow-x-auto mt-3">
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 border-b">
                  <th className="py-2 pr-4">Item</th>
                  <th className="py-2 pr-4 text-right">Qty</th>
                  <th className="py-2 pr-4 text-right">Revenue</th>
                  <th className="py-2 pr-4 text-right">COGS</th>
                  <th className="py-2 pr-4 text-right">Profit</th>
                  <th className="py-2 pr-4 text-right">Margin %</th>
                </tr>
              </thead>
              <tbody>
                {byItem.map((r) => (
                  <tr key={r.menu_item_id} className="border-b last:border-b-0">
                    <td className="py-2 pr-4">
                      <div className="font-medium text-gray-900">{r.menu_item_name}</div>
                      <div className="text-xs text-gray-500">#{r.menu_item_id}</div>
                    </td>
                    <td className="py-2 pr-4 text-right">{money(r.qty)}</td>
                    <td className="py-2 pr-4 text-right">{money(r.revenue)}</td>
                    <td className="py-2 pr-4 text-right">{money(r.cogs)}</td>
                    <td className="py-2 pr-4 text-right font-semibold">{money(r.profit)}</td>
                    <td className="py-2 pr-4 text-right">{pct(r.margin)}</td>
                  </tr>
                ))}

                {!byItem.length && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-gray-500">
                      Нет продаж за этот месяц.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 p-4">
        <div className="text-sm font-medium text-gray-900">By day</div>

        <div className="overflow-x-auto mt-3">
          <table className="min-w-[900px] w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b">
                <th className="py-2 pr-4">Day</th>
                <th className="py-2 pr-4 text-right">Qty</th>
                <th className="py-2 pr-4 text-right">Revenue</th>
                <th className="py-2 pr-4 text-right">COGS</th>
                <th className="py-2 pr-4 text-right">Profit</th>
                <th className="py-2 pr-4 text-right">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((r) => (
                <tr key={r.day} className="border-b last:border-b-0">
                  <td className="py-2 pr-4">{r.day}</td>
                  <td className="py-2 pr-4 text-right">{money(r.qty)}</td>
                  <td className="py-2 pr-4 text-right">{money(r.revenue)}</td>
                  <td className="py-2 pr-4 text-right">{money(r.cogs)}</td>
                  <td className="py-2 pr-4 text-right font-semibold">{money(r.profit)}</td>
                  <td className="py-2 pr-4 text-right">{pct(r.margin)}</td>
                </tr>
              ))}

              {!byDay.length && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-500">
                    Нет продаж за этот месяц.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          Дальше сюда можно добавить “каналы” (cash/card/delivery) и “скидки”.
        </div>
      </div>
    </div>
  );
}
