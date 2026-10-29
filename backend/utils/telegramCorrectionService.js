const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {ensureServiceModerationEvents}=require('./serviceModerationEvents');
const {readProviderCorrection}=require('./providerCorrections');
const {buildServiceEditChanges}=require('./serviceEditHistory');
const {REFUSED_CATEGORIES}=require('./serviceCategories');
const {isProviderServiceCategoryAllowed}=require('./providerServiceCatalog');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const object=v=>{if(typeof v==='string'){try{return JSON.parse(v)||{};}catch{return {};}}return v&&typeof v==='object'&&!Array.isArray(v)?v:{};};
const files=v=>{if(typeof v==="string"){try{v=JSON.parse(v);}catch{return [];}}return Array.isArray(v)?v.filter(Boolean):[];};
const token=c=>createHash('sha256').update(`${c.requestId}:${c.editVersion}:${c.fingerprint}`).digest('hex').slice(0,10);
const ROW=`SELECT s.*,to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edit_version FROM services s WHERE id=$1 AND provider_id=$2 AND deleted_at IS NULL`;
async function getCorrection(db,providerId,serviceId,lock=false){
 const q=await db.query(ROW+(lock?' FOR UPDATE':''),[serviceId,providerId]);const service=q.rows[0];
 if(!service)throw fail('Услуга не найдена.',404);
 service.details=object(service.details);service.images=files(service.images);
 const correction=await readProviderCorrection(db,service);
 if(!correction)throw fail('У этой услуги нет открытых замечаний.');
 const progress=await db.query(`SELECT meta FROM service_moderation_events WHERE service_id=$1 AND actor_id=$2 AND action='provider_correction_prepared' AND meta->>'requestId'=$3 ORDER BY created_at DESC,id DESC LIMIT 1`,[serviceId,providerId,String(correction.requestId)]);
 const saved=progress.rows[0]?.meta;
 return {service,correction,token:token(correction),checkedCodes:saved?.fingerprint===correction.fingerprint?(saved.checkedCodes || []).filter(c=>correction.reasonCodes.includes(c)):[]};
}
async function listCorrections(pool,providerId,page=0){
 await ensureServiceModerationEvents(pool);
 const rows=await pool.query(`SELECT s.* FROM services s WHERE provider_id=$1 AND deleted_at IS NULL AND (status IN ('draft','rejected') OR moderation_status='rejected') AND (rejected_reason IS NOT NULL OR EXISTS(SELECT 1 FROM service_moderation_events e WHERE e.service_id=s.id AND e.action IN ('rejected','correction_requested') AND NOT EXISTS(SELECT 1 FROM service_moderation_events a WHERE a.service_id=s.id AND a.action IN ('approved','approved_clean','approved_with_warnings') AND a.created_at>e.created_at))) ORDER BY updated_at DESC,id DESC LIMIT 9 OFFSET $2`,[providerId,Math.max(0,Math.min(100000,page))*8]);
 return {items:rows.rows.slice(0,8),more:rows.rows.length>8};
}
function validateField(field,input,service,providerType){
 const d={...object(service.details)};const patch={details:d};
 const text=String(input??'').trim();
 if(['net','gross'].includes(field)){
  if(!/^\d+(?:[.,]\d{1,2})?$/.test(text)||Number(text.replace(',','.'))<=0||Number(text.replace(',','.'))>1e12)throw fail('Введите положительную цену, например 4700 или 4700,50.',400);
  const n=text.replace(',','.');const names=field==='net'?['netPrice','net_price']:['grossPrice','gross_price','price'];
  d[names[0]]=n;for(const key of names.slice(1))if(Object.hasOwn(d,key))d[key]=n;
  const net=Number(d.netPrice??d.net_price??service.net_price),gross=Number(d.grossPrice??d.gross_price??d.price??service.gross_price??service.price);
  if(net>0&&gross>0&&gross<net)throw fail('Gross не может быть ниже Netto. Сначала исправьте соответствующую цену.',400);
  if(field==='gross'&&!String(service.category).startsWith('refused_')&&service.category!=='author_tour')patch.price=Number(n);
 }else if(field==='dates'){
  const dates=text.match(/\d{4}-\d{2}-\d{2}/g)||[];const single=['refused_ticket','refused_event_ticket'].includes(service.category);
  if(dates.length!==(single?1:2)||dates.some(v=>!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)||(dates[1]&&dates[1]<dates[0]))throw fail(single?'Введите дату YYYY-MM-DD.':'Введите две даты YYYY-MM-DD YYYY-MM-DD, окончание не раньше начала.',400);
  d.startDate=dates[0];if(dates[1])d.endDate=dates[1];
  if(single)d.eventDate=dates[0];
  for(const key of ['departureDate','departureFlightDate','checkInDate','checkinDate'])if(Object.hasOwn(d,key)||key===(service.category==='refused_flight'?'departureFlightDate':service.category==='refused_hotel'?'checkInDate':''))d[key]=dates[0];
  for(const key of ['returnDate','returnFlightDate','checkOutDate','checkoutDate'])if(dates[1]&&(Object.hasOwn(d,key)||key===(service.category==='refused_flight'?'returnFlightDate':service.category==='refused_hotel'?'checkOutDate':'')))d[key]=dates[1];
 }else if(field==='category'){
  const allowed=isProviderServiceCategoryAllowed(providerType,text)||providerType==='agent'&&[...REFUSED_CATEGORIES,'author_tour'].includes(text)||providerType==='hotel'&&text==='refused_hotel';
  if(!allowed)throw fail('Категория недоступна вашему типу поставщика.',400);patch.category=text;
 }else if(['title','description','hotel','roomCategory','accommodation','food','flightDetails','directionCountry','directionFrom','directionTo'].includes(field)){
  if(!text||text.length>(field==='description'||field==='flightDetails'?3000:200))throw fail('Введите текст от 1 до 200 символов (описание и рейс — до 3000).',400);
  if(['title','description'].includes(field)){patch[field]=text;if(field==='description')d.description=text;}
  else {d[field]=text;if(field==='roomCategory')d.accommodationCategory=text;if(field==='hotel'&&Object.hasOwn(d,'hotelName'))d.hotelName=text;}
 }else throw fail('Неизвестное поле.',400);
 return patch;
}
async function mutateCorrection(pool,{providerId,serviceId,expectedToken,updateId,action,field,value,code,checked}){
 await ensureServiceModerationEvents(pool);const db=await pool.connect();let open=false;
 try{
  await db.query('BEGIN');open=true;const state=await getCorrection(db,providerId,serviceId,true);
  if(state.correction.pending)throw fail('Услуга уже на модерации. Дождитесь решения.');
  if(updateId!==undefined){const seen=await db.query(`SELECT id FROM service_moderation_events WHERE service_id=$1 AND actor_id=$2 AND meta->>'telegramUpdateId'=$3 LIMIT 1`,[serviceId,providerId,String(updateId)]);if(seen.rows.length){await db.query('COMMIT');open=false;return state;}}
  if(expectedToken!==state.token)throw fail('Данные изменились. Откройте замечания заново.');
  if(action==='check'){
   if(!state.correction.reasonCodes.includes(code))throw fail('Замечание больше не актуально.');
   const codes=checked?[...new Set([...state.checkedCodes,code])]:state.checkedCodes.filter(c=>c!==code);
   if(!isDeepStrictEqual(codes,state.checkedCodes))await db.query(`INSERT INTO service_moderation_events(service_id,actor_id,actor_role,action,meta) VALUES($1,$2,'provider','provider_correction_prepared',$3::jsonb)`,[serviceId,providerId,JSON.stringify({requestId:state.correction.requestId,fingerprint:state.correction.fingerprint,checkedCodes:codes,telegramUpdateId:updateId})]);
  }else{
   const service=state.service;let patch;
   if(action==='field'){const provider=await db.query('SELECT type FROM providers WHERE id=$1',[providerId]);patch=validateField(field,value,service,provider.rows[0]?.type);}
   else if(['add','remove'].includes(action)&&['proof','photos'].includes(field)){
    const d={...object(service.details)},current=files(field==='proof'?d.proofImages:service.images);let next=[...current];
    if(action==='add'){if(typeof value!=='string'||!/^data:image\/(jpeg|png|webp|gif);base64,/.test(value)||value.length>9*1024*1024)throw fail('Ожидается изображение до 6 МБ.',400);if(current.length>=20)throw fail('Можно добавить до 20 изображений.',400);next.push(value);}
    else {if(!Number.isInteger(value)||value<0||value>=current.length)throw fail('Изображение уже удалено. Обновите список.');next.splice(value,1);}
    patch=field==='proof'?{details:{...d,proofImages:next,proofReviewStatus:'pending',proofReviewedAt:null,proofReviewedBy:null}}:{details:d,images:next};
   }else throw fail('Неизвестное действие.',400);
   const after={...service,...patch};const changes=buildServiceEditChanges(service,after);
   if(changes.length){await db.query(`UPDATE services SET title=$3,description=$4,price=$5,category=$6,details=$7::jsonb,images=$8::jsonb,status='draft',moderation_status='draft',submitted_at=NULL,updated_at=NOW() WHERE id=$1 AND provider_id=$2`,[serviceId,providerId,after.title,after.description,after.price,after.category,JSON.stringify(after.details),JSON.stringify(after.images||[])]);
    await db.query(`INSERT INTO service_moderation_events(service_id,actor_id,actor_role,action,meta) VALUES($1,$2,'provider','provider_correction_edited',$3::jsonb)`,[serviceId,providerId,JSON.stringify({requestId:state.correction.requestId,changes,telegramUpdateId:updateId})]);}
  }
  await db.query('COMMIT');open=false;return await getCorrection(db,providerId,serviceId);
 }finally{if(open)await db.query('ROLLBACK');db.release();}
}
module.exports={getCorrection,listCorrections,mutateCorrection,validateField,token};
