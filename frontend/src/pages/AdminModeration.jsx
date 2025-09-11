import React, { useEffect, useState } from "react";
import axios from "axios";
import { tSuccess, tError, tInfo } from "../shared/toast";

const fmt = (n) => new Intl.NumberFormat().format(Number(n || 0));

function Card({ item, onApprove, onReject, onUnpublish }) {
  const s = item || {};
  const d = typeof s.details === "object" ? s.details : {};
  const cover = Array.isArray(s.images) && s.images.length ? s.images[0] : null;

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm flex flex-col">
      <div className="flex gap-3">
        <div className="w-24 h-16 bg-gray-100 rounded overflow-hidden">
          {cover ? <img src={cover} alt="" className="w-full h-full object-cover" /> : null}
        </div>
        <div className="flex-1">
          <div className="font-semibold">{s.title || "(без названия)"}</div>
          <div className="text-xs text-gray-600">{s.category}</div>
          <div className="text-xs text-gray-600 mt-1">
            Поставщик: {s.provider_name} ({s.provider_type})
          </div>
          <div className="text-sm mt-1">
            {s.price != null ? <>Netto: {fmt(d?.netPrice)} / Gross: {fmt(d?.grossPrice)}</> : null}
          </div>
        </div>
      </div>

      {s.description && (
        <div className="mt-3 text-sm text-gray-800 whitespace-pre-wrap">{s.description}</div>
      )}

      {/* details (коротко) */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-700">
        {d.direction && <div>Направление: {d.direction}</div>}
        {d.startDate && <div>Старт: {d.startDate}</div>}
        {d.endDate && <div>Конец: {d.endDate}</div>}
        {d.location && <div>Локация: {d.location}</div>}
        {d.eventName && <div>Событие: {d.eventName}</div>}
        {d.airline && <div>Авиакомпания: {d.airline}</div>}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => onApprove(s.id)}
          className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm hover:bg-emerald-700"
        >
          Approve
        </button>
        <button
          onClick={() => {
            const reason = prompt("Причина отклонения:");
            if (reason != null) onReject(s.id, reason);
          }}
          className="px-3 py-1.5 rounded bg-rose-600 text-white text-sm hover:bg-rose-700"
        >
          Reject
        </button>
        <button
          onClick={() => onUnpublish(s.id)}
          className="px-3 py-1.5 rounded bg-gray-200 text-gray-800 text-sm hover:bg-gray-300"
        >
          Unpublish
        </button>
      </div>
    </div>
  );
}

export default function AdminModeration() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const API_BASE = import.meta.env.VITE_API_BASE_URL;
  const token = localStorage.getItem("token");
  const cfg = { headers: { Authorization: `Bearer ${token}` } };

  const isAdmin = (() => {
    try {
      const raw = localStorage.getItem("user") || localStorage.getItem("auth");
      if (raw) {
        const u = JSON.parse(raw);
        return u?.role === "admin" || u?.is_admin === true;
      }
    } catch {}
    return false;
  })();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_BASE}/api/admin/services/pending`, cfg);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      tError("Не удалось загрузить список");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const approve = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/admin/services/${id}/approve`, {}, cfg);
      tSuccess("Опубликовано");
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch { tError("Ошибка approve"); }
  };
  const reject = async (id, reason) => {
    if (!reason || !reason.trim()) return tInfo("Укажите причину");
    try {
      await axios.post(`${API_BASE}/api/admin/services/${id}/reject`, { reason }, cfg);
      tSuccess("Отклонено");
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch { tError("Ошибка reject"); }
  };
  const unpublish = async (id) => {
    try {
      await axios.post(`${API_BASE}/api/admin/services/${id}/unpublish`, {}, cfg);
      tSuccess("Снято с публикации");
      // остаётся в очереди только если статус был pending
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch { tError("Ошибка unpublish"); }
  };

  if (!isAdmin) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <div className="bg-white border rounded-lg p-6">
          <div className="text-xl font-semibold mb-2">403</div>
          <div>Доступ только для администратора</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Модерация услуг</h1>
        <button
          onClick={load}
          className="px-3 py-1.5 rounded bg-gray-900 text-white text-sm"
        >
          Обновить
        </button>
      </div>

      {loading ? (
        <div className="text-gray-600">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="text-gray-600">Нет заявок</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((it) => (
            <Card
              key={it.id}
              item={it}
              onApprove={approve}
              onReject={reject}
              onUnpublish={unpublish}
            />
          ))}
        </div>
      )}
    </div>
  );
}
