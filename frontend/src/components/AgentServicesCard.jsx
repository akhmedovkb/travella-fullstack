import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { tSuccess, tError, tWarn, tInfo } from "../shared/toast";

/**
 * Прайс-лист турагента для Tour Builder
 *
 * Категории:
 *  - guide     — услуги гида (цена за день)
 *  - transport — транспорт (цена за день или за трансфер; поле seats)
 *  - hotel     — отель (цена за ночь, нетто)
 *  - entry     — входные билеты/объекты (цена за вход)
 *
 * API (предложение по контрактах):
 *  GET  /api/agents/tb-services               -> [{ id, category, name, city, pax, price, currency, enabled }]
 *  POST /api/agents/tb-services               -> body row, return created row
 *  PUT  /api/agents/tb-services/:id           -> body patch, return updated row
 *  DELETE /api/agents/tb-services/:id         -> 204
 *  POST /api/agents/tb-services/publish       -> { inserted: number }  // выгрузка в TourBuilder
 *
 * Если у вас другой роутинг — передайте через props: basePath (например, "/api/providers/...")
 */

const CATEGORIES = [
  { value: "guide", label: "Гид" },
  { value: "transport", label: "Транспорт" },
  { value: "hotel", label: "Отель (ночь, нетто)" },
  { value: "entry", label: "Входные билеты (объекты)" },
];

const DEFAULT_NEW = (currencyDefault) => ({
  category: "",
  name: "",
  city: "",
  pax: "",       // для транспорта (мест)
  price: "",
  currency: currencyDefault || "UZS",
  enabled: true,
});

function onlyDigits(s) {
  return String(s || "").replace(/[^\d]/g, "");
}
function parseMoney(s) {
  if (s === "" || s == null) return NaN;
  const x = String(s).replace(/\s+/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(x);
  return Number.isFinite(n) ? n : NaN;
}

export default function AgentServicesCard({
  agentId,
  currencyDefault = "UZS",
  basePath = "/api/agents/tb-services",
}) {
  const api = useMemo(() => {
    const instance = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL });
    instance.interceptors.request.use((cfg) => {
      const tok = localStorage.getItem("token");
      if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
      return cfg;
    });
    return instance;
  }, []);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState(() => DEFAULT_NEW(currencyDefault));

  const loadRows = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(basePath, { params: { agentId } });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      tError("Не удалось загрузить прайс-лист турагента");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRows(); /* eslint-disable-next-line */ }, [agentId, basePath]);

  const filtered = rows.filter((r) =>
    !filter || r.category === filter
  );

  const addRow = async () => {
    if (!draft.category) return tWarn("Выберите категорию");
    if (!draft.name.trim()) return tWarn("Укажите название услуги");
    if (draft.category !== "entry" && !draft.city.trim() && draft.category !== "hotel") {
      // для guide/transport часто важен город; для hotel — не обязателен (можно в name)
      tInfo("Рекомендуется указать город");
    }
    if (draft.category === "transport" && !draft.pax) {
      return tWarn("Укажите количество мест (пассажиров)");
    }
    const priceNum = parseMoney(draft.price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return tWarn("Введите корректную цену");
    }

    setCreating(true);
    try {
      const body = {
        ...draft,
        agentId,
        pax: draft.category === "transport" ? Number(onlyDigits(draft.pax)) : null,
        price: priceNum,
        enabled: !!draft.enabled,
      };
      const { data } = await api.post(basePath, body);
      setRows((prev) => [...prev, data]);
      setDraft(DEFAULT_NEW(currencyDefault));
      tSuccess("Добавлено");
    } catch (e) {
      tError("Не удалось добавить запись");
    } finally {
      setCreating(false);
    }
  };

  const upRow = async (id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      await api.put(`${basePath}/${id}`, patch);
    } catch {
      tError("Не удалось сохранить изменения");
      loadRows();
    }
  };

  const delRow = async (id) => {
    const ok = confirm("Удалить запись?");
    if (!ok) return;
    const old = rows;
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await api.delete(`${basePath}/${id}`);
      tSuccess("Удалено");
    } catch {
      tError("Не удалось удалить");
      setRows(old);
    }
  };

  const publish = async () => {
    if (!rows.length) return tWarn("Сначала добавьте хотя бы одну услугу");
    setPublishing(true);
    try {
      const { data } = await api.post(`${basePath}/publish`, { agentId });
      tSuccess(
        typeof data?.inserted === "number"
          ? `Отправлено в конструктор: ${data.inserted}`
          : "Отправлено в конструктор"
      );
    } catch (e) {
      tError("Не удалось отправить в Конструктор тура");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="rounded-xl border bg-white p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Услуги для Tour Builder (агент)</h3>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border rounded px-2 py-1 bg-white"
          >
            <option value="">Все категории</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <button
            onClick={publish}
            className="rounded bg-orange-600 text-white px-3 py-2 disabled:opacity-60"
            disabled={publishing}
            title="Отправить текущий прайс в Конструктор тура"
          >
            {publishing ? "Отправка…" : "Сгенерировать в конструктор"}
          </button>
        </div>
      </div>

      {/* Таблица */}
      <div className="w-full overflow-x-auto">
        <table className="min-w-[760px] w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="pb-2 pr-3">Категория</th>
              <th className="pb-2 pr-3">Название</th>
              <th className="pb-2 pr-3">Город</th>
              <th className="pb-2 pr-3">Мест</th>
              <th className="pb-2 pr-3">Цена</th>
              <th className="pb-2 pr-3">Валюта</th>
              <th className="pb-2 pr-3">Статус</th>
              <th className="pb-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="py-4 text-center">Загрузка…</td></tr>
            ) : filtered.length ? (
              filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-3">
                    <select
                      value={r.category}
                      onChange={(e) => upRow(r.id, { category: e.target.value })}
                      className="border rounded px-2 py-1 bg-white"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={r.name || ""}
                      onChange={(e) => upRow(r.id, { name: e.target.value })}
                      className="border rounded px-2 py-1 w-56"
                      placeholder="например, city tour Samarkand"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={r.city || ""}
                      onChange={(e) => upRow(r.id, { city: e.target.value })}
                      className="border rounded px-2 py-1 w-40"
                      placeholder="Город"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={r.pax ?? ""}
                      onChange={(e) => upRow(r.id, { pax: Number(onlyDigits(e.target.value)) || "" })}
                      className="border rounded px-2 py-1 w-16 text-center"
                      placeholder="—"
                      inputMode="numeric"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={r.price ?? ""}
                      onChange={(e) => upRow(r.id, { price: e.target.value })}
                      className="border rounded px-2 py-1 w-32"
                      placeholder="0.00"
                      inputMode="decimal"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={r.currency || currencyDefault}
                      onChange={(e) => upRow(r.id, { currency: e.target.value })}
                      className="border rounded px-2 py-1 bg-white"
                    >
                      {["UZS", "USD", "EUR", "RUB"].map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => upRow(r.id, { enabled: !r.enabled })}
                      className={`px-2 py-1 rounded text-xs ${
                        r.enabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {r.enabled ? "Включена" : "Выключена"}
                    </button>
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => delRow(r.id)}
                      className="text-red-600 hover:underline"
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={8} className="py-4 text-center text-gray-500">Пока пусто</td></tr>
            )}

            {/* строка добавления */}
            <tr className="border-t bg-orange-50/40">
              <td className="py-2 pr-3">
                <select
                  value={draft.category}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                  className="border rounded px-2 py-1 bg-white"
                >
                  <option value="">— выбрать —</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-3">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  className="border rounded px-2 py-1 w-56"
                  placeholder="Название услуги…"
                />
              </td>
              <td className="py-2 pr-3">
                <input
                  value={draft.city}
                  onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
                  className="border rounded px-2 py-1 w-40"
                  placeholder="Город"
                />
              </td>
              <td className="py-2 pr-3">
                <input
                  value={draft.pax}
                  onChange={(e) => setDraft((d) => ({ ...d, pax: onlyDigits(e.target.value) }))}
                  className="border rounded px-2 py-1 w-16 text-center"
                  placeholder="—"
                  inputMode="numeric"
                />
              </td>
              <td className="py-2 pr-3">
                <input
                  value={draft.price}
                  onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                  className="border rounded px-2 py-1 w-32"
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </td>
              <td className="py-2 pr-3">
                <select
                  value={draft.currency}
                  onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}
                  className="border rounded px-2 py-1 bg-white"
                >
                  {["UZS", "USD", "EUR", "RUB"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-3">
                <button
                  onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
                  className={`px-2 py-1 rounded text-xs ${
                    draft.enabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {draft.enabled ? "Включена" : "Выключена"}
                </button>
              </td>
              <td className="py-2">
                <button
                  onClick={addRow}
                  className="rounded bg-orange-600 text-white px-3 py-1.5 disabled:opacity-60"
                  disabled={creating}
                >
                  {creating ? "Добавление…" : "Добавить"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Подсказка: услуги с ценой 0 в Конструкторе не показываются. Заполните цены — и они сразу появятся в Tour Builder.
      </p>
    </div>
  );
}
