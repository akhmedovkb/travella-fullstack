const {AIRLINE_CODE_LABELS}=require('./flightDetailsNormalizer');
const cities={TAS:'Ташкент',MLE:'Мале'};
const displayCity=value=>cities[String(value||'').trim().toUpperCase()]||value;
const displayAirline=value=>AIRLINE_CODE_LABELS[value]||value;
function displayBookingTitle(value){return /^Отказной (?:тур|авиабилет) — /i.test(value||'')?String(value).replace(/\b(?:TAS|MLE)\b/g,displayCity):value;}
function formatFlightDetails(value){
 return String(value||'').split('\n').map(line=>{
  const p=line.split(/\s*·\s*/).map(s=>s.trim());
  const i=p.findIndex(s=>/^\d{4}-\d{2}-\d{2}$/.test(s));
  if(i<2||!p.slice(i-2,i).every(s=>/^[A-Z]{3}$/.test(s)))return line;
  const date=new Date(p[i]+'T12:00:00Z');
  if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==p[i])return line;
  const times=p.slice(i+1).filter(s=>/^\d{2}:\d{2}$/.test(s));
  if(times.length>2||times.some(s=>Number(s.slice(0,2))>23||Number(s.slice(3))>59))return line;
  const [y,m,d]=p[i].split('-'),head=p.slice(0,i-2).map(displayAirline).join(' · ');
  const lines=['✈️ '+displayCity(p[i-2])+' → '+displayCity(p[i-1]),'📅 Дата: '+d+'.'+m+'.'+y];
  if(head)lines.push('🏷 Рейс / авиакомпания: '+head);
  if(times.length===2)lines.push('🛫 Вылет: '+times[0],'🛬 Прилёт: '+times[1]);
  else if(times.length===1)lines.push('🕒 Время: '+times[0]+' · вылет или прилёт — уточните');
  for(const s of p.slice(i+1).filter(s=>!/^\d{2}:\d{2}$/.test(s))){
   if(/^Багаж\s+/i.test(s))lines.push('🧳 Багаж: '+s.replace(/^Багаж\s+/i,''));
   else if(/^Ручная кладь\s+/i.test(s))lines.push('🎒 Ручная кладь: '+s.replace(/^Ручная кладь\s+/i,''));
   else if(s)lines.push(s);
  }
  return lines.join('\n');
 }).join('\n\n');
}
module.exports={formatFlightDetails,displayCity,displayBookingTitle};
