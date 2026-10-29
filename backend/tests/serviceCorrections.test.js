const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {normalizeReasonCodes,correctionSnapshot,correctionNotificationParts,buildCorrectionReview,readCorrectionReview} = require('../utils/serviceCorrections');
const service = (extra={}) => ({id:42,status:'pending',moderation_status:'pending',title:'Tour',currency:'USD',edit_version:'v1',details:{netPrice:'100',grossPrice:'120',startDate:'2026-11-01',hotel:'Hotel A',proofImages:['https://proof/one']},...extra});
const request = (s=service(),codes=['BAD_PRICE','BAD_PROOF']) => ({id:7,created_at:'2026-10-29T00:00:00Z',reason:'Fix price and proof',meta:{correction:{reasonCodes:codes,snapshot:correctionSnapshot(s)}}});
test('multiple reasons validate, deduplicate and preserve legacy single reason',()=>{
  assert.deepEqual(normalizeReasonCodes(['BAD_PRICE','NO_DATES','BAD_PRICE']),['BAD_PRICE','NO_DATES']);
  assert.deepEqual(normalizeReasonCodes(undefined,'NO_PROOF'),['NO_PROOF']);
  for(const codes of [[],['invented'],['BAD_PRICE',null],Array(11).fill('BAD_PRICE')]) assert.throws(()=>normalizeReasonCodes(codes),{status:400});
});
test('changed fields have original and current values in the requested groups',()=>{
  const changed=service({details:{...service().details,grossPrice:'140',hotel:'Hotel B'}});
  const review=buildCorrectionReview(request(service(),['BAD_PRICE','HOTEL_DETAILS']),changed);
  assert.deepEqual(review.changes.map(c=>[c.group,c.label,c.before,c.after]),[['price','Gross','120','140'],['hotel','Отель / объект','Hotel A','Hotel B']]);
  assert.deepEqual(review.checkedCodes,[]);
});
test('proof replacement with same count is detected without retaining private URLs',()=>{
  const before=service(),after=service({details:{...service().details,proofImages:[{url:'https://proof/two'}]}});
  const req=request(before),review=buildCorrectionReview(req,after);
  assert.equal(review.changes[0].group,'proof');assert.equal(review.changes[0].before,'1 шт.');assert.equal(review.changes[0].after,'1 шт.');
  assert.ok(!JSON.stringify(req).includes('https://proof/one'));
});
test('proof ordering and image object representation do not imply replacements',()=>{
  const before=service({details:{proofImages:['a','b']}}),after=service({details:{proofImages:[{url:'b'},{src:'a'}]}});
  assert.equal(buildCorrectionReview(request(before),after).changes.length,0);
});
test('previous review is valid only for same request and saved data',()=>{
  const req=request(),current=service(),first=buildCorrectionReview(req,current);
  const review={meta:{requestId:7,checkedCodes:['BAD_PRICE','BAD_PROOF','OTHER'],fingerprint:first.fingerprint}};
  assert.deepEqual(buildCorrectionReview(req,current,review).checkedCodes,['BAD_PRICE','BAD_PROOF']);
  const changed=buildCorrectionReview(req,service({details:{...current.details,food:'AI'}}),review);
  assert.equal(changed.reviewStale,true);assert.deepEqual(changed.checkedCodes,[]);
  assert.equal(buildCorrectionReview({...req,id:8},current,review).checkedCodes.length,0);
});
test('old requests expose lack of baseline and allow a manual checklist',()=>{
  const review=buildCorrectionReview({id:3,reason_code:'NO_PROOF',meta:{}},service());
  assert.equal(review.hasBaseline,false);assert.deepEqual(review.changes,[]);assert.deepEqual(review.reasonCodes,['NO_PROOF']);
});
test('aliases hydrate into the same comparison fields and long text edits are detected',()=>{
  const before=service({description:'x'.repeat(2100),details:{departureDate:'2026-11-01',net_price:'100',hotelName:'A'}});
  const same=service({description:'x'.repeat(2100),details:{startDate:'2026-11-01',netPrice:'100',hotel:'A'}});
  assert.equal(buildCorrectionReview(request(before),same).changes.length,0);
  const changed=buildCorrectionReview(request(before),{...same,description:'x'.repeat(2100)+'z'});
  assert.ok(changed.changes.some(c=>c.field==='description'));
});
test('request lookup is independent of the last 30 audit events',async()=>{
  const queries=[];const db={query:async(sql,args)=>{queries.push([sql,args]);return {rows:queries.length===1?[request()]:[]};}};
  assert.equal((await readCorrectionReview(db,service())).requestId,7);
  assert.ok(queries[0][0].includes("action IN ('rejected','correction_requested')"));
  assert.equal(queries[1][1][1],'7');
});

function loadRoutes(pool,send=async()=>true) {
  const routes=[];const router={};for(const method of ['get','post','put','patch','delete']) router[method]=(url,...handlers)=>routes.push({method,url,handler:handlers.at(-1)});
  const upload=()=>({array:()=> (_req,_res,next)=>next()});upload.memoryStorage=()=>({});
  const localRequire=id=>id==='express'?{Router:()=>router}:id==='multer'?upload:id==='../db'?pool:id==='../utils/telegram'?{tgSend:send}:id==='../utils/serviceCorrections'?require('../utils/serviceCorrections'):id==='../utils/serviceModerationEvents'?{ensureServiceModerationEvents:async()=>{},listServiceModerationEvents:async()=>[],logServiceModerationEvent:async()=>{}}:{};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../routes/adminRoutes.js'),'utf8'),{require:localRequire,module:{exports:{}},console,process});
  return suffix=>routes.find(r=>r.method==='post'&&r.url.endsWith(suffix)).handler;
}
async function invoke(handler,body) { const res={statusCode:200,status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}};await handler({params:{id:'42'},user:{id:9},body},res);return res; }
function fakePool({version='v1',status='pending',failInsert=false,review=false,chat=false}={}) {
  const queries=[];const current=service({edit_version:version,status,moderation_status:status});
  const client={release(){queries.push(['release']);},async query(sql,args){queries.push([sql,args]);if(sql.startsWith('SELECT s.*')) return {rows:[current]};if(sql.startsWith('UPDATE services')) return {rows:[{...current,status:'rejected'}]};if(sql.startsWith('SELECT * FROM service_moderation_events')) return {rows:sql.includes("action IN")?[request(current)]:[]};if(sql.startsWith('INSERT')&&failInsert) throw new Error('audit unavailable');return {rows:[]};}};
  return {queries,async connect(){return client;},async query(sql,args){queries.push([sql,args]);return {rows:chat?[{title:'Tour',telegram_chat_id:'123'}]:[]};}};
}
test('correction request commits status and baseline together',async()=>{
  const db=fakePool(),route=loadRoutes(db)('/reject');const res=await invoke(route,{reason:'Fix both fields',reasonCodes:['BAD_PRICE','BAD_PROOF'],expected_edit_version:'v1'});
  assert.equal(res.statusCode,200);const insert=db.queries.find(([s])=>s.startsWith('INSERT'));const meta=JSON.parse(insert[1][6]);assert.deepEqual(meta.correction.reasonCodes,['BAD_PRICE','BAD_PROOF']);assert.ok(meta.correction.snapshot.gross);assert.ok(db.queries.some(([s])=>s==='COMMIT'));
});
test('correction audit failure rolls back instead of losing baseline',async()=>{
  const db=fakePool({failInsert:true});const res=await invoke(loadRoutes(db)('/reject'),{reason:'Fix price',reasonCodes:['BAD_PRICE']});
  assert.equal(res.statusCode,500);assert.ok(db.queries.some(([s])=>s==='ROLLBACK'));assert.ok(!db.queries.some(([s])=>s==='COMMIT'));
});
test('stale or non-pending correction requests cannot update or notify',async()=>{
  for(const config of [{version:'v2'},{status:'published'}]) { const db=fakePool(config);const res=await invoke(loadRoutes(db)('/reject'),{reason:'Fix price',reasonCodes:['BAD_PRICE'],expected_edit_version:'v1'});assert.equal(res.statusCode,409);assert.ok(!db.queries.some(([s])=>s.startsWith('UPDATE'))); }
});
test('review endpoint rejects stale versions, wrong requests and unrelated checked reasons',async()=>{
  for(const body of [{expected_edit_version:'old',requestId:7,checkedCodes:[]},{expected_edit_version:'v1',requestId:8,checkedCodes:[]},{expected_edit_version:'v1',requestId:7,checkedCodes:['NO_DATES']}]) {const db=fakePool();const res=await invoke(loadRoutes(db)('/correction-review'),body);assert.ok([400,409].includes(res.statusCode));assert.ok(!db.queries.some(([s])=>s.startsWith('INSERT')));}
});
test('review endpoint persists explicit checked reasons without publishing or notifying',async()=>{
  const db=fakePool();const res=await invoke(loadRoutes(db)('/correction-review'),{expected_edit_version:'v1',requestId:7,checkedCodes:['BAD_PRICE']});assert.equal(res.statusCode,200);
  const meta=JSON.parse(db.queries.find(([s])=>s.startsWith('INSERT'))[1][2]);assert.deepEqual(meta.checkedCodes,['BAD_PRICE']);assert.ok(meta.fingerprint);assert.ok(!db.queries.some(([s])=>s.startsWith('UPDATE')));
});

test('long correction notifications keep all text, Unicode and safe plain text chunks',()=>{
  const reason='Проверьте <цену> & даты 😀'.repeat(150);const parts=correctionNotificationParts('Title',reason);
  assert.ok(parts.length>1);assert.ok(parts.every(p=>p.length<=3900));assert.ok(parts.join('').includes(reason));assert.ok(parts.every(p=>!/[\uD800-\uDBFF]$/.test(p)));
});

test('notification uses plain text and reports delivery separately from saved correction',async()=>{
  for(const fail of [false,true]) {const db=fakePool({chat:true}),sent=[];const send=async(...args)=>{sent.push(args);if(fail)throw new Error('Telegram unavailable');return true;};const res=await invoke(loadRoutes(db,send)('/reject'),{reason:'Fix <price> & dates',reasonCodes:['BAD_PRICE']});assert.equal(res.statusCode,200);assert.equal(res.body.notification.sent,!fail);assert.equal(res.body.notification.available,true);assert.equal(sent[0][2].parse_mode,undefined);assert.ok(db.queries.some(([s])=>s==='COMMIT'));}
});

test('resubmitted multiple-reason requests remain in the correction queue',()=>{
 const {analyzeModerationService,matchesQueueFilter}=require('../utils/moderationQueueAnalysis');
 const current=service({last_moderation_action:'correction_requested'});assert.equal(analyzeModerationService(current).hasCorrectionHistory,true);
 const {queueCandidateQuery}=require('../utils/adminModerationQueue');assert.ok(queueCandidateQuery({status:'pending'}).sql.includes("action NOT IN ('service_edited','correction_reviewed')"));
});

test('legacy rejected services without an audit event retain a manual review',async()=>{
 const db={query:async()=>({rows:[]})};const old=service({rejected_reason:'Добавьте подтверждение',rejected_at:'2026-05-01T00:00:00Z'});const result=await readCorrectionReview(db,old);assert.equal(result.requestId,'legacy:42');assert.equal(result.hasBaseline,false);assert.equal(result.reason,old.rejected_reason);assert.equal(await readCorrectionReview(db,service()),null);
});
