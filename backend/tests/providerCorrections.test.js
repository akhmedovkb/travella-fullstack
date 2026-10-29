const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {readProviderCorrection,assertCorrectionAcknowledged,submitProviderService,moderationServiceUrl}=require('../utils/providerCorrections');
const {correctionSnapshot,normalizeReasonItems,readCorrectionReview}=require('../utils/serviceCorrections');
const valid=()=>({id:42,provider_id:5,status:'draft',moderation_status:'draft',edit_version:'v1',updated_at:'2026-10-29T08:00:00Z',category:'city_tour_guide',title:'City tour',description:'Guided city tour',price:100,images:['https://example.com/tour.jpg'],details:{location:'Tashkent',proofImages:['proof-new']}});
function database(options={}) {
 const state={service:valid(),events:[{id:7,service_id:42,action:'correction_requested',created_at:'2026-10-29T07:00:00Z',reason:'Уточните цену и proof',meta:{correction:{reasonCodes:['BAD_PRICE','BAD_PROOF'],reasonItems:[{code:'BAD_PRICE',text:'Укажите цену за весь пакет.'},{code:'BAD_PROOF',text:'Загрузите читаемое подтверждение.'}],snapshot:correctionSnapshot({...valid(),price:80,details:{...valid().details,proofImages:['proof-old']}})}}}],calls:[]};
 if(options.noRequest)state.events=[];
 if(options.status){state.service.status=options.status;state.service.moderation_status=options.status;}
 if(options.invalid)state.service.images=[];
 if(options.approved)state.events.push({id:8,action:'approved_clean',created_at:'2026-10-29T09:00:00Z'});
 let before;
 const db={release(){state.calls.push('RELEASE');},async query(sql,args=[]){state.calls.push(sql);
  if(sql==='BEGIN'){before=structuredClone({service:state.service,events:state.events});return {rows:[]};}
  if(sql==='ROLLBACK'){state.service=before.service;state.events=before.events;return {rows:[]};}
  if(sql.startsWith('SELECT')&&sql.includes('FROM services')){const owned=String(args[0])===String(state.service.id) && (args.length<2 || String(args[1])===String(state.service.provider_id));return {rows:owned?[structuredClone(state.service)]:[],rowCount:owned?1:0};}
  if(sql.startsWith('SELECT')&&sql.includes('service_moderation_events')){
   let rows=sql.includes("action IN ('rejected'")?state.events.filter(e=>['rejected','correction_requested'].includes(e.action)):sql.includes("action IN ('approved'")?state.events.filter(e=>e.action.startsWith('approved')):sql.includes("action='correction_resubmitted'")?state.events.filter(e=>e.action==='correction_resubmitted'&&String(e.meta.requestId)===args[1]):[];
   return {rows:rows.slice(-1)};
  }
  if(sql.startsWith('UPDATE services')){state.service={...state.service,status:'pending',moderation_status:'pending'};return {rows:[structuredClone(state.service)],rowCount:1};}
  if(sql.startsWith('INSERT INTO service_moderation_events')){if(options.failAudit)throw new Error('audit unavailable');state.events.push({id:9,actor_id:args[1],action:'correction_resubmitted',created_at:'2026-10-29T10:00:00Z',meta:JSON.parse(args[3])});}
  return {rows:[],rowCount:0};
 }};
 return {state,pool:{connect:async()=>db,query:db.query},db};
}
const acknowledgement=c=>({requestId:c.requestId,expected_edit_version:c.editVersion,fingerprint:c.fingerprint,checkedCodes:c.reasonCodes});
test('provider sees only actionable notes and no admin snapshot or actor identity',async()=>{
 const fixture=database(),result=await readProviderCorrection(fixture.db,fixture.state.service);
 assert.deepEqual(result.reasonCodes,['BAD_PRICE','BAD_PROOF']);assert.equal(result.reasonItems[0].text,'Укажите цену за весь пакет.');
 for(const key of ['changes','checkedCodes','snapshot','actor_id'])assert.ok(!Object.hasOwn(result,key));
 assert.equal(await readProviderCorrection(database({approved:true}).db,valid()),null);
 assert.equal(await readProviderCorrection(fixture.db,{...valid(),status:'published'}),null);
});
test('every selected note must be acknowledged against the current version and request',()=>{
 const c={requestId:7,editVersion:'v1',fingerprint:'fresh',reasonCodes:['BAD_PRICE','BAD_PROOF']};
 for(const input of [null,{...acknowledgement(c),requestId:8},{...acknowledgement(c),fingerprint:'old'},{...acknowledgement(c),expected_edit_version:'v0'}])assert.throws(()=>assertCorrectionAcknowledged(c,input),{code:'CORRECTION_STALE'});
 for(const checkedCodes of [[],['BAD_PRICE'],['BAD_PRICE','BAD_PROOF','OTHER']])assert.throws(()=>assertCorrectionAcknowledged(c,{...acknowledgement(c),checkedCodes}),{code:'CORRECTION_CHECKLIST_REQUIRED'});
 assert.doesNotThrow(()=>assertCorrectionAcknowledged(c,acknowledgement(c)));
});
test('provider resubmission commits pending status and acknowledgements together',async()=>{
 const f=database(),notes=await readProviderCorrection(f.db,f.state.service);
 const result=await submitProviderService(f.pool,{providerId:5,serviceId:42,correction:acknowledgement(notes)});
 assert.equal(result.resubmitted,true);assert.equal(f.state.service.status,'pending');assert.equal(f.state.events.at(-1).actor_id,5);assert.deepEqual(f.state.events.at(-1).meta.checkedCodes,['BAD_PRICE','BAD_PROOF']);assert.ok(f.state.calls.some(s=>s.includes('FOR UPDATE')));assert.ok(f.state.calls.includes('COMMIT'));assert.equal(f.state.calls.at(-1),'RELEASE');
 const admin=await readCorrectionReview(f.db,f.state.service);assert.equal(admin.providerSubmission.checkedCodes.length,2);assert.ok(admin.changes.some(c=>c.group==='proof'));
 await assert.rejects(()=>submitProviderService(f.pool,{providerId:5,serviceId:42,correction:acknowledgement(notes)}),{code:'SERVICE_ALREADY_PENDING'});
});
test('missing checklist, stale saves, missing ownership, validation and audit errors leave a draft',async()=>{
 for(const mode of ['missing','stale','owner','invalid','audit']){
  const f=database({invalid:mode==='invalid',failAudit:mode==='audit'}),notes=await readProviderCorrection(f.db,f.state.service);
  const input=acknowledgement(notes);if(mode==='stale')f.state.service.edit_version='v2';
  await assert.rejects(()=>submitProviderService(f.pool,{providerId:mode==='owner'?99:5,serviceId:42,correction:mode==='missing'?null:input}));
  assert.equal(f.state.service.status,'draft');assert.equal(f.state.events.length,1);assert.ok(f.state.calls.includes('ROLLBACK'));
 }
});
test('first submissions work without correction metadata and cannot bypass normal validation',async()=>{
 const f=database({noRequest:true});assert.equal((await submitProviderService(f.pool,{providerId:5,serviceId:42})).resubmitted,false);
 const bad=database({noRequest:true,invalid:true});await assert.rejects(()=>submitProviderService(bad.pool,{providerId:5,serviceId:42}),{code:'SERVICE_SUBMIT_BLOCKED'});assert.equal(bad.state.service.status,'draft');
});
test('structured per-field notes are bounded and cannot add an unselected reason',()=>{
 assert.deepEqual(normalizeReasonItems(undefined,['BAD_PRICE']),[]);
 assert.deepEqual(normalizeReasonItems([{code:'BAD_PRICE',text:'  Уточните цену.  '}],['BAD_PRICE']),[{code:'BAD_PRICE',text:'Уточните цену.'}]);
 for(const notes of [[],[{code:'NO_DATES',text:'Уточните даты.'}],[{code:'BAD_PRICE',text:'x'}],[{code:'BAD_PRICE',text:'x'.repeat(3001)}]])assert.throws(()=>normalizeReasonItems(notes,['BAD_PRICE']),{status:400});
});
test('moderation links select exactly the submitted service, open its editor and keep auth routing',()=>{
 const link=new URL(moderationServiceUrl('https://travella.uz/',42,true));assert.equal(link.pathname,'/admin/operations');assert.equal(link.searchParams.get('m_q'),'#42');assert.equal(link.searchParams.get('m_focus'),'42');assert.equal(link.searchParams.get('m_open'),'1');assert.equal(link.searchParams.get('m_section'),'correction');assert.equal(moderationServiceUrl('',42),'');
});

function providerRoutes(pool){const handlers=[],router={};for(const method of ['get','post','put','patch','delete','use'])router[method]=(url,...fn)=>handlers.push({method,url,fn});const req=id=>id==='express'?{Router:()=>router}:id==='../db'?pool:id==='../utils/providerCorrections'?{readProviderCorrection,submitProviderService}:id==='../utils/serviceModerationEvents'?{ensureServiceModerationEvents:async()=>{}}:{};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../routes/providerRoutes.js'),'utf8'),{require:req,module:{exports:{}},console,process});return handlers.find(h=>h.method==='get'&&h.url==='/services/:id/corrections');}
test('correction read route hides other suppliers services and requires provider role',async()=>{
 const f=database(),route=providerRoutes(f.pool);const res={statusCode:200,status(c){this.statusCode=c;return this;},json(v){this.body=v;return this;},set(){return this;}};
 await route.fn.at(-1)({params:{id:42},user:{id:99}},res);assert.equal(res.statusCode,404);assert.equal(res.body.correction,undefined);
 let next=false;route.fn[1]({user:{id:5,role:'client'}},res,()=>{next=true;});assert.equal(res.statusCode,403);assert.equal(next,false);
});

function loadUpdate(pool,action="updateService",onBroadcast=()=>{}){const localRequire=id=>id==='../db'?pool:id==='../utils/refusedPriceDropBroadcast'?{extractPrices:()=>({}),isPriceDrop:()=>({any:true}),broadcastPriceDropCard:onBroadcast}:id==='../utils/serviceAuditLog'?{logProviderServiceAction:async()=>{}}:id==='../utils/providerFunnel'?{logProviderFunnelEvent:async()=>{}}:id==='../utils/providerServiceCatalog'?require('../utils/providerServiceCatalog'):id==='../utils/flightDetailsNormalizer'?require('../utils/flightDetailsNormalizer'):{};const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controllers/providerController.js'),'utf8'),{require:localRequire,module,console,process:{env:{JWT_SECRET:'test-only'}}});return module.exports[action];}
test('invalid provider edits roll back a rejected status reset and release the lock',async()=>{
 const calls=[];const current={...valid(),status:'rejected',moderation_status:'rejected',rejected_reason:'Уточните данные'};const db={release(){calls.push('RELEASE');},async query(sql){calls.push(sql);return {rowCount:1,rows:[current]};}};
 const handler=loadUpdate({connect:async()=>db});const res={statusCode:200,status(c){this.statusCode=c;return this;},json(v){this.body=v;return this;}};
 await handler({user:{id:5},params:{id:42},body:{title:'Tour',category:'city_tour_guide',description:'Tour',price:100,details:{startDate:'2026-12-01',expiration:'2026-11-01'},images:['photo']}},res);
 assert.equal(res.statusCode,400);assert.ok(calls.some(s=>s.includes('FOR UPDATE')));assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.includes('COMMIT'));assert.equal(calls.at(-1),'RELEASE');
});

test('image-only save cannot modify a service that became pending after it was opened',async()=>{
 const calls=[];const pool={async query(sql){calls.push(sql);return sql.startsWith('SELECT')?{rowCount:1,rows:[{id:42,status:'draft',moderation_status:'draft'}]}:{rowCount:0,rows:[]};}};
 const handler=loadUpdate(pool,'updateServiceImagesOnly');const res={statusCode:200,status(c){this.statusCode=c;return this;},json(v){this.body=v;return this;}};
 await handler({user:{id:5},params:{id:42},body:{images:['photo']}},res);assert.equal(res.statusCode,409);assert.equal(res.body.code,'SERVICE_EDIT_CONFLICT');assert.ok(calls.at(-1).includes("status IS DISTINCT FROM 'pending'"));
});

test('saving a cheaper rejected offer keeps a draft and never broadcasts it to customers',async()=>{
 let broadcasts=0;const before={...valid(),status:'rejected',moderation_status:'rejected',rejected_reason:'Проверьте цену'};const draft={...before,status:'draft',moderation_status:'draft',price:90};const calls=[];
 const db={release(){},async query(sql){calls.push(sql);return {rowCount:1,rows:[sql.startsWith('SELECT')?before:draft]};}};
 const handler=loadUpdate({connect:async()=>db},'updateService',async()=>{broadcasts++;});const res={statusCode:200,status(c){this.statusCode=c;return this;},json(v){this.body=v;return this;}};
 await handler({user:{id:5},params:{id:42},body:{title:'Tour',category:'city_tour_guide',description:'Guided tour',price:90,images:['photo'],details:{location:'Tashkent'}}},res);
 assert.equal(res.statusCode,200);assert.equal(res.body.status,'draft');assert.equal(broadcasts,0);assert.ok(calls.includes('COMMIT'));
});
