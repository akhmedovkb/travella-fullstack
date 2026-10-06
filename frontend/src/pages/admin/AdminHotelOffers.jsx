import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";

const emptyOffer = {
  provider_id: "", supplier_type: "supplier", is_direct: false,
  currency: "USD", status: "draft", title: "", valid_from: "", valid_to: "",
};

const emptyRate = {
  inventory_pool_id: "", room_type: "", meal_plan: "BB", residency: "all",
  date_from: "", date_to: "", amount: "", min_stay: 1, refundable: true,
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const plusDaysIso = (date, days) => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + days); return value.toISOString().slice(0, 10); };

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs font-black uppercase tracking-[0.08em] text-slate-500">{label}</span>{children}</label>;
}

const inputClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

function statusTone(status) {
  if (status === "active") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "pending_review") return "bg-blue-50 text-blue-700 ring-blue-200";
  if (status === "rejected") return "bg-rose-50 text-rose-700 ring-rose-200";
  if (status === "paused") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function statusLabel(status) {
  return ({ draft: "Черновик", pending_review: "На модерации", active: "Опубликовано", paused: "Приостановлено", rejected: "Отклонено" })[status] || status;
}

function supplierTypeLabel(type) {
  return ({
    hotel: "Отель",
    tour_operator: "Туроператор",
    dmc: "DMC",
    agency: "Агентство",
    supplier: "Поставщик",
  })[String(type || "").toLowerCase()] || type || "Поставщик";
}

const actionLabels = {
  created: "Предложение создано", rates_replaced: "Тарифы сохранены", submitted: "Отправлено на модерацию",
  approved: "Опубликовано", rejected: "Отклонено", status_changed: "Статус изменён", archived: "Архивировано",
  inventory_updated: "Календарь квот обновлён",
};

function offerSubmitError(error) {
  const code = error?.code || error?.data?.error || error?.message;
  if (code === "rates_required_before_submission") return "Сначала добавьте и сохраните хотя бы один тариф.";
  if (code === "offer_expired") return "Срок действия предложения истёк. Обновите период тарифов.";
  if (code === "offer_not_submittable") {
    const status = statusLabel(error?.data?.current_status);
    return status ? `Нельзя отправить предложение из статуса «${status}». Статус обновлён.` : "Текущий статус предложения не позволяет отправить его на модерацию.";
  }
  return error?.message || "Не удалось отправить предложение на модерацию";
}

function RoomInventoryManager({ hotelId, apiRole, suggestedRooms = [], onMessage, onPoolsChange }) {
  const [pools, setPools] = useState([]);
  const [activePool, setActivePool] = useState(null);
  const [calendar, setCalendar] = useState([]);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(() => plusDaysIso(todayIso(), 30));
  const [busy, setBusy] = useState(false);
  const [canManage, setCanManage] = useState(false);

  const loadPools = useCallback(async () => {
    try {
      const data = await apiGet(`/api/hotels/${hotelId}/offers/inventory/rooms`, apiRole);
      setCanManage(data?.can_manage === true);
      const next = (data?.items || []).filter((item) => item.active !== false).map((item) => ({ ...item, base_inventory: Number(item.base_inventory || 0) }));
      setPools(next); onPoolsChange(next);
    } catch (error) {
      if (error?.status !== 403) onMessage(error?.message || "Не удалось загрузить номерной фонд");
    }
  }, [hotelId, apiRole, onMessage, onPoolsChange]);

  useEffect(() => { loadPools(); }, [loadPools]);

  function addPool(roomType = "", baseInventory = 0) {
    const normalized = String(roomType || "").trim();
    if (normalized && pools.some((item) => item.room_type.toLowerCase() === normalized.toLowerCase())) return;
    setPools((items) => [...items, { room_type: normalized, base_inventory: Math.max(0, Number(baseInventory) || 0), active: true }]);
  }

  function updatePool(index, key, value) {
    setPools((items) => items.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }

  async function savePools() {
    if (!pools.length || pools.some((item) => !String(item.room_type || "").trim())) return onMessage("Укажите тип каждого номера");
    setBusy(true);
    try {
      const data = await apiPut(`/api/hotels/${hotelId}/offers/inventory/rooms`, {
        items: pools.map((item) => ({ room_type: item.room_type.trim(), base_inventory: Number(item.base_inventory), active: true })),
      }, apiRole);
      const next = (data?.items || []).filter((item) => item.active !== false);
      setPools(next); onPoolsChange(next);
      onMessage("Единый номерной фонд сохранён");
    } catch (error) { onMessage(error?.message || "Не удалось сохранить номерной фонд"); }
    finally { setBusy(false); }
  }

  async function openCalendar(pool, nextFrom = from, nextTo = to) {
    if (!pool?.id) return onMessage("Сначала сохраните номерной фонд");
    setBusy(true);
    try {
      const data = await apiGet(`/api/hotels/${hotelId}/offers/inventory/rooms/${pool.id}/calendar?from=${nextFrom}&to=${nextTo}`, apiRole);
      setActivePool(data?.pool || pool); setFrom(nextFrom); setTo(nextTo);
      setCalendar((data?.items || []).map((item) => ({ ...item, inventory: item.inventory ?? "", note: item.note || "" })));
    } catch (error) { onMessage(error?.message || "Не удалось загрузить календарь фонда"); }
    finally { setBusy(false); }
  }

  async function saveCalendar() {
    if (!activePool) return;
    setBusy(true);
    try {
      await apiPut(`/api/hotels/${hotelId}/offers/inventory/rooms/${activePool.id}/calendar`, {
        items: calendar.map((item) => ({ date: item.date, inventory: item.inventory, stop_sell: item.stop_sell === true, note: item.note })),
      }, apiRole);
      onMessage(`Календарь ${activePool.room_type} сохранён`);
      await openCalendar(activePool);
    } catch (error) { onMessage(error?.message || "Не удалось сохранить календарь фонда"); }
    finally { setBusy(false); }
  }

  function updateDay(index, key, value) {
    setCalendar((items) => items.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }

  const suggestionMap = new Map();
  suggestedRooms.forEach((item) => {
    const rawType = item?.room_type ?? item?.type ?? (typeof item === "string" ? item : "");
    const type = typeof rawType === "string" || typeof rawType === "number" ? String(rawType).trim() : "";
    if (type && !suggestionMap.has(type.toLowerCase())) suggestionMap.set(type.toLowerCase(), { type, count: Number(item?.count || item?.base_inventory || 0) });
  });
  const availableSuggestions = [...suggestionMap.values()]
    .filter((suggestion) => !pools.some((item) => item.room_type.toLowerCase() === suggestion.type.toLowerCase()));

  return <section className="border-t border-slate-200 bg-white py-5">
    <div className="flex flex-wrap items-start justify-between gap-3 px-1">
      <div><h2 className="text-lg font-black text-slate-950">Единый номерной фонд</h2><p className="text-sm text-slate-500">Физическое количество номеров. Цены, питание и резидентность используют этот общий остаток.</p></div>
      {canManage ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => addPool()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-black">+ Тип номера</button><button type="button" disabled={busy || !pools.length} onClick={savePools} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40">Сохранить фонд</button></div> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">Только просмотр</span>}
    </div>
    {canManage && availableSuggestions.length ? <div className="mt-3 flex flex-wrap items-center gap-2 px-1"><span className="text-xs font-bold text-slate-500">Добавить из карточки и тарифов:</span>{availableSuggestions.map((item) => <button key={item.type} type="button" onClick={() => addPool(item.type, item.count)} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-black text-slate-700">+ {item.type}{item.count ? ` · ${item.count}` : ""}</button>)}</div> : null}
    <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[720px]"><thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Тип номера</th><th className="p-3">Всего номеров</th><th className="p-3">Назначение</th><th className="p-3 text-right">Действия</th></tr></thead><tbody className="divide-y divide-slate-100">{pools.length ? pools.map((pool, index) => <tr key={pool.id || `new-${index}`}><td className="p-3">{canManage ? <input className={inputClass} value={pool.room_type} onChange={(e) => updatePool(index, "room_type", e.target.value)} placeholder="Standard DBL" /> : <span className="font-black">{pool.room_type}</span>}</td><td className="p-3">{canManage ? <input type="number" min="0" className={`${inputClass} max-w-40`} value={pool.base_inventory} onChange={(e) => updatePool(index, "base_inventory", e.target.value)} /> : <span className="font-black">{pool.base_inventory}</span>}</td><td className="p-3 text-sm text-slate-600">Общий остаток для всех тарифов и поставщиков</td><td className="p-3"><div className="flex justify-end gap-3">{canManage && pool.id ? <button type="button" onClick={() => openCalendar(pool)} className="text-sm font-black text-blue-700">Календарь</button> : null}{canManage ? <button type="button" onClick={() => setPools((items) => items.filter((_, i) => i !== index))} className="text-sm font-black text-rose-600">Убрать</button> : null}</div></td></tr>) : <tr><td colSpan={4} className="p-6 text-center text-sm font-semibold text-slate-500">Номерной фонд пока не заполнен</td></tr>}</tbody></table></div>
    {activePool ? <div className="mt-5 border-t border-slate-200 pt-4"><div className="flex flex-wrap items-end justify-between gap-3 px-1"><div><h3 className="font-black text-slate-950">Наличие: {activePool.room_type}</h3><p className="text-sm text-slate-500">Пустое значение наследует базовый фонд {activePool.base_inventory}. Stop-sale закрывает продажи на дату.</p></div><div className="flex flex-wrap items-end gap-2"><Field label="С"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="До"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field><button type="button" disabled={busy} onClick={() => openCalendar(activePool)} className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-black">Показать</button><button type="button" disabled={busy} onClick={saveCalendar} className="h-10 rounded-lg bg-orange-600 px-4 text-sm font-black text-white">Сохранить</button><button type="button" onClick={() => { setActivePool(null); setCalendar([]); }} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-black">Закрыть</button></div></div><div className="mt-3 max-h-[480px] overflow-auto"><table className="w-full min-w-[900px]"><thead className="sticky top-0 bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Дата</th><th className="p-2">Фонд на дату</th><th className="p-2">Stop-sale</th><th className="p-2">Резерв</th><th className="p-2">Продано</th><th className="p-2">Доступно</th><th className="p-2">Комментарий</th></tr></thead><tbody className="divide-y divide-slate-100">{calendar.map((item, index) => <tr key={item.date} className={item.stop_sell ? "bg-rose-50" : item.available <= 2 ? "bg-amber-50" : ""}><td className="p-2 text-sm font-black">{item.date}</td><td className="p-2"><input type="number" min="0" className={`${inputClass} max-w-32`} value={item.inventory} onChange={(e) => updateDay(index, "inventory", e.target.value)} placeholder={String(activePool.base_inventory)} /></td><td className="p-2"><input type="checkbox" checked={item.stop_sell === true} onChange={(e) => updateDay(index, "stop_sell", e.target.checked)} /></td><td className="p-2 font-bold text-amber-700">{item.held || 0}</td><td className="p-2 font-bold text-emerald-700">{item.confirmed || 0}</td><td className="p-2 font-black">{item.stop_sell ? 0 : item.available}</td><td className="p-2"><input className={inputClass} value={item.note} onChange={(e) => updateDay(index, "note", e.target.value)} placeholder="Ремонт, блок, мероприятие..." /></td></tr>)}</tbody></table></div></div> : null}
  </section>;
}

function SupplierAllocationManager({ hotelId, apiRole, offers, pools, onMessage }) {
  const [items, setItems] = useState([]); const [canManage, setCanManage] = useState(false); const [busy, setBusy] = useState(false);
  const [candidateProviders, setCandidateProviders] = useState([]);
  const load = useCallback(async () => {
    try { const data = await apiGet(`/api/hotels/${hotelId}/offers/inventory/allocations`, apiRole); setItems(data?.items || []); setCandidateProviders(data?.providers || []); setCanManage(data?.can_manage === true); }
    catch (error) { if (error?.status !== 403) onMessage(error?.message || "Не удалось загрузить квоты поставщиков"); }
  }, [hotelId, apiRole, onMessage]);
  useEffect(() => { load(); }, [load]);
  function update(index, key, value) { setItems((rows) => rows.map((row, i) => i === index ? { ...row, [key]: value } : row)); }
  async function save() {
    setBusy(true);
    try { await apiPut(`/api/hotels/${hotelId}/offers/inventory/allocations`, { items: items.map((x) => ({ id: x.id || null, provider_id: Number(x.provider_id), pool_id: Number(x.pool_id), date_from: x.date_from, date_to: x.date_to, allotment: Number(x.allotment) })) }, apiRole); onMessage("Квоты поставщиков сохранены"); await load(); }
    catch (error) { const code = error?.data?.error || error?.message; onMessage(code === "supplier_allocation_periods_overlap" ? "Периоды квот одного поставщика по одному фонду пересекаются" : (error?.message || "Не удалось сохранить квоты")); }
    finally { setBusy(false); }
  }
  const eligibleOffers = (canManage ? candidateProviders : offers).filter((offer) => offer.provider_id);
  return <section className="border-t border-slate-200 bg-white py-5">
    <div className="flex flex-wrap items-start justify-between gap-3 px-1"><div><h2 className="text-lg font-black">Квоты поставщиков</h2><p className="text-sm text-slate-500">Один лимит на поставщика и физический фонд. Все его тарифы расходуют этот общий остаток.</p></div>{canManage ? <div className="flex gap-2"><button type="button" disabled={!eligibleOffers.length || !pools.length} onClick={() => setItems((rows) => [...rows, { provider_id: eligibleOffers[0]?.provider_id || "", pool_id: pools[0]?.id || "", date_from: todayIso(), date_to: plusDaysIso(todayIso(), 30), allotment: 0 }])} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-black disabled:opacity-40">+ Квота</button><button type="button" disabled={busy} onClick={save} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40">Сохранить квоты</button></div> : <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">Ваша квота</span>}</div>
    <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[1050px]"><thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Поставщик</th><th className="p-3">Фонд</th><th className="p-3">С</th><th className="p-3">До</th><th className="p-3">Выделено</th><th className="p-3">Резерв</th><th className="p-3">Продано</th><th className="p-3">Остаток</th>{canManage ? <th className="p-3"></th> : null}</tr></thead><tbody className="divide-y divide-slate-100">{items.length ? items.map((row,index) => <tr key={row.id || `new-${index}`}><td className="p-3">{canManage ? <select className={inputClass} value={row.provider_id} onChange={(e) => update(index,"provider_id",e.target.value)}>{eligibleOffers.map((o) => <option key={o.provider_id} value={o.provider_id}>{o.provider_name} · #{o.provider_id}</option>)}</select> : <><div className="font-black">{row.provider_name}</div><div className="text-xs text-slate-500">#{row.provider_id}</div></>}</td><td className="p-3">{canManage ? <select className={inputClass} value={row.pool_id} onChange={(e) => update(index,"pool_id",e.target.value)}>{pools.map((p) => <option key={p.id} value={p.id}>{p.room_type} · {p.base_inventory}</option>)}</select> : <span className="font-black">{row.room_type}</span>}</td><td className="p-3">{canManage ? <input type="date" className={inputClass} value={row.date_from} onChange={(e) => update(index,"date_from",e.target.value)} /> : row.date_from}</td><td className="p-3">{canManage ? <input type="date" className={inputClass} value={row.date_to} onChange={(e) => update(index,"date_to",e.target.value)} /> : row.date_to}</td><td className="p-3">{canManage ? <input type="number" min="0" className={`${inputClass} max-w-28`} value={row.allotment} onChange={(e) => update(index,"allotment",e.target.value)} /> : <span className="font-black">{row.allotment}</span>}</td><td className="p-3 font-bold text-amber-700">{row.held || 0}</td><td className="p-3 font-bold text-emerald-700">{row.confirmed || 0}</td><td className="p-3 font-black">{row.available ?? row.allotment}</td>{canManage ? <td className="p-3"><button type="button" onClick={() => setItems((rows) => rows.filter((_,i) => i !== index))} className="font-black text-rose-600">Удалить</button></td> : null}</tr>) : <tr><td colSpan={canManage ? 9 : 8} className="p-6 text-center text-sm font-semibold text-slate-500">Квоты пока не назначены. Без квоты действуют прежние лимиты тарифа.</td></tr>}</tbody></table></div>
  </section>;
}

export default function AdminHotelOffers({ scope = "admin" }) {
  const { id } = useParams();
  const hotelId = Number(id);
  const providerMode = scope === "provider";
  const apiRole = providerMode ? "provider" : "admin";
  const [hotel, setHotel] = useState(null);
  const [providers, setProviders] = useState([]);
  const [offers, setOffers] = useState([]);
  const [form, setForm] = useState(emptyOffer);
  const [selectedId, setSelectedId] = useState(null);
  const [rates, setRates] = useState([]);
  const [cascadeRates, setCascadeRates] = useState(false);
  const [ratesEditable, setRatesEditable] = useState(true);
  const [roomPools, setRoomPools] = useState([]);
  const [events, setEvents] = useState([]);
  const [inventoryRate, setInventoryRate] = useState(null);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [inventoryFrom, setInventoryFrom] = useState(todayIso());
  const [inventoryTo, setInventoryTo] = useState(() => plusDaysIso(todayIso(), 30));
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selected = useMemo(() => offers.find((offer) => Number(offer.id) === Number(selectedId)) || null, [offers, selectedId]);
  const selectedProvider = useMemo(() => providers.find((provider) => Number(provider.id) === Number(form.provider_id)) || null, [providers, form.provider_id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hotelData, offersData, providersData] = await Promise.all([
        apiGet(`/api/hotels/${hotelId}${providerMode ? "/brief" : ""}`, apiRole),
        apiGet(`/api/hotels/${hotelId}/offers${providerMode ? "?mine=1" : ""}`, apiRole),
        providerMode ? Promise.resolve({ items: [] }) : apiGet(`/api/admin/providers-table?limit=200`, "admin"),
      ]);
      setHotel(hotelData || null);
      setOffers(offersData?.items || []);
      const providerPayload = providersData?.data?.items ? providersData.data : providersData;
      setProviders((providerPayload?.items || []).filter((provider) => ['hotel','agent','tour_agent','agency','supplier','tour_operator','dmc'].includes(String(provider.type || '').toLowerCase())));
    } catch (error) {
      setMessage(error?.message || "Не удалось загрузить предложения");
    } finally { setLoading(false); }
  }, [hotelId, apiRole, providerMode]);

  useEffect(() => { load(); }, [load]);

  async function createOffer(event) {
    event.preventDefault();
    if (!form.provider_id) return setMessage("Выберите поставщика");
    setSaving(true); setMessage("");
    try {
      await apiPost(`/api/hotels/${hotelId}/offers`, {
        ...form, provider_id: Number(form.provider_id),
        valid_from: form.valid_from || null, valid_to: form.valid_to || null,
      }, apiRole);
      setForm(emptyOffer);
      setMessage("Предложение сохранено");
      await load();
    } catch (error) { setMessage(error?.message || "Не удалось сохранить предложение"); }
    finally { setSaving(false); }
  }

  async function openRates(offer) {
    setSelectedId(offer.id); setMessage("");
    try {
      const [data, eventData] = await Promise.all([
        apiGet(`/api/hotels/${hotelId}/offers/${offer.id}/rates`, apiRole),
        apiGet(`/api/hotels/${hotelId}/offers/${offer.id}/events`, apiRole),
      ]);
      setRates((data?.items || []).map((rate) => ({ ...rate, inventory_pool_id: rate.inventory_pool_id || "", amount: String(rate.amount ?? "") })));
      setCascadeRates(data?.cascade === true);
      setRatesEditable(data?.can_edit !== false);
      setEvents(eventData?.items || []);
    } catch (error) { setMessage(error?.message || "Не удалось загрузить тарифы"); }
  }

  async function updateOffer(offer, patch) {
    setSaving(true); setMessage("");
    try {
      await apiPut(`/api/hotels/${hotelId}/offers/${offer.id}`, {
        currency: offer.currency, title: offer.title || "", terms: offer.terms || {},
        valid_from: offer.valid_from || null, valid_to: offer.valid_to || null,
        ...patch,
      }, apiRole);
      await load();
    } catch (error) { setMessage(error?.message || "Не удалось обновить предложение"); }
    finally { setSaving(false); }
  }

  async function archiveOffer(offer) {
    if (!window.confirm(`Архивировать предложение ${offer.provider_name}?`)) return;
    setSaving(true);
    try {
      await apiDelete(`/api/hotels/${hotelId}/offers/${offer.id}`, apiRole);
      if (Number(selectedId) === Number(offer.id)) { setSelectedId(null); setRates([]); }
      await load();
    } catch (error) { setMessage(error?.message || "Не удалось архивировать предложение"); }
    finally { setSaving(false); }
  }

  async function submitOffer(offer) {
    setSaving(true); setMessage("");
    try {
      const result = await apiPost(`/api/hotels/${hotelId}/offers/${offer.id}/submit`, {}, apiRole);
      setMessage(result?.already_submitted ? "Предложение уже находится на модерации" : "Предложение отправлено на модерацию");
      await load();
      if (Number(selectedId) === Number(offer.id)) await openRates({ ...offer, status: "pending_review" });
    } catch (error) {
      setMessage(offerSubmitError(error));
      await load();
    }
    finally { setSaving(false); }
  }

  async function reviewOffer(offer, decision, reason = "") {
    setSaving(true); setMessage("");
    try {
      await apiPost(`/api/hotels/${hotelId}/offers/${offer.id}/review`, { decision, reason }, "admin");
      setRejecting(null); setRejectReason("");
      setMessage(decision === "approve" ? "Предложение опубликовано" : "Предложение возвращено поставщику на исправление");
      await load();
      if (Number(selectedId) === Number(offer.id)) await openRates(offer);
    } catch (error) { setMessage(error?.message || "Не удалось сохранить решение модерации"); }
    finally { setSaving(false); }
  }

  function updateRate(index, key, value) {
    setRates((current) => current.map((rate, i) => i === index ? { ...rate, [key]: value } : rate));
  }

  async function saveRates() {
    if (!selected) return;
    setSaving(true); setMessage("");
    try {
      const rowsToSave = cascadeRates ? rates.filter((rate) => Number(rate.amount) > 0) : rates;
      await apiPut(`/api/hotels/${hotelId}/offers/${selected.id}/rates`, { items: rowsToSave.map((rate) => ({
        ...rate, inventory_pool_id: rate.inventory_pool_id ? Number(rate.inventory_pool_id) : null, amount: Number(rate.amount), min_stay: Number(rate.min_stay) || 1,
      })) }, apiRole);
      setMessage("Тарифы сохранены. Предложение возвращено в черновик: отправьте его на модерацию.");
      await load();
      await openRates(selected);
    } catch (error) { setMessage(error?.message || "Не удалось сохранить тарифы"); }
    finally { setSaving(false); }
  }

  async function openInventory(rate, from = inventoryFrom, to = inventoryTo) {
    if (!selected) return;
    setSaving(true); setMessage("");
    try {
      const data = await apiGet(`/api/hotels/${hotelId}/offers/${selected.id}/rates/${rate.id}/inventory?from=${from}&to=${to}`, apiRole);
      setInventoryFrom(from); setInventoryTo(to);
      setInventoryRate(rate);
      setInventoryRows((data?.items || []).map((item) => ({ ...item, allotment: item.allotment ?? "", note: item.note || "" })));
    } catch (error) { setMessage(error?.message || "Не удалось загрузить календарь квот"); }
    finally { setSaving(false); }
  }

  function openRateInventory(rate) {
    const today = todayIso();
    const from = rate.date_to && rate.date_to < today
      ? rate.date_from
      : rate.date_from && rate.date_from > today ? rate.date_from : today;
    const candidateTo = plusDaysIso(from, 30);
    const to = rate.date_to && rate.date_to < candidateTo ? rate.date_to : candidateTo;
    openInventory(rate, from, to);
  }

  async function saveInventory() {
    if (!selected || !inventoryRate) return;
    setSaving(true); setMessage("");
    try {
      await apiPut(`/api/hotels/${hotelId}/offers/${selected.id}/rates/${inventoryRate.id}/inventory`, {
        items: inventoryRows.map((item) => ({ date: item.date, allotment: item.allotment, stop_sell: item.stop_sell === true, note: item.note || "" })),
      }, apiRole);
      setMessage("Календарь квот сохранён");
      await openInventory(inventoryRate);
      await openRates(selected);
    } catch (error) { setMessage(error?.message || "Не удалось сохранить календарь квот"); }
    finally { setSaving(false); }
  }

  function updateInventory(index, key, value) {
    setInventoryRows((rows) => rows.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.14em] text-orange-600">Коммерческие предложения</div>
            <h1 className="mt-1 text-2xl font-black text-slate-950">{hotel?.name || `Отель #${hotelId}`}</h1>
            <p className="mt-1 text-sm font-medium text-slate-500">Одна карточка отеля, отдельные тарифы каждого поставщика.</p>
          </div>
          <div className="flex gap-2">
            <Link to={providerMode ? `/hotels/${hotelId}` : `/admin/hotels/${hotelId}/edit`} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700">Карточка</Link>
            <Link to={providerMode ? "/dashboard/hotels" : "/admin/hotels"} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white">{providerMode ? "← Мои отели" : "← К базе отелей"}</Link>
          </div>
        </header>

        {message ? <div className="border-l-4 border-orange-500 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-800">{message}</div> : null}

        {!providerMode ? <section className="border-b border-slate-200 bg-white p-4">
          <h2 className="text-lg font-black text-slate-950">Добавить поставщика</h2>
          <form onSubmit={createOffer} className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Field label="Поставщик"><select className={inputClass} value={form.provider_id} onChange={(e) => { const provider = providers.find((item) => Number(item.id) === Number(e.target.value)); setForm({ ...form, provider_id: e.target.value, supplier_type: provider?.type === "hotel" ? "hotel" : form.supplier_type === "hotel" ? "supplier" : form.supplier_type, is_direct: provider?.type === "hotel" ? form.is_direct : false }); }}><option value="">Выберите</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.type || "supplier"} · #{provider.id}</option>)}</select></Field>
            <Field label="Тип"><select className={inputClass} value={form.supplier_type} onChange={(e) => setForm({ ...form, supplier_type: e.target.value })}><option value="hotel">Отель</option><option value="tour_operator">Туроператор</option><option value="dmc">DMC</option><option value="agency">Агентство</option><option value="supplier">Поставщик</option></select></Field>
            <Field label="Валюта"><select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}><option>USD</option><option>UZS</option></select></Field>
            <Field label="Действует с"><input type="date" className={inputClass} value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} /></Field>
            <Field label="Действует до"><input type="date" className={inputClass} value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} /></Field>
            <div className="flex items-end"><button disabled={saving} className="h-10 w-full rounded-lg bg-orange-600 px-4 text-sm font-black text-white disabled:opacity-50">Добавить</button></div>
            <Field label="Название тарифа"><input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Прямой тариф, FIT 2026..." /></Field>
            <label className="flex h-10 items-center gap-2 self-end text-sm font-bold text-slate-700"><input type="checkbox" disabled={selectedProvider?.type !== "hotel"} checked={form.is_direct} onChange={(e) => setForm({ ...form, is_direct: e.target.checked })} /> Прямой тариф отеля</label>
          </form>
        </section> : null}

        <section className="overflow-x-auto bg-white">
          <table className="w-full min-w-[1050px] border-collapse">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Поставщик</th><th className="px-4 py-3">Тип</th><th className="px-4 py-3">Период</th><th className="px-4 py-3">Тарифы</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3 text-right">Действия</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={6} className="p-8 text-center font-bold text-slate-500">Загрузка…</td></tr> : offers.length ? offers.map((offer) => (
                <tr key={offer.id} className={Number(selectedId) === Number(offer.id) ? "bg-orange-50/60" : ""}>
                  <td className="px-4 py-3">
                    {offer.status === "pending_review" ? <div className="mb-1 text-[10px] font-black uppercase tracking-[0.12em] text-blue-600">Отправитель заявки</div> : null}
                    <Link to={`/profile/provider/${offer.provider_id}`} className="font-black text-slate-950 underline-offset-2 hover:text-orange-600 hover:underline">{offer.provider_name}</Link>
                    <div className="text-xs text-slate-500">ID #{offer.provider_id} {offer.is_direct ? "· прямой тариф" : ""}</div>
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-700">{supplierTypeLabel(offer.supplier_type)}</td>
                  <td className="px-4 py-3 text-sm text-slate-600"><div>{offer.rate_from || offer.valid_from || "—"} → {offer.rate_to || offer.valid_to || "—"}</div>{offer.is_expired ? <div className="mt-1 text-xs font-black text-rose-600">Срок истёк</div> : offer.days_until_expiry != null && offer.days_until_expiry <= 7 ? <div className="mt-1 text-xs font-black text-amber-600">Истекает через {offer.days_until_expiry} дн.</div> : null}</td>
                  <td className="px-4 py-3"><div className="font-black">{offer.rate_count || 0}</div><div className="text-xs text-slate-500">{offer.min_rate ? `от ${offer.min_rate} ${offer.currency}` : "цены не заполнены"}</div></td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ring-1 ${statusTone(offer.status)}`}>{statusLabel(offer.status)}</span>{offer.rejection_reason ? <div className="mt-2 max-w-56 text-xs font-semibold text-rose-600">{offer.rejection_reason}</div> : null}</td>
                  <td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => openRates(offer)} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">{String(offer.supplier_type).toLowerCase() === "hotel" ? "Тариф" : "Цены"}</button>{offer.can_edit !== false && ['draft','rejected','paused'].includes(offer.status) && !offer.is_expired ? <button type="button" disabled={saving || !offer.rate_count} onClick={() => submitOffer(offer)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-black text-blue-700 disabled:opacity-40">На модерацию</button> : null}{!providerMode && offer.status === 'pending_review' ? <><button type="button" disabled={saving} onClick={() => reviewOffer(offer, 'approve')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white">Опубликовать</button><button type="button" disabled={saving} onClick={() => { setRejecting(offer); setRejectReason(""); }} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-600">Отклонить</button></> : null}{offer.can_edit !== false && offer.status === 'active' ? <button type="button" disabled={saving} onClick={() => updateOffer(offer, { status: 'paused' })} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-black text-amber-700">Приостановить</button> : null}{!providerMode ? <button type="button" onClick={() => archiveOffer(offer)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-500">Архив</button> : null}</div></td>
                </tr>
              )) : <tr><td colSpan={6} className="p-8 text-center font-bold text-slate-500">У отеля пока нет предложений поставщиков</td></tr>}
            </tbody>
          </table>
        </section>

        <RoomInventoryManager
          hotelId={hotelId}
          apiRole={apiRole}
          suggestedRooms={[...(Array.isArray(hotel?.rooms) ? hotel.rooms : []), ...rates.map((rate) => ({ room_type: rate.room_type }))]}
          onMessage={setMessage}
          onPoolsChange={setRoomPools}
        />
        <SupplierAllocationManager hotelId={hotelId} apiRole={apiRole} offers={offers} pools={roomPools} onMessage={setMessage} />

        {selected ? <section className="border-t border-slate-200 bg-white pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1"><div><h2 className="text-lg font-black">{cascadeRates ? "Цены" : "Тариф"}: {selected.provider_name}</h2><p className="text-sm text-slate-500">{cascadeRates ? (ratesEditable ? "Условия заданы отелем и обновляются автоматически. Укажите только свою цену." : "Условия заданы отелем. Цены принадлежат поставщику и доступны вам только для просмотра.") : "Отель задаёт категории, условия проживания и базовые тарифные строки для поставщиков."}</p></div>{ratesEditable ? <div className="flex gap-2">{!cascadeRates ? <button type="button" onClick={() => setRates((rows) => [...rows, { ...emptyRate, inventory_pool_id: roomPools[0]?.id || "", date_from: selected.valid_from || "", date_to: selected.valid_to || "" }])} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-black">+ Строка</button> : null}<button type="button" disabled={saving} onClick={saveRates} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{cascadeRates ? "Сохранить цены" : "Сохранить тариф"}</button></div> : <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">Только просмотр</span>}</div>
          {cascadeRates && !rates.length ? <div className="mt-3 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">Отель пока не создал тарифные строки. После их добавления категории и условия появятся здесь автоматически.</div> : null}
          <div className="mt-3 overflow-x-auto"><table className={`w-full ${cascadeRates ? "min-w-[1500px]" : "min-w-[1380px]"} border-collapse`}><thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Категория номера / фонд</th><th className="p-2">Питание</th><th className="p-2">Резидентность</th><th className="p-2">С</th><th className="p-2">До</th>{cascadeRates ? <th className="p-2">Цена отеля</th> : null}<th className="p-2">{cascadeRates ? "Цена поставщика" : "Цена"}</th><th className="p-2">Резерв</th><th className="p-2">Продано</th><th className="p-2">Доступно</th><th className="p-2">Мин. ночей</th><th className="p-2">Возвратный</th><th className="p-2"></th></tr></thead><tbody className="divide-y divide-slate-100">{rates.map((rate, index) => <tr key={rate.source_rate_id || rate.id || index}>
            <td className="p-2">{cascadeRates ? <span className="font-black">{rate.room_type}</span> : <select className={inputClass} value={rate.inventory_pool_id || ""} onChange={(e) => { const pool = roomPools.find((item) => Number(item.id) === Number(e.target.value)); setRates((rows) => rows.map((row, i) => i === index ? { ...row, inventory_pool_id: e.target.value, room_type: pool?.room_type || "" } : row)); }}><option value="">Выберите тип номера</option>{roomPools.map((pool) => <option key={pool.id} value={pool.id}>{pool.room_type} · {pool.base_inventory}</option>)}</select>}</td>
            <td className="p-2">{cascadeRates ? <span className="font-bold">{rate.meal_plan}</span> : <select className={inputClass} value={rate.meal_plan} onChange={(e) => updateRate(index, "meal_plan", e.target.value)}>{["RO","BB","HB","FB","AI","UAI"].map((v) => <option key={v}>{v}</option>)}</select>}</td>
            <td className="p-2">{cascadeRates ? <span className="font-bold">{{ all: "Все", resident: "Резидент", non_resident: "Нерезидент" }[rate.residency] || rate.residency}</span> : <select className={inputClass} value={rate.residency} onChange={(e) => updateRate(index, "residency", e.target.value)}><option value="all">Все</option><option value="resident">Резидент</option><option value="non_resident">Нерезидент</option></select>}</td>
            <td className="p-2">{cascadeRates ? rate.date_from : <input type="date" className={inputClass} value={rate.date_from} onChange={(e) => updateRate(index, "date_from", e.target.value)} />}</td><td className="p-2">{cascadeRates ? rate.date_to : <input type="date" className={inputClass} value={rate.date_to} onChange={(e) => updateRate(index, "date_to", e.target.value)} />}</td>
            {cascadeRates ? <td className="p-2"><div className="min-w-32 rounded-lg bg-slate-100 px-3 py-2 font-black text-slate-800">{rate.hotel_amount ?? "—"}</div></td> : null}<td className="p-2"><input type="number" min="0" step="0.01" disabled={!ratesEditable} className={`${inputClass} min-w-32 disabled:bg-slate-100 disabled:text-slate-600`} value={rate.amount} onChange={(e) => updateRate(index, "amount", e.target.value)} placeholder={cascadeRates ? "Цена поставщика" : "Введите цену"} /></td><td className="p-2 text-sm font-bold text-amber-700">{rate.held ?? 0}</td><td className="p-2 text-sm font-bold text-emerald-700">{rate.confirmed ?? 0}</td><td className="p-2 text-sm font-black text-slate-900">{rate.available == null ? "—" : rate.available}</td><td className="p-2">{cascadeRates ? <span className="font-bold">{rate.min_stay}</span> : <input type="number" min="1" disabled={!ratesEditable} className={inputClass} value={rate.min_stay} onChange={(e) => updateRate(index, "min_stay", e.target.value)} />}</td>
            <td className="p-2 text-center"><input type="checkbox" disabled={cascadeRates} checked={rate.refundable !== false} onChange={(e) => updateRate(index, "refundable", e.target.checked)} /></td><td className="p-2">{!cascadeRates ? <button type="button" onClick={() => setRates((rows) => rows.filter((_, i) => i !== index))} className="text-sm font-black text-rose-600">Удалить</button> : null}</td>
          </tr>)}</tbody></table></div>
          {inventoryRate ? <div className="mt-5 border-t border-slate-200 pt-4"><div className="flex flex-wrap items-end justify-between gap-3 px-1"><div><h3 className="text-base font-black">Календарь: {inventoryRate.room_type} · {inventoryRate.meal_plan}</h3><p className="text-sm text-slate-500">Пустая дневная квота наследует базовое значение тарифа.</p></div><div className="flex flex-wrap items-end gap-2"><Field label="С"><input type="date" className={inputClass} value={inventoryFrom} onChange={(e) => setInventoryFrom(e.target.value)} /></Field><Field label="До"><input type="date" className={inputClass} value={inventoryTo} onChange={(e) => setInventoryTo(e.target.value)} /></Field><button type="button" disabled={saving} onClick={() => openInventory(inventoryRate)} className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-black">Показать</button><button type="button" disabled={saving} onClick={saveInventory} className="h-10 rounded-lg bg-orange-600 px-4 text-sm font-black text-white">Сохранить</button><button type="button" onClick={() => { setInventoryRate(null); setInventoryRows([]); }} className="h-10 rounded-lg border border-slate-200 px-4 text-sm font-black">Закрыть</button></div></div><div className="mt-3 max-h-[480px] overflow-auto"><table className="w-full min-w-[900px]"><thead className="sticky top-0 bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Дата</th><th className="p-2">Дневная квота</th><th className="p-2">Стоп</th><th className="p-2">Резерв</th><th className="p-2">Продано</th><th className="p-2">Доступно</th><th className="p-2">Комментарий</th></tr></thead><tbody className="divide-y divide-slate-100">{inventoryRows.map((item, index) => <tr key={item.date} className={item.stop_sell ? "bg-rose-50" : ""}><td className="p-2 text-sm font-black">{item.date}</td><td className="p-2"><input type="number" min="0" className={`${inputClass} max-w-32`} value={item.allotment} onChange={(e) => updateInventory(index, "allotment", e.target.value)} placeholder={inventoryRate.allotment == null ? "∞" : String(inventoryRate.allotment)} /></td><td className="p-2"><input type="checkbox" checked={item.stop_sell === true} onChange={(e) => updateInventory(index, "stop_sell", e.target.checked)} /></td><td className="p-2 font-bold text-amber-700">{item.held || 0}</td><td className="p-2 font-bold text-emerald-700">{item.confirmed || 0}</td><td className="p-2 font-black">{item.stop_sell ? 0 : item.available == null ? "∞" : item.available}</td><td className="p-2"><input className={inputClass} value={item.note} onChange={(e) => updateInventory(index, "note", e.target.value)} placeholder="Причина или примечание" /></td></tr>)}</tbody></table></div></div> : null}
          <div className="mt-5 border-t border-slate-200 px-1 pt-4"><h3 className="text-sm font-black text-slate-950">История предложения</h3><div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{events.length ? events.slice(0, 12).map((item) => <div key={item.id} className="border-l-2 border-slate-200 pl-3 text-xs text-slate-600"><div className="font-black text-slate-800">{actionLabels[item.action] || item.action}</div><div>{item.from_status ? `${statusLabel(item.from_status)} → ` : ""}{item.to_status ? statusLabel(item.to_status) : ""}</div>{item.note ? <div className="mt-1 text-rose-600">{item.note}</div> : null}<div className="mt-1 text-slate-400">{new Date(item.created_at).toLocaleString("ru-RU")}</div></div>) : <div className="text-sm text-slate-500">История пока пуста</div>}</div></div>
        </section> : null}

        {rejecting ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4"><div className="w-full max-w-lg bg-white p-5 shadow-2xl"><h2 className="text-lg font-black">Почему предложение отклонено?</h2><p className="mt-1 text-sm text-slate-500">Поставщик увидит эту причину и сможет исправить тарифы.</p><textarea autoFocus className="mt-4 min-h-28 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-rose-400" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Например: срок действия тарифа истёк или неверно указана цена" /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setRejecting(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-black">Отмена</button><button type="button" disabled={saving || !rejectReason.trim()} onClick={() => reviewOffer(rejecting, 'reject', rejectReason)} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40">Отклонить</button></div></div></div> : null}
      </div>
    </main>
  );
}
