const {ensureServiceModerationEvents}=require('./serviceModerationEvents');
const {readProviderCorrection}=require('./providerCorrections');
const {readCorrectionReview}=require('./serviceCorrections');
const ACTIVE_REQUEST=`EXISTS(SELECT 1 FROM service_moderation_events cr WHERE cr.service_id=s.id AND cr.action IN ('rejected','correction_requested') AND NOT EXISTS(SELECT 1 FROM service_moderation_events ca WHERE ca.service_id=s.id AND ca.action IN ('approved','approved_clean','approved_with_warnings') AND (ca.created_at,ca.id)>(cr.created_at,cr.id)))`;
const LEGACY_REQUEST=`s.rejected_reason IS NOT NULL AND NOT EXISTS(SELECT 1 FROM service_moderation_events lr WHERE lr.service_id=s.id AND lr.action IN ('rejected','correction_requested')) AND NOT EXISTS(SELECT 1 FROM service_moderation_events la WHERE la.service_id=s.id AND la.action IN ('approved','approved_clean','approved_with_warnings') AND la.created_at>COALESCE(s.rejected_at,'-infinity'::timestamptz))`;
const WAITING_SQL=`COALESCE(s.moderation_status,s.status,'draft') IN ('draft','rejected') AND COALESCE(s.status,'draft') NOT IN ('pending','published','approved','active','archived','deleted') AND (${ACTIVE_REQUEST} OR (${LEGACY_REQUEST}))`;
const RETURNED_SQL=`(s.status='pending' OR s.moderation_status='pending') AND COALESCE(s.status,'draft') NOT IN ('published','approved','active','archived','deleted') AND (${ACTIVE_REQUEST} OR (${LEGACY_REQUEST}))`;
const TRACKING_FIELDS=`(SELECT MAX(e.created_at) FROM service_moderation_events e WHERE e.service_id=s.id AND e.action IN ('rejected','correction_requested')) AS correction_requested_at, s.rejected_at AS legacy_correction_requested_at, s.submitted_at AS correction_returned_at`;
let ready=false,preparing;
async function prepareTracking(pool){await ensureServiceModerationEvents(pool);if(ready)return;await pool.query(`CREATE TABLE IF NOT EXISTS service_correction_reminders(id BIGSERIAL PRIMARY KEY,service_id BIGINT NOT NULL,request_id TEXT NOT NULL,requested_by BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),state TEXT NOT NULL DEFAULT 'reserved',sent_at TIMESTAMPTZ,error_code TEXT)`);await pool.query(`CREATE INDEX IF NOT EXISTS idx_service_correction_reminders_request ON service_correction_reminders(service_id,request_id,created_at DESC)`);ready=true;}
async function ensureTracking(pool){if(ready)return;if(!preparing)preparing=prepareTracking(pool).catch(error=>{preparing=null;throw error;});return preparing;}
function waitingInfo(service,now=Date.now()){
 const status=String(service.moderation_status||service.status||'draft');const requested=service.correction_requested_at||service.legacy_correction_requested_at||service.rejected_at;const returned=service.correction_returned_at||service.submitted_at;
 const phase=service.status==='pending'||service.moderation_status==='pending'?'returned':['draft','rejected'].includes(status)?'waiting':'closed';const since=phase==='returned'?returned:requested;const time=Date.parse(since);
 return {phase,requestedAt:requested||null,since:since||null,days:Number.isFinite(time)?Math.max(0,Math.floor((now-time)/86400000)):null};
}
async function readTracking(pool,service){
 await ensureTracking(pool);const correction=await readProviderCorrection(pool,{...service,edit_version:service.edit_version});
 if(!correction)return null;
 const reminders=await pool.query(`SELECT id,state,created_at,sent_at FROM service_correction_reminders WHERE service_id=$1 AND request_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,[service.id,String(correction.requestId)]);
 const last=reminders.rows[0];return {...waitingInfo({...service,correction_requested_at:correction.requestedAt}),requestId:correction.requestId,lastReminder:last||null,nextReminderAt:last?new Date(new Date(last.created_at).getTime()+86400000).toISOString():null};
}
async function correctionHistory(db,service,before,limit=20){
 limit=Math.max(1,Math.min(20,Number(limit)||20));
 await ensureServiceModerationEvents(db);const cursor=/^\d+$/.test(String(before))?String(before):null;
 const requests=await db.query(`SELECT e.id,e.created_at,e.reason,e.reason_code,e.meta#>'{correction,reasonCodes}' AS reason_codes,(SELECT MIN(n.id) FROM service_moderation_events n WHERE n.service_id=e.service_id AND n.action IN ('rejected','correction_requested') AND n.id>e.id) AS next_request_id FROM service_moderation_events e WHERE e.service_id=$1 AND e.action IN ('rejected','correction_requested') AND ($2::bigint IS NULL OR e.id<$2) ORDER BY e.id DESC LIMIT $3`,[service.id,cursor,limit+1]);
 const selected=requests.rows.slice(0,limit);const ids=selected.map(r=>String(r.id));const actions=ids.length?(await db.query(`SELECT id,action,created_at,meta FROM service_moderation_events WHERE service_id=$1 AND meta->>'requestId'=ANY($2::text[]) AND action IN ('correction_resubmitted','correction_reviewed','correction_reminded','correction_reminder_failed','correction_reminder_requested') ORDER BY id`,[service.id,ids])).rows:[];
 const approvals=selected.length?(await db.query(`SELECT id,action,created_at FROM service_moderation_events WHERE service_id=$1 AND action IN ('approved','approved_clean','approved_with_warnings') ORDER BY id`,[service.id])).rows:[];
 const items=selected.map((r,index)=>{const nextRequestId=r.next_request_id;return {id:String(r.id),requestedAt:r.created_at,reason:r.reason,reasonCodes:r.reason_codes||r.meta?.correction?.reasonCodes||[r.reason_code||'OTHER'],events:actions.filter(a=>String(a.meta?.requestId)===String(r.id)).map(a=>({id:a.id,action:a.action,at:a.created_at})),approvedAt:approvals.find(a=>BigInt(a.id)>BigInt(r.id)&&(!nextRequestId||BigInt(a.id)<BigInt(nextRequestId)))?.created_at||null};});
 if(!items.length&&!cursor&&service.rejected_reason)items.push({id:`legacy:${service.id}`,requestedAt:service.rejected_at,reason:service.rejected_reason,reasonCodes:['OTHER'],events:[],approvedAt:null,legacy:true});
 return {items,nextCursor:requests.rows.length>limit?String(selected.at(-1).id):null};
}
async function reserveReminder(pool,{serviceId,adminId}){
 await ensureTracking(pool);const db=await pool.connect();let open=false;
 try{await db.query('BEGIN');open=true;const found=await db.query(`SELECT s.*,p.telegram_refused_chat_id,p.telegram_web_chat_id,p.telegram_chat_id FROM services s JOIN providers p ON p.id=s.provider_id WHERE s.id=$1 AND s.deleted_at IS NULL FOR UPDATE OF s`,[serviceId]);const service=found.rows[0];
  if(!service)throw Object.assign(new Error('Услуга не найдена'),{status:404});const correction=await readProviderCorrection(db,service);
  if(!correction||correction.pending)throw Object.assign(new Error('Сейчас не ждём исправлений от поставщика.'),{status:409});
  const chatId=service.telegram_refused_chat_id||service.telegram_web_chat_id||service.telegram_chat_id;
  if(!chatId)throw Object.assign(new Error('Telegram поставщика не подключён.'),{status:409});
  const previous=await db.query(`SELECT created_at FROM service_correction_reminders WHERE service_id=$1 AND request_id=$2 AND created_at>NOW()-INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 1`,[serviceId,String(correction.requestId)]);
  if(previous.rows[0])throw Object.assign(new Error('Напоминание уже запрашивали. Повторная отправка доступна через 24 часа.'),{status:429,nextReminderAt:new Date(new Date(previous.rows[0].created_at).getTime()+86400000).toISOString()});
  const inserted=await db.query(`INSERT INTO service_correction_reminders(service_id,request_id,requested_by) VALUES($1,$2,$3) RETURNING id,created_at`,[serviceId,String(correction.requestId),adminId]);const attempt=inserted.rows[0];
  await db.query(`INSERT INTO service_moderation_events(service_id,actor_id,actor_role,action,meta) VALUES($1,$2,'admin','correction_reminder_requested',$3::jsonb)`,[serviceId,adminId,JSON.stringify({requestId:correction.requestId,attemptId:attempt.id})]);await db.query('COMMIT');open=false;
  return {service,correction,chatId,attempt,nextReminderAt:new Date(new Date(attempt.created_at).getTime()+86400000).toISOString()};
 }finally{if(open)await db.query('ROLLBACK');db.release();}
}
async function remindCorrection(pool,input,send,{timeoutMs=15000}={}){
 const reserved=await reserveReminder(pool,input);let sent=false;let timer;
 try{
  // The durable reservation is made before network I/O. An uncertain timeout never permits an immediate duplicate.
  sent=await Promise.race([send(reserved),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('delivery_timeout')),timeoutMs);})]);
  if(sent!==true)throw new Error('delivery_failed');
  await pool.query(`UPDATE service_correction_reminders SET state='sent',sent_at=NOW() WHERE id=$1`,[reserved.attempt.id]);
  await pool.query(`INSERT INTO service_moderation_events(service_id,actor_id,actor_role,action,meta) VALUES($1,$2,'admin','correction_reminded',$3::jsonb)`,[input.serviceId,input.adminId,JSON.stringify({requestId:reserved.correction.requestId,attemptId:reserved.attempt.id})]);
  return {sent:true,nextReminderAt:reserved.nextReminderAt};
 }catch(error){await pool.query(`UPDATE service_correction_reminders SET state=$2,error_code=$3 WHERE id=$1`,[reserved.attempt.id,sent||error.message==='delivery_timeout'?'uncertain':'failed',String(error.message).slice(0,100)]);await pool.query(`INSERT INTO service_moderation_events(service_id,actor_id,actor_role,action,meta) VALUES($1,$2,'admin','correction_reminder_failed',$3::jsonb)`,[input.serviceId,input.adminId,JSON.stringify({requestId:reserved.correction.requestId,attemptId:reserved.attempt.id})]);return {sent:false,nextReminderAt:reserved.nextReminderAt,message:'Доставка не подтверждена. Замечания остаются в кабинете. Повтор — через 24 часа.'};}
 finally{clearTimeout(timer);}
}
module.exports={WAITING_SQL,RETURNED_SQL,TRACKING_FIELDS,waitingInfo,readTracking,correctionHistory,reserveReminder,remindCorrection};
