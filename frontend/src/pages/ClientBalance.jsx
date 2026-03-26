// frontend/src/pages/ClientBalance.jsx
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api";
import { tError, tSuccess } from "../shared/toast";

function moneySum(n) {
  return Math.round(Number(n || 0)).toLocaleString("ru-RU");
}

function moneyTiyin(n) {
  return Math.round(Number(n || 0) / 100).toLocaleString("ru-RU");
}

function fmtTs(x) {
  if (!x) return "—";
  try {
    return new Date(x).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" });
  } catch {
    return String(x);
  }
}

const PRESETS = [25000, 50000, 100000, 200000];

export default function ClientBalance() {
  const [balance, setBalance] = useState(0);
  const [unlockPrice, setUnlockPrice] = useState(10000);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(false);
  const [topupLoading, setTopupLoading] = useState(false);
  const [customAmount, setCustomAmount] = useState("");

  async function loadAll() {
    setLoading(true);
    try {
      const [bal, led] = await Promise.all([
        apiGet("/api/client/balance", "client"),
        apiGet("/api/client/balance/ledger?limit=50", "client"),
      ]);

      setBalance(Number(bal?.balance || 0));
      setUnlockPrice(Number(bal?.unlock_price || 10000));
      setLedger(Array.isArray(led?.rows) ? led.rows : []);
    } catch (e) {
      console.error(e);
      tError("Не удалось загрузить баланс");
    } finally {
      setLoading(false);
    }
  }

  async function doTopup(amount) {
    const sum = Math.trunc(Number(amount || 0));
    if (!Number.isFinite(sum) || sum <= 0) {
      return tError("Укажи корректную сумму");
    }

    setTopupLoading(true);
    try {
      const data = await apiPost(
        "/api/client/balance/topup-order",
        { amount: sum },
        "client"
      );

      if (!data?.pay_url) {
        throw new Error("pay_url not returned");
      }

      tSuccess(`Заказ на пополнение создан: ${moneySum(sum)} сум`);
      window.location.href = data.pay_url;
    } catch (e) {
      console.error(e);
      tError(e?.message || "Не удалось создать заказ Payme");
    } finally {
      setTopupLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div className="bg-white rounded-2xl shadow p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Баланс клиента</h1>
            <p className="text-sm text-gray-500 mt-1">
              Пополнение через Payme и списание за открытие контактов
            </p>
          </div>

          <button
            className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50"
            onClick={loadAll}
            disabled={loading}
          >
            {loading ? "Загрузка…" : "Обновить"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div className="rounded-2xl bg-gray-50 border p-5">
            <div className="text-sm text-gray-500">Текущий баланс</div>
            <div className="mt-2 text-3xl font-semibold">{moneyTiyin(balance)} сум</div>
          </div>

          <div className="rounded-2xl bg-gray-50 border p-5">
            <div className="text-sm text-gray-500">Цена открытия контактов</div>
            <div className="mt-2 text-3xl font-semibold">{moneySum(unlockPrice)} сум</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Пополнить баланс</h2>
          <p className="text-sm text-gray-500 mt-1">
            Выбери сумму или введи свою
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {PRESETS.map((v) => (
            <button
              key={v}
              className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-60"
              onClick={() => doTopup(v)}
              disabled={topupLoading}
            >
              {moneySum(v)} сум
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <input
            className="flex-1 border rounded-xl px-4 py-3"
            value={customAmount}
            onChange={(e) => setCustomAmount(e.target.value)}
            placeholder="Своя сумма, например 75000"
          />
          <button
            className="px-5 py-3 rounded-xl bg-black text-white disabled:opacity-60"
            onClick={() => doTopup(customAmount)}
            disabled={topupLoading}
          >
            {topupLoading ? "Создание…" : "Оплатить через Payme"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">История операций</h2>
          <div className="text-sm text-gray-500">{ledger.length} записей</div>
        </div>

        {!ledger.length ? (
          <div className="text-sm text-gray-400">Операций пока нет</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Дата</th>
                  <th className="py-2 pr-4">Сумма</th>
                  <th className="py-2 pr-4">Причина</th>
                  <th className="py-2 pr-4">Источник</th>
                  <th className="py-2 pr-4">Service ID</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0 align-top">
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <div>{fmtTs(row.created_at)}</div>
                      {row.fiscal_received_at ? (
                        <div className="mt-1 text-xs text-gray-400">
                          Фискализация: {fmtTs(row.fiscal_received_at)}
                        </div>
                      ) : null}
                    </td>
                
                    <td
                      className={`py-3 pr-4 whitespace-nowrap font-medium ${
                        Number(row.amount) < 0 ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {Number(row.amount) > 0 ? "+" : ""}
                      {moneyTiyin(row.amount)} сум
                    </td>
                
                    <td className="py-3 pr-4">
                      <div>{row.reason || "—"}</div>
                      {row.fiscal_receipt_id ? (
                        <div className="mt-1 text-xs text-gray-500">
                          Чек: <span className="font-mono">{row.fiscal_receipt_id}</span>
                        </div>
                      ) : null}
                      {row.fiscal_sign ? (
                        <div className="mt-1 text-xs text-gray-400">
                          Fiscal sign: <span className="font-mono">{row.fiscal_sign}</span>
                        </div>
                      ) : null}
                    </td>
                
                    <td className="py-3 pr-4">
                      <div>{row.source || "—"}</div>
                      {row.fiscal_terminal_id ? (
                        <div className="mt-1 text-xs text-gray-400">
                          Terminal: <span className="font-mono">{row.fiscal_terminal_id}</span>
                        </div>
                      ) : null}
                    </td>
                
                    <td className="py-3 pr-4">{row.service_id || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
