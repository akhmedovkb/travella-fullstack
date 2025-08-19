// src/pages/ProviderFavorites.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiProviderFavorites, apiToggleProviderFavorite } from "../api/providerFavorites";
import { apiGet, apiPost } from "../api";
import WishHeart from "../components/WishHeart";

/* ==== мини-тосты ==== */
function toast(txt) {
  const el = document.createElement("div");
  el.textContent = txt;
  el.className = "fixed top-16 right-6 z-[3000] bg-white shadow-xl border rounded-xl px-4 py-2 text-sm";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

/* ===== утилиты из Marketplace (сокращённо) ===== */
function _maybeParse(x){ if(!x) return null; if(typeof x==="string"){try{return JSON.parse(x);}catch{return null}} return typeof x==="object"?x:null }
function _firstNonEmpty(...args){ for(const v of args){ if(v===0 || (v!==undefined && v!==null && String(v).trim()!=="")) return v; } return null }
function firstImageFrom(val){
  if(typeof val==="string"){ let s=val.trim(); if(!s) return null;
    if(/^data:image\//i.test(s)){ s=s.replace(/\s+/g,""); if(/;base64(?!,)/i.test(s)) s=s.replace(/;base64/i,";base64,"); return s; }
    if(/^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g,"").length>100) return `data:image/jpeg;base64,${s.replace(/\s+/g,"")}`;
    if(/^(https?:|blob:|file:|\/)/i.test(s)) return s; return `${window.location.origin}/${s.replace(/^\.?\//,"")}`;
  }
  if(Array.isArray(val)){ for(const v of val){ const r=firstImageFrom(v); if(r) return r } return null }
  if(val && typeof val==="object"){ return firstImageFrom(val.url??val.src??val.href??val.path??val.data??val.base64) }
  return null;
}
function resolveExpireAt(service){
  const s=service||{}; const d=s.details||{};
  const c=[s.expires_at,s.expire_at,s.expireAt,d.expires_at,d.expire_at,d.expiresAt,d.expiration,d.expiration_at,d.expirationAt,d.expiration_ts,d.expirationTs].find(v=>v!==undefined&&v!==null&&String(v).trim?.()!=="");
  let ts=null; if(c!==undefined&&c!==null){ if(typeof c==="number") ts=c>1e12?c:c*1000; else { const p=Date.parse(String(c)); if(!Number.isNaN(p)) ts=p; } }
  if(!ts){ const ttl=d.ttl_hours??d.ttlHours??s.ttl_hours??null; if(ttl&&Number(ttl)>0&&s.created_at){ const created=Date.parse(s.created_at); if(!Number.isNaN(created)) ts=created+Number(ttl)*3600*1000; } }
  return ts;
}
function formatLeft(ms){ if(ms<=0) return "00:00:00"; const t=Math.floor(ms/1000); const dd=Math.floor(t/86400); const hh=Math.floor((t%86400)/3600); const mm=Math.floor((t%3600)/60); const ss=t%60; const pad=n=>String(n).padStart(2,"0"); return dd>0?`${dd}д ${pad(hh)}:${pad(mm)}`:`${pad(hh)}:${pad(mm)}:${pad(ss)}`; }
function renderTelegram(v){ if(!v) return null; const s=String(v).trim(); let href=null,label=s; if(/^https?:\/\//i.test(s)) href=s; else if(s.startsWith("@")){href=`https://t.me/${s.slice(1)}`;label=s;} else if(/^[A-Za-z0-9_]+$/.test(s)){href=`https://t.me/${s}`;label=`@${s}`;} return {href,label}; }
function extractServiceFields(item){
  const svc=item?.service||item||{}; const details=Object.assign({}, ...[svc?.details,item?.details,svc?.detail,item?.detail,svc?.meta,svc?.params,svc?.payload,svc?.extra,svc?.data,svc?.info].map(_maybeParse).filter(Boolean));
  const bag={...details,...svc,...item};
  const title=_firstNonEmpty(svc.title,svc.name,details?.title,details?.name,item?.title,item?.name);
  const rawPrice=_firstNonEmpty(details?.netPrice,details?.price,details?.totalPrice,details?.priceNet,svc.netPrice,svc.price,item?.price,details?.grossPrice);
  const prettyPrice=rawPrice==null?null:new Intl.NumberFormat().format(Number(rawPrice));
  const left=_firstNonEmpty(bag.hotel_check_in,bag.checkIn,bag.startDate,bag.start_flight_date,bag.startFlightDate);
  const right=_firstNonEmpty(bag.hotel_check_out,bag.checkOut,bag.returnDate,bag.end_flight_date,bag.endFlightDate);
  const dates=left&&right?`${left} → ${right}`:left||right||null;
  const inlineProvider=_firstNonEmpty(svc.provider,svc.provider_profile,item.provider,item.provider_profile,details?.provider)||{};
  const providerId=_firstNonEmpty(svc.provider_id,svc.providerId,item.provider_id,item.providerId,inlineProvider?.id,inlineProvider?._id);
  const flatName=_firstNonEmpty(bag.provider_name,bag.supplier_name,bag.vendor_name,bag.agency_name,bag.company_name,bag.display_name);
  const flatPhone=_firstNonEmpty(bag.provider_phone,bag.supplier_phone,bag.vendor_phone,bag.agency_phone,bag.company_phone,bag.contact_phone,bag.phone,bag.whatsapp);
  const flatTg=_firstNonEmpty(bag.provider_telegram,bag.supplier_telegram,bag.vendor_telegram,bag.agency_telegram,bag.company_telegram,bag.telegram,bag.tg,bag.telegram_username,bag.telegram_link,bag.social,bag.social_link);
  const status=_firstNonEmpty(svc.status,item.status,details?.status);
  return { svc, details, title, dates, prettyPrice, inlineProvider, providerId, flatName, flatPhone, flatTg, status };
}

/* ==================== страница ==================== */
export default function ProviderFavorites() {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);       // список любимых услуг (как в маркетплейсе)
  const [favIds, setFavIds] = useState(new Set());
  const [loading, setLoading] = useState(false);

  // загрузка избранного
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const list = await apiProviderFavorites();
        const arr = (Array.isArray(list) ? list : []).map(x => x.service || x);
        const ids = arr.map(x => String(x.id || x.service_id)).filter(Boolean);
        if (alive) {
          setItems(arr);
          setFavIds(new Set(ids));
        }
      } catch {
        if (alive) {
          setItems([]);
          setFavIds(new Set());
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // оптимистичное удаление/добавление
  async function toggleFavorite(id) {
    const key = String(id);
    const wasFav = favIds.has(key);

    // 1) оптимистично меняем бейдж и локальный список
    setFavIds(prev => {
      const next = new Set(prev);
      if (wasFav) next.delete(key); else next.add(key);
      return next;
    });
    if (wasFav) {
      setItems(prev => prev.filter(it => String(it.id ?? it.service_id) !== key));
    }

    try {
      const res = await apiToggleProviderFavorite(id);
      const added = !!res?.added;

      // если сервер сказал иначе — поправим
      if (added !== !wasFav) {
        setFavIds(prev => {
          const next = new Set(prev);
          if (added) next.add(key); else next.delete(key);
          return next;
        });
        if (!added) {
          setItems(prev => prev.filter(it => String(it.id ?? it.service_id) !== key));
        }
      }

      window.dispatchEvent(new Event("provider:favorites:changed"));
      toast(added ? (t("favorites.added_toast") || "Добавлено в избранное")
                  : (t("favorites.removed_toast") || "Удалено из избранного"));
    } catch {
      // 2) откат при ошибке
      setFavIds(prev => {
        const next = new Set(prev);
        if (wasFav) next.add(key); else next.delete(key);
        return next;
      });
      if (wasFav) {
        // вернём карточку
        // самый простой способ — перезагрузить список
        const list = await apiProviderFavorites().catch(() => []);
        const arr = (Array.isArray(list) ? list : []).map(x => x.service || x);
        setItems(arr);
        setFavIds(new Set(arr.map(x => String(x.id || x.service_id)).filter(Boolean)));
      }
      toast(t("toast.favoriteError") || "Не удалось изменить избранное");
    }
  }

  const now = Date.now();

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      <h2 className="text-xl font-semibold mb-4">{t("provider.favorites.tab") || "Избранное"}</h2>

      <div className="bg-white rounded-xl shadow p-6 border">
        {loading && <div className="text-gray-500">{t("common.loading") || "Загрузка…"}.</div>}
        {!loading && !items.length && (
          <div className="text-gray-500">{t("favorites.empty") || "Избранного пока нет."}</div>
        )}
        {!loading && !!items.length && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {items.map((it) => {
              const { svc, title, inlineProvider, providerId, flatName, flatPhone, flatTg, prettyPrice, status } =
                extractServiceFields(it);
              const id = svc.id ?? it.id ?? it.service_id;
              const image = firstImageFrom([svc.images, svc.cover, svc.image, svc.image_url, it.images, it.image, it.image_url]);
              const expireAt = resolveExpireAt(svc);
              const leftMs = expireAt ? Math.max(0, expireAt - now) : null;
              const hasTimer = !!expireAt;
              const timerText = hasTimer ? formatLeft(leftMs) : null;
              const supplierName = _firstNonEmpty(inlineProvider?.name, inlineProvider?.title, flatName);
              const supplierPhone = flatPhone;
              const supplierTg = renderTelegram(flatTg);
              const isFav = favIds.has(String(id));

              return (
                <div key={id} className="group relative bg-white border rounded-xl overflow-hidden shadow-sm flex flex-col">
                  <div className="aspect-[16/10] bg-gray-100 relative">
                    {image ? (
                      <img src={image} alt={title || "Image"} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400">
                        <span className="text-sm">{t("marketplace.no_image") || "Нет изображения"}</span>
                      </div>
                    )}

                    <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                      <div className="flex items-center gap-2">
                        {hasTimer && (
                          <span
                            className={`pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs backdrop-blur-md ring-1 ring-white/20 shadow ${
                              leftMs > 0 ? "bg-orange-600/95" : "bg-gray-400/90"
                            }`}
                            title={leftMs > 0 ? (t("countdown.until_end") || "До окончания") : (t("countdown.expired") || "Время истекло")}
                          >
                            {timerText}
                          </span>
                        )}
                        {!hasTimer && status && (
                          <span className="pointer-events-auto px-2 py-0.5 rounded-full text-white text-xs bg-black/50 backdrop-blur-md ring-1 ring-white/20">
                            {status}
                          </span>
                        )}
                      </div>

                      <div className="pointer-events-auto">
                        <WishHeart
                          active={isFav}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(id);
                          }}
                        />
                      </div>


                    </div>
                  </div>

                  <div className="p-3 flex-1 flex flex-col">
                    <div className="font-semibold line-clamp-2">{title}</div>
                    {prettyPrice && (
                      <div className="mt-1 text-sm">
                        {t("marketplace.price") || "Цена"}: <span className="font-semibold">{prettyPrice}</span>
                      </div>
                    )}

                    {(supplierName || supplierPhone || supplierTg?.label) && (
                      <div className="mt-2 text-sm space-y-0.5">
                        {supplierName && (
                          <div>
                            <span className="text-gray-500">{t("marketplace.supplier") || "Поставщик"}: </span>
                            <span className="font-medium">{supplierName}</span>
                          </div>
                        )}
                        {supplierPhone && (
                          <div>
                            <span className="text-gray-500">{t("marketplace.phone") || "Телефон"}: </span>
                            <a href={`tel:${String(supplierPhone).replace(/\s+/g, "")}`} className="underline">
                              {supplierPhone}
                            </a>
                          </div>
                        )}
                        {supplierTg?.label && (
                          <div>
                            <span className="text-gray-500">{t("marketplace.telegram") || "Телеграм"}: </span>
                            {supplierTg.href ? (
                              <a href={supplierTg.href} target="_blank" rel="noopener noreferrer" className="underline">
                                {supplierTg.label}
                              </a>
                            ) : (
                              <span className="font-medium">{supplierTg.label}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-auto pt-3">
                      <button
                        onClick={() => {
                          // быстрый запрос — как в Marketplace
                          apiPost("/api/requests", { service_id: id, provider_id: providerId }).then(
                            () => toast(t("messages.request_sent") || "Запрос отправлен"),
                            () => toast(t("errors.request_send") || "Не удалось отправить запрос"),
                          );
                        }}
                        className="w-full bg-orange-500 text-white rounded-lg px-3 py-2 text-sm font-semibold hover:bg-orange-600"
                      >
                        {t("actions.quick_request") || "Быстрый запрос"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
