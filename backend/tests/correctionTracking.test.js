const test=require('node:test'),assert=require('node:assert/strict');
const {waitingInfo,correctionHistory,remindCorrection,readTracking,WAITING_SQL,RETURNED_SQL}=require('../utils/correctionTracking');
const {correctionSnapshot}=require('../utils/serviceCorrections');
function fixture({status='draft',chat=true}={}){
 const now=new Date(),service={id:42,provider_id:5,status,moderation_status:status,title:'TEST',price:100,details:{},rejected_at:'2026-10-01T00:00:00Z',updated_at:now.toISOString(),telegram_refused_chat_id:chat?'55':null};
 const request={id:7,created_at:'2026-10-01T00:00:00Z',reason:'Исправьте цену',meta:{correction:{reasonCodes:['BAD_PRICE'],snapshot:correctionSnapshot(service)}}};
 const attempts=[],events=[];let tail=Promise.resolve();
 function client(){let unlock,pending=[];return {release(){},async query(sql,args=[]){
  if(sql.includes('FOR UPDATE')){const previous=tail;tail=new Promise(resolve=>{unlock=resolve;});await previous;return {rows:[service]};}
  if(sql==='COMMIT'){for(const [kind,value]of pending)(kind==='attempt'?attempts:events).push(value);pending=[];unlock?.();unlock=null;return {rows:[]};}
  if(sql==='ROLLBACK'){pending=[];unlock?.();unlock=null;return {rows:[]};}
  if(sql.startsWith('INSERT INTO service_correction_reminders')){const row={id:attempts.length+1,created_at:new Date(),state:'reserved'};pending.push(['attempt',row]);return {rows:[row]};}
  if(sql.startsWith('INSERT INTO service_moderation_events')){pending.push(['event',{action:'requested'}]);return {rows:[]};}
  return query(sql,args);
 }};}
 async function query(sql,args=[]){
  if(sql.startsWith('SELECT')&&sql.includes('service_correction_reminders'))return {rows:attempts.filter(a=>!sql.includes("INTERVAL '24 hours'")||new Date(a.created_at)>new Date(Date.now()-86400000)).slice(-1)};
  if(sql.startsWith('UPDATE service_correction_reminders')){const row=attempts.find(a=>a.id===args[0]);row.state=sql.includes("state='sent'")?'sent':args[1];return {rows:[]};}
  if(sql.startsWith('SELECT')&&sql.includes("action IN ('rejected'"))return {rows:[request]};
  if(sql.startsWith('SELECT')&&sql.includes('service_moderation_events'))return {rows:[]};
  if(sql.startsWith('INSERT INTO service_moderation_events')){events.push({action:sql.includes("'correction_reminded'")?'sent':'failed'});return {rows:[]};}
  return {rows:[]};
 }
 return {pool:{query,connect:async()=>client()},service,attempts,events,request};
}
test('waiting clock uses the rejection request, never the latest draft save; returned clock uses submission',()=>{
 const base={status:'draft',correction_requested_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-10T00:00:00Z'};const now=Date.parse('2026-10-11T12:00:00Z');assert.equal(waitingInfo(base,now).days,10);
 assert.equal(waitingInfo({...base,status:'pending',submitted_at:'2026-10-10T12:00:00Z'},now).days,1);assert.equal(waitingInfo({status:'rejected'},now).days,null);assert.equal(waitingInfo({...base,correction_requested_at:'2026-12-01'},now).days,0);
});
test('parallel reminder clicks reserve one attempt before network delivery',async()=>{
 const f=fixture();let sends=0;const send=async()=>{sends++;await new Promise(r=>setTimeout(r,10));return true;};
 const results=await Promise.allSettled([remindCorrection(f.pool,{serviceId:42,adminId:1},send),remindCorrection(f.pool,{serviceId:42,adminId:2},send)]);
 assert.equal(sends,1);assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].state,'sent');assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===429).length,1);
});
test('failed delivery and process-left reservations block duplicate reminders for 24 hours',async()=>{
 const f=fixture();const result=await remindCorrection(f.pool,{serviceId:42,adminId:1},async()=>{throw new Error('network');});assert.equal(result.sent,false);assert.equal(f.attempts.length,1);
 await assert.rejects(()=>remindCorrection(f.pool,{serviceId:42,adminId:1},async()=>assert.fail('duplicate send')),{status:429});
 f.attempts[0].state='reserved';await assert.rejects(()=>remindCorrection(f.pool,{serviceId:42,adminId:1},async()=>assert.fail('duplicate send')),{status:429});
 f.attempts[0].created_at=new Date(Date.now()-86400001);assert.equal((await remindCorrection(f.pool,{serviceId:42,adminId:1},async()=>true)).sent,true);
});
test('returned services and unlinked suppliers cannot reserve or send reminders',async()=>{
 for(const config of [{status:'pending'},{chat:false}]){const f=fixture(config);await assert.rejects(()=>remindCorrection(f.pool,{serviceId:42,adminId:1},async()=>assert.fail('unexpected send')),{status:409});assert.equal(f.attempts.length,0);}
});
test('loading tracking is read-only for reminder delivery and exposes the original request time',async()=>{
 const f=fixture();const result=await readTracking(f.pool,f.service);assert.equal(result.requestedAt,f.request.created_at);assert.equal(result.phase,'waiting');assert.equal(f.attempts.length,0);
});
test('history pages retain every return even after many edits and do not attach approvals to the wrong cycle',async()=>{
 const requests=Array.from({length:45},(_,i)=>({id:String(i*10+10),created_at:'2026-10-01',reason:`Reason ${i}`,reason_codes:['BAD_PRICE'],next_request_id:i===44?null:String((i+1)*10+10)})).reverse();const queried=[];
 const db={async query(sql,args){queried.push(sql);if(sql.includes('AS next_request_id'))return {rows:requests.filter(r=>!args[1]||BigInt(r.id)<BigInt(args[1])).slice(0,args[2])};if(sql.includes("action IN ('approved'"))return {rows:[{id:'305',created_at:'2026-10-02'}]};if(sql.includes("meta->>'requestId'"))return {rows:[{id:301,action:'correction_resubmitted',created_at:'2026-10-02',meta:{requestId:'300'}}]};return {rows:[]};}};
 const ids=[];let cursor;do{const page=await correctionHistory(db,{id:42},cursor);ids.push(...page.items.map(i=>i.id));if(page.items.some(i=>i.id==='300'))assert.ok(page.items.find(i=>i.id==='300').approvedAt);cursor=page.nextCursor;}while(cursor);
 assert.equal(ids.length,45);assert.equal(new Set(ids).size,45);assert.ok(queried.some(q=>q.includes('AS next_request_id')));
});
test('virtual queue locations round-trip and queue SQL includes draft waiting services',async()=>{
 const {readQueueLocation,writeQueueLocation,correctionWaitLabel}=await import('../../frontend/src/utils/moderationQueue.js');const {normalizeQueueRequest,queueCandidateQuery}=require('../utils/adminModerationQueue');
 for(const status of ['waiting','returned']){const params=writeQueueLocation(new URLSearchParams('tab=moderation'),{status,page:2});assert.equal(readQueueLocation(params).status,status);assert.equal(params.get('tab'),'moderation');assert.equal(normalizeQueueRequest({status}).status,status);assert.ok(queueCandidateQuery({status}).sql.includes(status==='waiting'?WAITING_SQL:RETURNED_SQL));}
 assert.equal(correctionWaitLabel({status:'draft',updated_at:'2026-10-10'}),'Срок ожидания неизвестен');
});

test('uncertain timeout keeps the durable cooldown even if transport finishes later',async()=>{
 const f=fixture();const result=await remindCorrection(f.pool,{serviceId:42,adminId:1},()=>new Promise(resolve=>setTimeout(()=>resolve(true),20)),{timeoutMs:1});assert.equal(result.sent,false);assert.equal(f.attempts[0].state,'uncertain');await assert.rejects(()=>remindCorrection(f.pool,{serviceId:42,adminId:2},async()=>assert.fail('duplicate')),{status:429});
});
test('pending wins over inconsistent legacy moderation status for the waiting clock',()=>{
 assert.equal(waitingInfo({status:'pending',moderation_status:'rejected',submitted_at:'2026-10-01',rejected_at:'2026-09-01'},Date.parse('2026-10-02')).phase,'returned');
});

test('oldest waiting sort uses request time, not a recent save, and puts unknown ages last',()=>{
 const {selectQueuePage}=require('../utils/adminModerationQueue');const rows=[{id:1,status:'draft',correction_requested_at:'2026-10-01',updated_at:'2026-10-29'},{id:2,status:'draft',correction_requested_at:'2026-10-10',updated_at:'2026-10-11'},{id:3,status:'draft'}];assert.deepEqual(selectQueuePage(rows,{status:'waiting'}).ids,[1,2,3]);
});

test('a draft with correction history is still waiting and is not counted as returned',()=>{
 const {analyzeModerationService}=require('../utils/moderationQueueAnalysis');assert.equal(analyzeModerationService({status:'draft',last_moderation_action:'correction_requested'}).hasCorrectionHistory,false);assert.equal(analyzeModerationService({status:'pending',last_moderation_action:'correction_requested'}).hasCorrectionHistory,true);
});
test('supplier history endpoint checks ownership before reading correction events',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const routes=[],router={};for(const method of ['get','post','put','patch','delete','use'])router[method]=(url,...handlers)=>routes.push({method,url,handlers});let queries=0;
 const req=id=>id==='express'?{Router:()=>router}:id==='../db'?{query:async()=>{queries++;return {rows:[]};}}:{};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../routes/providerRoutes.js'),'utf8'),{require:req,module:{exports:{}},console,process});const route=routes.find(r=>r.method==='get'&&r.url==='/services/:id/correction-history');const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
 await route.handlers.at(-1)({user:{id:99},params:{id:42},query:{}},res);assert.equal(res.statusCode,404);assert.equal(queries,1);assert.equal(res.body.items,undefined);
});
