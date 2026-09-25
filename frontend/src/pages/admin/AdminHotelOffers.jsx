import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiDelete, apiGet, apiPost, apiPut } from "../../api";

const emptyOffer = {
  provider_id: "", supplier_type: "supplier", is_direct: false,
  currency: "USD", status: "draft", title: "", valid_from: "", valid_to: "",
};

const emptyRate = {
  room_type: "", meal_plan: "BB", residency: "all",
  date_from: "", date_to: "", amount: "", allotment: "", min_stay: 1, refundable: true,
};

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs font-black uppercase tracking-[0.08em] text-slate-500">{label}</span>{children}</label>;
}

const inputClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

function statusTone(status) {
  if (status === "active") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "paused") return "bg-amber-50 text-amber-700 ring-amber-200";
  return "bg-slate-100 text-slate-600 ring-slate-200";
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
      const data = await apiGet(`/api/hotels/${hotelId}/offers/${offer.id}/rates`, apiRole);
      setRates((data?.items || []).map((rate) => ({ ...rate, amount: String(rate.amount ?? ""), allotment: rate.allotment ?? "" })));
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

  function updateRate(index, key, value) {
    setRates((current) => current.map((rate, i) => i === index ? { ...rate, [key]: value } : rate));
  }

  async function saveRates() {
    if (!selected) return;
    setSaving(true); setMessage("");
    try {
      await apiPut(`/api/hotels/${hotelId}/offers/${selected.id}/rates`, { items: rates.map((rate) => ({
        ...rate, amount: Number(rate.amount), allotment: rate.allotment === "" ? null : Number(rate.allotment), min_stay: Number(rate.min_stay) || 1,
      })) }, apiRole);
      setMessage("Тарифы сохранены. Перед публикацией проверьте предложение и включите статус «Активно».");
      await load();
      await openRates(selected);
    } catch (error) { setMessage(error?.message || "Не удалось сохранить тарифы"); }
    finally { setSaving(false); }
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
            <Link to={providerMode ? "/dashboard" : "/admin/hotels"} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white">{providerMode ? "В кабинет" : "К базе отелей"}</Link>
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
                  <td className="px-4 py-3"><div className="font-black text-slate-950">{offer.provider_name}</div><div className="text-xs text-slate-500">#{offer.provider_id} {offer.is_direct ? "· прямой тариф" : ""}</div></td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-700">{offer.supplier_type}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{offer.valid_from || "—"} → {offer.valid_to || "—"}</td>
                  <td className="px-4 py-3"><div className="font-black">{offer.rate_count || 0}</div><div className="text-xs text-slate-500">{offer.min_rate ? `от ${offer.min_rate} ${offer.currency}` : "цены не заполнены"}</div></td>
                  <td className="px-4 py-3">{providerMode ? <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ring-1 ${statusTone(offer.status)}`}>{offer.status === 'active' ? 'Активно' : offer.status === 'paused' ? 'Пауза' : 'На проверке'}</span> : <select className={`${inputClass} max-w-36 ${statusTone(offer.status)}`} value={offer.status} disabled={saving} onChange={(e) => updateOffer(offer, { status: e.target.value })}><option value="draft">Черновик</option><option value="active">Активно</option><option value="paused">Пауза</option></select>}</td>
                  <td className="px-4 py-3"><div className="flex justify-end gap-2"><button type="button" onClick={() => openRates(offer)} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">Тарифы</button>{!providerMode ? <button type="button" onClick={() => archiveOffer(offer)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-600">Архив</button> : null}</div></td>
                </tr>
              )) : <tr><td colSpan={6} className="p-8 text-center font-bold text-slate-500">У отеля пока нет предложений поставщиков</td></tr>}
            </tbody>
          </table>
        </section>

        {selected ? <section className="border-t border-slate-200 bg-white pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1"><div><h2 className="text-lg font-black">Тарифы: {selected.provider_name}</h2><p className="text-sm text-slate-500">Одна строка описывает цену за номер и ночь для периода.</p></div><div className="flex gap-2"><button type="button" onClick={() => setRates((rows) => [...rows, { ...emptyRate, date_from: selected.valid_from || "", date_to: selected.valid_to || "" }])} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-black">+ Строка</button><button type="button" disabled={saving} onClick={saveRates} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">Сохранить тарифы</button></div></div>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[1200px] border-collapse"><thead className="bg-slate-100 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Номер</th><th className="p-2">Питание</th><th className="p-2">Резидентность</th><th className="p-2">С</th><th className="p-2">До</th><th className="p-2">Цена</th><th className="p-2">Квота</th><th className="p-2">Мин. ночей</th><th className="p-2">Возвратный</th><th className="p-2"></th></tr></thead><tbody className="divide-y divide-slate-100">{rates.map((rate, index) => <tr key={rate.id || index}>
            <td className="p-2"><input className={inputClass} value={rate.room_type} onChange={(e) => updateRate(index, "room_type", e.target.value)} placeholder="Standard DBL" /></td>
            <td className="p-2"><select className={inputClass} value={rate.meal_plan} onChange={(e) => updateRate(index, "meal_plan", e.target.value)}>{["RO","BB","HB","FB","AI","UAI"].map((v) => <option key={v}>{v}</option>)}</select></td>
            <td className="p-2"><select className={inputClass} value={rate.residency} onChange={(e) => updateRate(index, "residency", e.target.value)}><option value="all">Все</option><option value="resident">Резидент</option><option value="non_resident">Нерезидент</option></select></td>
            <td className="p-2"><input type="date" className={inputClass} value={rate.date_from} onChange={(e) => updateRate(index, "date_from", e.target.value)} /></td><td className="p-2"><input type="date" className={inputClass} value={rate.date_to} onChange={(e) => updateRate(index, "date_to", e.target.value)} /></td>
            <td className="p-2"><input type="number" min="0" step="0.01" className={inputClass} value={rate.amount} onChange={(e) => updateRate(index, "amount", e.target.value)} /></td><td className="p-2"><input type="number" min="0" className={inputClass} value={rate.allotment} onChange={(e) => updateRate(index, "allotment", e.target.value)} placeholder="∞" /></td><td className="p-2"><input type="number" min="1" className={inputClass} value={rate.min_stay} onChange={(e) => updateRate(index, "min_stay", e.target.value)} /></td>
            <td className="p-2 text-center"><input type="checkbox" checked={rate.refundable !== false} onChange={(e) => updateRate(index, "refundable", e.target.checked)} /></td><td className="p-2"><button type="button" onClick={() => setRates((rows) => rows.filter((_, i) => i !== index))} className="text-sm font-black text-rose-600">Удалить</button></td>
          </tr>)}</tbody></table></div>
        </section> : null}
      </div>
    </main>
  );
}
