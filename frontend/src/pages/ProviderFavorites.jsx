// src/pages/ProviderFavorites.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "../api";
import WishHeart from "../components/WishHeart";
import { apiProviderFavorites, apiToggleProviderFavorite } from "../api/providerFavorites";

/* ===== роль зрителя: провайдер ===== */
const __viewerRole = "provider";

/* ===== утилиты (взяты из Marketplace.jsx) ===== */
function normalizeList(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  const queue = [res], seen = new Set();
  const prefer = ["items","data","list","rows","results","result","services","docs","records","hits","content","payload"];
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      if (node.some(v => v && typeof v === "object")) return node;
      continue;
    }
    for (const k of prefer) if (k in node) queue.push(node[k]);
    for (const k of Object.keys(node)) if (!prefer.includes(k)) queue.push(node[k]);
  }
  return [];
}
function toast(txt) {
  const el = document.createElement("div");
  el.textContent = txt;
  el.className = "fixed top-16 right-6 z-[3000] bg-white shadow-xl border rounded-xl px-4 py-2 text-sm";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}
function _firstNonEmpty(...args){ for(const v of args){ if(v===0) return 0; if(v!=null && String(v).trim()!=="") return v } return null }
function _maybeParse(x){ if(!x) return null; if(typeof x==="object") return x; try{return JSON.parse(x)}catch{return null} }
function _mergeDetails(svc,it){ const c=[svc?.details,it?.details,svc?.detail,it?.detail,svc?.meta,svc?.params,svc?.payload,svc?.extra,svc?.data,svc?.info].map(_maybeParse).filter(Boolean); return Object.assign({},...c) }
function pick(obj,keys){ if(!obj) return null; for(const k of keys){const v=obj[k]; if(v===0 || (v!=null && String(v).trim()!=="")) return v} return null }
function renderTelegram(v){ if(!v) return null; const s=String(v).trim(); let href=null,label=s; if(/^https?:\/\//i.test(s)) href=s; else if(s.startsWith("@")){href=`https://t.me/${s.slice(1)}`;label=s} else if(/^[A-Za-z0-9_]+$/.test(s)){href=`https://t.me/${s}`;label=`@${s}`} return {href,label} }
const providerCache=new Map();
async function fetchProviderProfile(id){
  if(!id) return null;
  if(providerCache.has(id)) return providerCache.get(id);
  const urls=[`/api/providers/${id}`,`/api/provider/${id}`,`/api/suppliers/${id}`,`/api/supplier/${id}`,`/api/agencies/${id}`,`/api/agency/${id}`,`/api/companies/${id}`,`/api/company/${id}`,`/api/users/${id}`,`/api/user/${id}`];
  let prof=null;
  for(const u of urls){ try{ const r=await apiGet(u); const o=r&&(r.data||r.item||r.profile||r.provider||r.company)||r; if(o&&(o.id||o.name||o.title)){ prof=o; break } }catch{} }
  providerCache.set(id,prof||null); return prof;
}
function extractServiceFields(item){
  const svc=item?.service||item||{};
  const details=_mergeDetails(svc,item);
  const bag={...details,...svc,...item};
  const title=_firstNonEmpty(svc.title,svc.name,details?.title,details?.name,details?.eventName,item?.title,item?.name);
  const rawPrice=(__viewerRole==="client")
    ? _firstNonEmpty(details?.grossPrice,details?.priceGross,details?.totalPrice,svc.grossPrice,svc.price_gross)
    : _firstNonEmpty(details?.netPrice,details?.price,details?.totalPrice,details?.priceNet,svc.netPrice,svc.price,item?.price,details?.grossPrice);
  const prettyPrice = rawPrice==null ? null : new Intl.NumberFormat().format(Number(rawPrice));
  const hotel=_firstNonEmpty(details?.hotel,details?.hotelName,details?.hotel?.name,details?.refused_hotel_name,svc.hotel,svc.hotel_name,svc.refused_hotel_name);
  const accommodation=_firstNonEmpty(details?.accommodation,details?.accommodationCategory,details?.room,details?.roomType,details?.room_category,svc.accommodation,svc.room,svc.room_type);
  const left=_firstNonEmpty(bag.hotel_check_in,bag.checkIn,bag.startDate,bag.start_flight_date,bag.startFlightDate,bag.departureFlightDate);
  const right=_firstNonEmpty(bag.hotel_check_out,bag.checkOut,bag.returnDate,bag.end_flight_date,bag.endFlightDate,bag.returnFlightDate);
  const dates=left&&right?`${left} → ${right}`:left||right||null;
  const inlineProvider=_firstNonEmpty(svc.provider,svc.provider_profile,svc.supplier,svc.vendor,svc.agency,svc.owner,item.provider,item.provider_profile,item.supplier,item.vendor,item.agency,item.owner,details?.provider)||{};
  const providerId=_firstNonEmpty(svc.provider_id,svc.providerId,item.provider_id,item.providerId,details?.provider_id,svc.owner_id,svc.agency_id,inlineProvider?.id,inlineProvider?._id);
  const flatName=_firstNonEmpty(pick(bag,["provider_name","supplier_name","vendor_name","agency_name","company_name","providerTitle","display_name"]));
  const flatPhone=_firstNonEmpty(pick(bag,["provider_phone","supplier_phone","vendor_phone","agency_phone","company_phone","contact_phone","phone","whatsapp","whats_app"]));
  const flatTg=_firstNonEmpty(pick(bag,["provider_telegram","supplier_telegram","vendor_telegram","agency_telegram","company_telegram","telegram","tg","telegram_username","telegram_link","provider_social","supplier_social","vendor_social","agency_social","company_social","social","social_link"]));
  const status=_firstNonEmpty(svc.status,item.status,details?.status);
  return { svc, details, title, hotel, accommodation, dates, prettyPrice, inlineProvider, providerId, flatName, flatPhone, flatTg, status };
}
function firstImageFrom(val){
  if(typeof val==="string"){
    let s=val.trim(); if(!s) return null;
    if(/^data:image\//i.test(s)){ s=s.replace(/\s+/g,""); if(/;base64(?!,)/i.test(s)) s=s.replace(/;base64/i,";base64,"); return s; }
    if(/^[A-Za-z0-9+/=\s]+$/.test(s)&&s.replace(/\s+/g,"").length>100) return `data:image/jpeg;base64,${s.replace(/\s+/g,"")}`;
    if(/^(https?:|blob:|file:|\/)/i.test(s)) return s;
    return `${window.location.origin}/${s.replace(/^\.?\//,"")}`;
  }
  if(Array.isArray(val)){ for(const v of val){ const hit=firstImageFrom(v); if(hit) return hit } return null }
  if(val&&typeof val==="object"){ return firstImageFrom(val.url??val.src??val.href??val.link??val.path??val.data??val.base64) }
  return null;
}
function resolveExpireAt(s){
  const d=s?.details||{};
  const cand=[s?.expires_at,s?.expire_at,s?.expireAt,d.expires_at,d.expire_at,d.expiresAt,d.expiration,d.expiration_at,d.expirationAt,d.expiration_ts,d.expirationTs].find(v=>v!=null&&String(v).trim?.()!=="");
  let ts=null;
  if(cand!=null){ if(typeof cand==="number") ts=cand>1e12?cand:cand*1000; else { const p=Date.parse(String(cand)); if(!Number.isNaN(p)) ts=p } }
  if(!ts){ const ttl=d.ttl_hours??d.ttlHours??s?.ttl_hours??null; if(ttl && Number(ttl)>0 && s?.created_at){ const created=Date.parse(s.created_at); if(!Number.isNaN(created)) ts=created+Number(ttl)*3600*1000 } }
  return ts;
}
function formatLeft(ms){ if(ms<=0) return "00:00:00"; const total=Math.floor(ms/1000); const dd=Math.floor(total/86400); const hh=Math.floor((total%86400)/3600); const mm=Math.floor((total%3600)/60); const ss=total%60; const pad=n=>String(n).padStart(2,"0"); return dd>0?`${dd}д ${pad(hh)}:${pad(mm)}`:`${pad(hh)}:${pad(mm)}:${pad(ss)}` }
function Stars({value=0,size=14}){ const full=Math.round(Number(value)*2)/2; return (
  <div className="flex items-center gap-0.5">
    {Array.from({length:5}).map((_,i)=>{ const filled=i+1<=full; return (
      <svg key={i} width={size} height={size} viewBox="0 0 24 24" className={filled?"text-amber-400":"text-gray-400"} fill={filled?"currentColor":"none"} stroke="currentColor" strokeWidth="1.5">
        <path d="M12 .587l3.668 7.431L24 9.748l-6 5.847L19.335 24 12 20.202 4.665 24 6 15.595 0 9.748l8.332-1.73z"/>
      </svg>
    )})}
  </div>
)}
function TooltipPortal({visible,x,y,children}){ if(!visible) return null; return createPortal(<div className="fixed z-[3000] pointer-events-none" style={{top:y,left:x}}>{children}</div>, document.body) }

/* ===================== страница ===================== */
export default function ProviderFavorites(){
  const { t } = useTranslation();

  const [nowMin, setNowMin] = useState(() => Math.floor(Date.now()/60000));
  useEffect(()=>{ const id=setInterval(()=>setNowMin(Math.floor(Date.now()/60000)),60000); return ()=>clearInterval(id)},[]);
  const now = nowMin*60000;

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [favIds, setFavIds] = useState(new Set());

  // загрузка
  useEffect(()=>{
    (async ()=>{
      setLoading(true);
      try{
        const raw = await apiProviderFavorites();
        const list = normalizeList(raw);
        setItems(list);
        const ids = list.map(x => x.service_id ?? x.service?.id ?? x.id).filter(Boolean).map(String);
        setFavIds(new Set(ids));
      }catch{ setItems([]) } finally{ setLoading(false) }
    })();
  },[]);

  // тоггл
  const toggleFavorite = async (serviceId)=>{
    const key = String(serviceId);
    const flipTo = !favIds.has(key);
    // оптимистично красим/убираем
    setFavIds(prev => { const next=new Set(prev); flipTo ? next.add(key) : next.delete(key); return next; });
    try{
      const res = await apiToggleProviderFavorite(serviceId);
      if (typeof res?.added === "boolean" && res.added !== flipTo) {
        // сервер сказал обратное — подправим
        setFavIds(prev => { const next=new Set(prev); res.added ? next.add(key) : next.delete(key); return next; });
      }
      if (!res || res.error) throw new Error();
      // для бейджа в шапке
      window.dispatchEvent(new Event("provider:favorites:changed"));
      toast(flipTo ? (t("favorites.added_toast") || "Добавлено в избранное")
                   : (t("favorites.removed_toast") || "Удалено из избранного"));
    }catch{
      // откат
      setFavIds(prev => { const next=new Set(prev); flipTo ? next.delete(key) : next.add(key); return next; });
      toast(t("toast.favoriteError") || "Не удалось изменить избранное");
    }
  };

  // модалка быстрого запроса
  const [qrOpen, setQrOpen] = useState(false);
  const [qrServiceId, setQrServiceId] = useState(null);
  const [qrProviderId, setQrProviderId] = useState(null);
  const [qrServiceTitle, setQrServiceTitle] = useState("");
  const openQuickRequest = (serviceId, providerId, serviceTitle)=>{
    setQrServiceId(serviceId); setQrProviderId(providerId||null); setQrServiceTitle(serviceTitle||""); setQrOpen(true);
  };
  const submitQuickRequest = async (note)=>{
    try{
      await apiPost("/api/requests", { service_id: qrServiceId, provider_id: qrProviderId || undefined, service_title: qrServiceTitle || undefined, note: note || undefined });
      toast(t("messages.request_sent") || "Запрос отправлен");
      window.dispatchEvent(new CustomEvent("request:created",{detail:{service_id:qrServiceId,title:qrServiceTitle}}));
    }catch{
      toast(t("errors.request_send") || "Не удалось отправить запрос");
    }finally{
      setQrOpen(false); setQrServiceId(null); setQrProviderId(null); setQrServiceTitle("");
    }
  };

  const Card = ({ it, now })=>{
    const { svc, details, title, hotel, accommodation, dates, prettyPrice,
            inlineProvider, providerId, flatName, flatPhone, flatTg, status: statusRaw } = extractServiceFields(it);
    const id = svc.id ?? it.service_id ?? it.id;
    const image = firstImageFrom([svc.images, details?.images, it?.images, svc.cover, svc.image, details?.cover, details?.image, it?.cover, it?.image, details?.photo, details?.picture, details?.imageUrl, svc.image_url, it?.image_url]);
    const [provider, setProvider] = useState(null);
    useEffect(()=>{ let alive=true; (async()=>{ if(!providerId) return; const p=await fetchProviderProfile(providerId); if(alive) setProvider(p) })(); return ()=>{alive=false}; },[providerId]);
    const prov = { ...(inlineProvider||{}), ...(provider||{}) };
    const supplierName = _firstNonEmpty(prov?.name,prov?.title,prov?.display_name,prov?.company_name,prov?.brand,flatName);
    const supplierPhone = _firstNonEmpty(prov?.phone,prov?.phone_number,prov?.phoneNumber,prov?.tel,prov?.mobile,prov?.whatsapp,prov?.whatsApp,prov?.phones?.[0],prov?.contacts?.phone,prov?.contact_phone,flatPhone);
    const supplierTg = renderTelegram(_firstNonEmpty(prov?.telegram,prov?.tg,prov?.telegram_username,prov?.telegram_link,prov?.contacts?.telegram,prov?.socials?.telegram,prov?.social,prov?.social_link,flatTg));
    const rating = Number(svc.rating ?? it.rating ?? 0);
    const status = typeof statusRaw === "string" && statusRaw.toLowerCase()==="draft" ? null : statusRaw;
    const badge = rating > 0 ? `★ ${rating.toFixed(1)}` : status;
    const isFav = favIds.has(String(id));
    const expireAt = resolveExpireAt(svc);
    const leftMs = expireAt ? Math.max(0, expireAt - now) : null;
    const hasTimer = !!expireAt;
    const timerText = hasTimer ? formatLeft(leftMs) : null;

    // мини-отзывы
    const [revOpen, setRevOpen] = useState(false);
    const [revPos, setRevPos] = useState({x:0,y:0});
    const [revData, setRevData] = useState({avg:0, count:0, items:[]});
    const revBtnRef = useRef(null);
    const openReviews = async ()=>{
      if(revBtnRef.current){ const r=revBtnRef.current.getBoundingClientRect(); setRevPos({x:r.left-8,y:r.top-8}) }
      setRevOpen(true);
      try{
        const res = await apiGet(`/api/reviews/service/${id}?limit=3`);
        const data = res && typeof res==="object" ? res : {};
        setRevData({ avg:Number(data.avg)||0, count:Number(data.count)||0, items:Array.isArray(data.items)?data.items:[] });
      }catch{ setRevData({avg:0,count:0,items:[]}) }
    };
    const closeReviews = ()=> setRevOpen(false);

    return (
      <div className="group relative bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
        <div className="aspect-[16/10] bg-gray-100 relative">
          {image ? (
            <img src={image} alt={title || t("marketplace.no_image")} className="w-full h-full object-cover"
                 onError={(e)=>{ e.currentTarget.src="" }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">
              <span className="text-sm">{t("marketplace.no_image") || "Нет изображения"}</span>
            </div>
          )}

          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-2">
              {hasTimer && (
                <span className={`pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs backdrop-blur-md ring-1 ring-white/20 shadow ${leftMs>0?"bg-orange-600/95":"bg-gray-400/90"}`} title={leftMs>0?(t("countdown.until_end")||"До окончания"):(t("countdown.expired")||"Время истекло")}>
                  {timerText}
                </span>
              )}
              {!hasTimer && badge && (
                <span className="pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs bg-black/50 backdrop-blur-md ring-1 ring-white/20">
                  {badge}
                </span>
              )}
              <button ref={revBtnRef} className="pointer-events-auto p-1.5 rounded-full bg-black/30 hover:bg-black/40 text-white backdrop-blur-md ring-1 ring-white/20 relative"
                      onMouseEnter={openReviews} onMouseLeave={closeReviews}
                      title={t("marketplace.reviews") || "Отзывы об услуге"}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 15a4 4 0 0 1-4 4H8l-4 4V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z" />
                </svg>
              </button>
            </div>

            {/* Сердечко — такое же, как в Marketplace */}
            <div className="pointer-events-auto">
              <WishHeart
                active={isFav}
                onClick={(e)=>{ e.stopPropagation(); toggleFavorite(id); }}
              />
            </div>
          </div>

          {/* hover-оверлей */}
          <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="absolute inset-x-0 bottom-0 p-3">
              <div className="rounded-lg bg-black/55 backdrop-blur-md text-white text-xs sm:text-sm p-3 ring-1 ring-white/15 shadow-lg">
                <div className="font-semibold line-clamp-2">{title}</div>
                {hotel && (<div><span className="opacity-80">Отель: </span><span className="font-medium">{hotel}</span></div>)}
                {accommodation && (<div><span className="opacity-80">Размещение: </span><span className="font-medium">{accommodation}</span></div>)}
                {dates && (<div><span className="opacity-80">{t("common.date") || "Дата"}: </span><span className="font-medium">{dates}</span></div>)}
                {prettyPrice && (<div><span className="opacity-80">{t("marketplace.price") || "Цена"}: </span><span className="font-semibold">{prettyPrice}</span></div>)}
              </div>
            </div>
          </div>
        </div>

        {/* тултип отзывов */}
        <TooltipPortal visible={revOpen} x={revPos.x} y={revPos.y}>
          <div className="pointer-events-none max-w-xs rounded-lg bg-black/85 text-white text-xs p-3 shadow-2xl ring-1 ring-white/10">
            <div className="mb-1 font-semibold">{t("marketplace.reviews") || "Отзывы об услуге"}</div>
            <div className="flex items-center gap-2">
              <Stars value={revData.avg} />
              <span className="opacity-80">({revData.count || 0})</span>
            </div>
            <div className="mt-1">
              {!revData.items?.length ? <span className="opacity-80">—</span> : (
                <ul className="list-disc ml-4 space-y-1">
                  {revData.items.slice(0,2).map(r => <li key={r.id} className="line-clamp-2 opacity-90">{r.text || ""}</li>)}
                </ul>
              )}
            </div>
          </div>
        </TooltipPortal>

        {/* тело карточки */}
        <div className="p-3 flex-1 flex flex-col">
          <div className="font-semibold line-clamp-2">{title}</div>
          {prettyPrice && (
            <div className="mt-1 text-sm">
              {t("marketplace.price") || "Цена"}: <span className="font-semibold">{prettyPrice}</span>
            </div>
          )}
          {(supplierName || supplierPhone || supplierTg?.label) && (
            <div className="mt-2 text-sm space-y-0.5">
              {supplierName && (<div><span className="text-gray-500">{t("marketplace.supplier") || "Поставщик"}: </span><span className="font-medium">{supplierName}</span></div>)}
              {supplierPhone && (<div><span className="text-gray-500">{t("marketplace.phone") || "Телефон"}: </span><a href={`tel:${String(supplierPhone).replace(/\s+/g,"")}`} className="underline">{supplierPhone}</a></div>)}
              {supplierTg?.label && (<div><span className="text-gray-500">{t("marketplace.telegram") || "Телеграм"}: </span>{supplierTg.href ? <a href={supplierTg.href} target="_blank" rel="noopener noreferrer" className="underline">{supplierTg.label}</a> : <span className="font-medium">{supplierTg.label}</span>}</div>)}
            </div>
          )}
          <div className="mt-auto pt-3">
            <button onClick={()=>openQuickRequest(id, providerId, title)}
                    className="w-full bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600">
              {t("actions.quick_request") || "Быстрый запрос"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      <h2 className="text-xl font-semibold mb-4">{t("provider.favorites.tab") || "Избранное"}</h2>

      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && <div className="text-gray-500">{t("common.loading") || "Загрузка…"}.</div>}
        {!loading && !items.length && <div className="text-gray-500">{t("marketplace.no_results") || "Нет результатов"}</div>}
        {!loading && !!items.length && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it) => (
              <Card key={it.id || it.service?.id || it.service_id || JSON.stringify(it)} it={it} now={now}/>
            ))}
          </div>
        )}
      </div>

      {/* модалка быстрого запроса — та же, что в Marketplace (если она у тебя отдельным компонентом, подключи его здесь) */}
      {/* <QuickRequestModal open={qrOpen} onClose={()=>setQrOpen(false)} onSubmit={submitQuickRequest}/> */}
    </div>
  );
}
