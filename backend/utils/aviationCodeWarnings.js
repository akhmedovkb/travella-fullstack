const directory=require('../data/aviation/directory.json');
function codeStatus(kind,code){
 const maps=kind==='city'?[directory.cities,directory.citiesIcao]:[directory.airlines,directory.airlinesIcao];
 if(maps.some(map=>Object.hasOwn(map,code)))return 'known';
 const ambiguous=kind==='city'?[...directory.ambiguous.cities,...directory.ambiguous.airportCities]:[...directory.ambiguous.airlines,...directory.ambiguous.airlinesIcao];
 return ambiguous.includes(code)?'ambiguous':'unknown';
}
function aviationCodeIssues(d){
 const found=new Map();
 function add(kind,value,field){
  const code=String(value||'').trim().toUpperCase();
  if(kind==='city'&&code.length===4&&!/^[A-Z0-9]{4}$/.test(String(value||'').trim()))return;
  if(!(kind==='city'?/^(?:[A-Z]{3}|[A-Z0-9]{4})$/:/^[A-Z0-9]{2,3}$/).test(code))return;
  const status=codeStatus(kind,code);if(status==='known')return;
  const key=kind+':'+code;if(!found.has(key))found.set(key,{kind,code,status,fields:[]});
  const fields=found.get(key).fields;if(!fields.includes(field))fields.push(field);
 }
 for(const field of ['fromCity','toCity'])add('city',d[field],field);
 for(const line of String(d.flightDetails||'').split('\n')){
  const p=line.split(/\s*·\s*/).map(s=>s.trim()),i=p.findIndex(s=>/^\d{4}-\d{2}-\d{2}$/.test(s));
  if(i<2)continue;
  for(const v of p.slice(i-2,i))add('city',v,'flightDetails');
  for(const v of p.slice(0,i-2)){
   const match=v.match(/^([A-Z]{2,3}|[A-Z][0-9]|[0-9][A-Z])\s?\d{1,5}$/i);
   add('airline',match?match[1]:v,'flightDetails');
  }
 }
 return [...found.values()];
}
function aviationCodeMessages(d){
 const issues=aviationCodeIssues(d);
 return ['city','airline'].flatMap(kind=>{
  const list=issues.filter(i=>i.kind===kind);if(!list.length)return [];
  return ['Проверьте коды '+(kind==='city'?'городов':'авиакомпаний')+': '+list.map(i=>i.code+' — '+(i.status==='ambiguous'?'несколько вариантов в справочнике':'нет в справочнике')).join('; ')+'.'];
 });
}
const aviationCodeHint='Сверьте коды с бронированием. Если есть ошибка, исправьте город или поле «Рейс и багаж». Можно вписать название словами. Если код верный — подтвердите проверку.';
module.exports={aviationCodeIssues,aviationCodeMessages,aviationCodeHint,codeStatus};

