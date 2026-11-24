const {calculate,feeText,units}=require('../ai/bookingPricing');
const {formatFlightDetails,displayCity}=require('./bookingFlightDisplay');
const {displayAirline}=require('./aviationDirectory');
const clean=v=>String(v??'').trim();
const readableDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?v.split('-').reverse().join('.'):clean(v);
const money=v=>Number(v).toLocaleString('ru-RU',{maximumFractionDigits:2});
function publicPriceExtras(details,category,shownPrice){
 const d={...details,category},lines=[];
 if(d.pricePeriod==='night')lines.push('🌙 Основная цена — за ночь');
 else if(d.pricePeriod==='full')lines.push(category==='refused_flight'?'📅 Цена за все указанные рейсы':'📅 Основная цена — за весь срок');
 if(d.surchargesStatus==='none')lines.push('✅ Доплат нет');
 if(d.surchargesStatus==='unknown')lines.push('➕ Доплаты уточняются');
 if(d.surchargesStatus==='known'&&Array.isArray(d.surcharges)){
  for(const f of d.surcharges.slice(0,10))try{if(!Number.isFinite(Number(f.amount))||Number(f.amount)<=0)continue;lines.push((f.required?'➕ Обязательно: ':'☑️ По желанию: ')+feeText(f).replace(/ · (?:обязательно|по желанию)$/,''));}catch{}
 }
 // The calculator assumes USD; never total an ambiguous legacy currency or colleague price.
 if(/^\d+(?:[.,]\d+)?$/.test(clean(shownPrice))&&Number(shownPrice)===Number(d.grossPrice)&&(!d.currency||d.currency==='USD')){
  const q=calculate(d);
  if(q.total!==null)lines.push('💰 Итого с обязательными доплатами: '+money(q.total)+' USD '+units[q.basis]+(category==='refused_flight'?' за все рейсы':' за весь срок'));
  else if(d.surchargesStatus==='known')lines.push('⚠️ Полный итог уточните: условия доплат отличаются');
 }
 return lines.join('\n');
}
function flightItineraryText(d={}){
 const raw=clean(d.flightDetails || (/[\r\n]/.test(String(d.flightNumber||''))?d.flightNumber:'')),lines=raw.split(/\n/).filter(x=>x.trim());
 // Label directions only when the data explicitly identifies the return route.
 const structured=lines.map(line=>line.split(/\s*·\s*/).map(s=>s.trim()));
 const valid=structured.length>0&&structured.every(p=>p.findIndex(x=>/^\d{4}-\d{2}-\d{2}$/.test(x))>=2);
 if(valid){const base=structured[0],idx=base.findIndex(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)),origin=base[idx-2],destination=base[idx-1];
  return structured.map((p,i)=>{const j=p.findIndex(x=>/^\d{4}-\d{2}-\d{2}$/.test(x));const heading=structured.length===2&&p[j-2]===destination&&p[j-1]===origin?'🔁 Обратно':i===0?'🛫 Туда':'✈️ Следующий перелёт';return heading+'\n'+formatFlightDetails(lines[i]);}).join('\n\n');
 }
 if(raw){
  const blocks=raw.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
  if(blocks.length===2&&d.returnFlightDate&&blocks.every(x=>/\d{2}:\d{2}\s*[-–→]\s*\d{2}:\d{2}/.test(x))){
   return blocks.map((block,i)=>{
    const rows=block.split('\n');const match=rows[1]?.match(/^(\d{2}:\d{2})\s*[-–→]\s*(\d{2}:\d{2})(.*)$/);
    return (i?'🔁 Обратно':'🛫 Туда')+'\n'+readableDate(i?d.returnFlightDate:d.departureFlightDate||d.startDate||'')+'\n🏷 Рейсы: '+rows[0]+(match?'\n🛫 Вылет: '+match[1]+'\n🛬 Прилёт: '+match[2]+match[3]:rows.slice(1).join('\n'))+(rows.length>2?'\n'+rows.slice(2).join('\n'):'');
   }).join('\n\n');
  }
  return '✈️ Информация о перелёте\n'+formatFlightDetails(raw);
 }
 const field=(...v)=>v.map(clean).find(Boolean)||'';
 const from=field(d.directionFrom,d.fromCity,d.departureCity),to=field(d.directionTo,d.toCity,d.arrivalCity);
 const airline=field(d.airline,d.airCompany,d.carrier),baggage=field(d.baggage,d.luggage,d.baggageAllowance);
 const outbound=field(d.flightNumber,d.flightNo,d.departureFlightNumber),inbound=field(d.returnFlightNumber,d.inboundFlightNumber);
 const leg=(heading,a,b,date,number,time,arrival)=>[heading,a&&b?displayCity(a)+' → '+displayCity(b):'',date&&('📅 '+readableDate(date)),number&&('🏷 Рейс: '+number),time&&('🛫 Вылет: '+time),arrival&&('🛬 Прилёт: '+arrival)].filter(Boolean).join('\n');
 const parts=[];if(airline)parts.push('✈️ '+displayAirline(airline));
 const hasOutbound=outbound||d.departureTime||d.departureFlightTime||d.arrivalTime;
 if(hasOutbound)parts.push(leg('🛫 Туда',from,to,field(d.departureFlightDate,d.startDate),outbound,field(d.departureTime,d.departureFlightTime),field(d.arrivalTime,d.arrivalFlightTime)));
 if(inbound||d.returnFlightTime||d.returnArrivalTime)parts.push(leg('🔁 Обратно',to,from,field(d.returnFlightDate,d.returnDate),inbound,field(d.returnFlightTime,d.returnDepartureTime),field(d.returnArrivalTime)));
 if(baggage)parts.push('🧳 Багаж: '+baggage);if(d.handBaggage)parts.push('🎒 Ручная кладь: '+d.handBaggage);
 return parts.join('\n\n');
}
module.exports={publicPriceExtras,flightItineraryText};
