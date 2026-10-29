const test=require('node:test'),assert=require('node:assert/strict');
const {validateField,getCorrection,mutateCorrection}=require('../utils/telegramCorrectionService');
const {createCorrectionFlow,keyboard,chunks}=require('../telegram/handlers/correctionFlow');
const {correctionSnapshot}=require('../utils/serviceCorrections');
function fixture({failAudit=false}={}){
 const state={service:{id:42,provider_id:5,status:'draft',moderation_status:'draft',edit_version:'v1',category:'city_tour_guide',title:'TEST TOUR',description:'Guided tour',price:120,currency:'USD',images:['photo'],details:{netPrice:'100',grossPrice:'120',startDate:'2026-11-01',endDate:'2026-11-08',hotel:'A',location:'Tashkent',proofImages:['proof']}},events:[],calls:[]};
 state.events.push({id:7,created_at:'2026-10-29T00:00:00Z',action:'correction_requested',reason:'Уточните цену и proof',meta:{correction:{reasonCodes:['BAD_PRICE','BAD_PROOF'],snapshot:correctionSnapshot(state.service)}}});let snapshot;
 const db={release(){state.calls.push('release');},async query(sql,args=[]){state.calls.push(sql);
  if(sql==='BEGIN')snapshot=structuredClone({service:state.service,events:state.events});
  if(sql==='ROLLBACK'){state.service=snapshot.service;state.events=snapshot.events;}
  if(sql.startsWith('SELECT')&&sql.includes('FROM services')&&sql.includes('s.provider_id=$1')){const returned=sql.includes("(s.status='pending' OR s.moderation_status='pending')");return {rows:args[0]===5&&((state.service.status==='pending')===returned)?[structuredClone(state.service)]:[]};}
  if(sql.startsWith('SELECT')&&sql.includes('FROM services')){const owned=String(args[0])===String(state.service.id)&&(args.length<2||String(args[1])===String(state.service.provider_id));return {rows:owned?[structuredClone(state.service)]:[],rowCount:owned?1:0};}
  if(sql.startsWith('SELECT type'))return {rows:[{type:'agent'}]};
  if(sql.startsWith('SELECT')&&sql.includes('service_moderation_events')){
   let rows=sql.includes("action IN ('rejected'")?state.events.filter(e=>['rejected','correction_requested'].includes(e.action)):sql.includes("action IN ('approved'")?[]:sql.includes("action='provider_correction_prepared'")?state.events.filter(e=>e.action==='provider_correction_prepared'&&String(e.meta.requestId)===args[2]):sql.includes("action='correction_resubmitted'")?state.events.filter(e=>e.action==='correction_resubmitted'):sql.includes("meta->>'telegramUpdateId'")?state.events.filter(e=>String(e.meta?.telegramUpdateId)===args[2]):[];
   return {rows:structuredClone(rows.slice(-1)),rowCount:rows.length};
  }
  if(sql.startsWith('UPDATE services')){if(sql.includes('SET title=$3'))Object.assign(state.service,{title:args[2],description:args[3],price:args[4],category:args[5],details:JSON.parse(args[6]),images:JSON.parse(args[7]),edit_version:'v'+(Number(state.service.edit_version.slice(1))+1)});else{state.service.status='pending';state.service.moderation_status='pending';}return {rows:[structuredClone(state.service)],rowCount:1};}
  if(sql.startsWith('INSERT INTO service_moderation_events')){if(failAudit)throw new Error('Audit failed');const action=sql.includes("'provider_correction_prepared'")?'provider_correction_prepared':sql.includes("'provider_correction_edited'")?'provider_correction_edited':'correction_resubmitted';state.events.push({id:state.events.length+8,created_at:new Date().toISOString(),action,actor_id:args[1],meta:JSON.parse(args[action==='correction_resubmitted'?3:2])});}
  return {rows:[],rowCount:0};
 }};return {state,pool:{connect:async()=>db,query:db.query}};
}
const image='data:image/png;base64,aGVsbG8=';
test('price, dates, fields and category validation preserve unrelated details',()=>{
 const service=fixture().state.service;
 assert.equal(validateField('gross','140,50',service,'agent').details.grossPrice,'140.50');assert.equal(service.details.grossPrice,'120');
 assert.equal(validateField('dates','2026-11-04 2026-11-11',service,'agent').details.endDate,'2026-11-11');
 for(const [field,value] of [['gross','-1'],['gross','90'],['net','999999999999999'],['dates','2026-02-30 2026-03-04'],['dates','2026-11-11 2026-11-04'],['__proto__','x'],['title','']])assert.throws(()=>validateField(field,value,service,'agent'));
 assert.throws(()=>validateField('category','refused_tour',service,'transport'));
 assert.equal(validateField('roomCategory','Superior',service,'agent').details.accommodationCategory,'Superior');
});
test('saved Telegram edits use the same id, retain notes and ignore replayed updates',async()=>{
 const f=fixture(),before=await getCorrection(f.pool,5,42);const args={providerId:5,serviceId:42,expectedToken:before.token,action:'field',field:'gross',value:'140',updateId:101};
 const updated=await mutateCorrection(f.pool,args);assert.equal(updated.service.id,42);assert.equal(updated.service.details.grossPrice,'140');assert.equal(updated.service.details.hotel,'A');assert.notEqual(updated.token,before.token);
 await mutateCorrection(f.pool,args);assert.equal(f.state.events.filter(e=>e.action==='provider_correction_edited').length,1);assert.ok(f.state.calls.some(sql=>sql.includes('FOR UPDATE')));
 await assert.rejects(()=>mutateCorrection(f.pool,{...args,updateId:102,value:'160'}),/изменились/);
});
test('checklist survives a new session and resets after a file replacement of the same count',async()=>{
 const f=fixture();let s=await getCorrection(f.pool,5,42);
 await mutateCorrection(f.pool,{providerId:5,serviceId:42,expectedToken:s.token,action:'check',code:'BAD_PRICE',checked:true,updateId:1});
 s=await getCorrection(f.pool,5,42);assert.deepEqual(s.checkedCodes,['BAD_PRICE']);
 await mutateCorrection(f.pool,{providerId:5,serviceId:42,expectedToken:s.token,action:'check',code:'BAD_PRICE',checked:true,updateId:2});assert.equal(f.state.events.filter(e=>e.action==='provider_correction_prepared').length,1);
 s=await mutateCorrection(f.pool,{providerId:5,serviceId:42,expectedToken:s.token,action:'remove',field:'proof',value:0,updateId:3});
 s=await mutateCorrection(f.pool,{providerId:5,serviceId:42,expectedToken:s.token,action:'add',field:'proof',value:image,updateId:4});
 assert.equal(s.service.details.proofImages.length,1);assert.deepEqual(s.checkedCodes,[]);assert.equal(s.service.details.proofReviewStatus,'pending');
 assert.ok(!JSON.stringify(f.state.events).includes(image));
});
test('ownership, pending status and audit rollback prevent mutations',async()=>{
 const f=fixture(),s=await getCorrection(f.pool,5,42);await assert.rejects(()=>getCorrection(f.pool,99,42),/не найдена/);
 f.state.service.status='pending';await assert.rejects(()=>mutateCorrection(f.pool,{providerId:5,serviceId:42,expectedToken:s.token,action:'remove',field:'proof',value:0}),/модерации/);assert.equal(f.state.service.details.proofImages.length,1);
 const broken=fixture({failAudit:true}),old=await getCorrection(broken.pool,5,42);await assert.rejects(()=>mutateCorrection(broken.pool,{providerId:5,serviceId:42,expectedToken:old.token,action:'field',field:'hotel',value:'B'}),/Audit/);assert.equal(broken.state.service.details.hotel,'A');assert.ok(broken.state.calls.includes('ROLLBACK'));
});
function context(session,data,updateId=1,actor=55){const replies=[];return {session,from:{id:actor},chat:{id:actor,type:'private'},update:{update_id:updateId},callbackQuery:data?{data}:undefined,replies,answerCbQuery:async()=>{},reply:async(text,opts)=>replies.push({text,opts}),replyWithPhoto:async(photo,opts)=>replies.push({photo,opts})};}
function flowFor(f){const notifications=[],downloads=[];const flow=createCorrectionFlow({pool:f.pool,resolve:async(_db,actor)=>({id:actor===55?5:99}),loadImage:async id=>{downloads.push(id);return image;},notifyModerationNew:async data=>notifications.push(data)});return {flow,notifications,downloads};}
test('Telegram callback and message sequence edits, acknowledges and submits exactly once',async()=>{
 const f=fixture(),{flow,notifications}=flowFor(f),session={};let ctx=context(session,'corr:open:42');await flow(ctx,()=>assert.fail('unexpected next'));assert.match(ctx.replies.at(-1).text,/TEST TOUR/);
 let s=await getCorrection(f.pool,5,42);await flow(context(session,`corr:field:42:gross:${s.token}`,2),()=>{});
 ctx=context(session,null,3);ctx.message={text:'140'};await flow(ctx,()=>{});assert.equal(f.state.service.details.grossPrice,'140');
 s=await getCorrection(f.pool,5,42);await flow(context(session,`corr:submit:42:${s.token}`,4),()=>{});assert.equal(f.state.service.status,'draft');assert.equal(notifications.length,0);
 for(const [i,code] of ['BAD_PRICE','BAD_PROOF'].entries())await flow(context(session,`corr:check:42:${code}:1:${s.token}`,5+i),()=>{});
 await flow(context(session,`corr:submit:42:${s.token}`,7),()=>{});await flow(context(session,`corr:submit:42:${s.token}`,8),()=>{});
 assert.equal(f.state.service.status,'pending');assert.equal(notifications.length,1);assert.deepEqual(notifications[0],{service:42,resubmitted:true});assert.equal(f.state.events.filter(e=>e.action==='correction_resubmitted').length,1);
});
test('Telegram photos and image documents stay private, deduplicate and reject bad input',async()=>{
 const f=fixture(),{flow,downloads}=flowFor(f),session={};let s=await getCorrection(f.pool,5,42);await flow(context(session,`corr:upload:42:proof:${s.token}`),()=>{});
 let ctx=context(session,null,20);ctx.message={document:{file_id:'pdf',mime_type:'application/pdf',file_size:10}};await flow(ctx,()=>{});assert.equal(downloads.length,0);
 ctx=context(session,null,21);ctx.message={document:{file_id:'huge',mime_type:'image/png',file_size:7*1024*1024}};await flow(ctx,()=>{});assert.equal(downloads.length,0);
 ctx=context(session,null,22);ctx.message={photo:[{file_id:'small'},{file_id:'best'}]};await flow(ctx,()=>{});await flow(ctx,()=>{});assert.equal(f.state.service.details.proofImages.length,2);assert.equal(f.state.service.images.length,1);
 s=await getCorrection(f.pool,5,42);ctx=context(session,`corr:view:42:proof:1:${s.token}`,23);await flow(ctx,()=>{});assert.ok(Buffer.isBuffer(ctx.replies[0].photo.source));
});
test('forwarded callbacks and group chats do not reveal proof; other bot workflows still run',async()=>{
 const f=fixture(),{flow,downloads}=flowFor(f);let ctx=context({},'corr:open:42',1,77);await flow(ctx,()=>{});assert.ok(!JSON.stringify(ctx.replies).includes('TEST TOUR'));
 ctx=context({},'corr:open:42');ctx.chat={id:-100,type:'group'};await flow(ctx,()=>{});assert.match(ctx.replies[0].text,/личном/);assert.equal(downloads.length,0);
 let next=0;ctx=context({correctionFlow:{serviceId:42}},'prov_services:list');await flow(ctx,()=>{next++;});assert.equal(next,1);assert.equal(ctx.session.correctionFlow,null);
});
test('callback payloads fit Telegram limits and messages split without broken surrogate pairs',()=>{
 const s={service:{id:'9223372036854775807'},token:'1234567890',correction:{reasonCodes:['MISSING_DETAILS','WRONG_CATEGORY','BAD_PROOF']},checkedCodes:[]};for(const row of keyboard(s).inline_keyboard)for(const b of row)assert.ok(Buffer.byteLength(b.callback_data)<=64,b.callback_data);
 const source='😀'.repeat(5000),parts=chunks(source);assert.equal(parts.join(''),source);assert.ok(parts.every(p=>p.length<=3800&&!/[\uD800-\uDBFF]$/.test(p)));
});

test('Telegraf dispatches real message/callback envelopes through the correction middleware without network',async()=>{
 const {Telegraf,Telegram,session}=require('telegraf');const f=fixture(),{flow}=flowFor(f),calls=[];
 const original=Telegram.prototype.callApi;Telegram.prototype.callApi=async function(method,payload){calls.push({method,payload});return {message_id:100,date:1,chat:{id:55,type:'private'}};};
 try {const bot=new Telegraf('123:test-only');bot.botInfo={id:123,is_bot:true,username:'travella_test_bot',first_name:'Test'};bot.use(session());bot.use(flow);
  await bot.handleUpdate({update_id:1000,message:{message_id:1,date:1,from:{id:55,is_bot:false,first_name:'QA'},chat:{id:55,type:'private'},text:'/corrections'}});
  await bot.handleUpdate({update_id:1001,callback_query:{id:'qa-callback',from:{id:55,is_bot:false,first_name:'QA'},chat_instance:'qa',message:{message_id:100,date:1,chat:{id:55,type:'private'}},data:'corr:open:42'}});
  assert.ok(calls.some(c=>c.method==='answerCallbackQuery'));assert.ok(calls.some(c=>c.method==='sendMessage'&&c.payload.text.includes('TEST TOUR')));
 }finally{Telegram.prototype.callApi=original;}
});

test('legacy proof preview checks ownership before reading any private files',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../telegram/bot.js'),'utf8');const from=source.indexOf('async function sendProofPreview('),to=source.indexOf('async function sendProofCardPreview(',from);let reads=0;
 const context={assertTelegramActorOwnsService:async()=>{throw new Error('not owner');},getProofImagesForService:async()=>{reads++;return ['private'];}};vm.createContext(context);vm.runInContext(source.slice(from,to),context);await assert.rejects(()=>context.sendProofPreview({},42),/not owner/);assert.equal(reads,0);
});
test('category choices use allowed provider categories and stale file buttons cannot delete another image',async()=>{
 const f=fixture(),{flow}=flowFor(f),session={};let s=await getCorrection(f.pool,5,42);let ctx=context(session,`corr:field:42:category:${s.token}`);await flow(ctx,()=>{});const buttons=ctx.replies.at(-1).opts.reply_markup.inline_keyboard.flat();assert.ok(buttons.some(b=>b.text==='refused hotel'));assert.ok(buttons.every(b=>Buffer.byteLength(b.callback_data)<=64));
 await mutateCorrection(f.pool,{providerId:5,serviceId:42,expectedToken:s.token,action:'add',field:'proof',value:image,updateId:100});await flow(context(session,`corr:del:42:proof:0:${s.token}`,101),()=>{});assert.equal(f.state.service.details.proofImages.length,2);
});

test('old proof buttons cannot expose private confirmations in a group even to their owner',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../telegram/bot.js'),'utf8');const a=source.indexOf('async function assertTelegramActorOwnsService('),b=source.indexOf('async function replyProofUploadPrompt(',a);let resolutions=0;
 const context={resolveProviderByTelegramActorId:async()=>{resolutions++;return {id:5};},pool:{query:async()=>({rowCount:1,rows:[{id:42,provider_id:5}]})}};vm.createContext(context);vm.runInContext(source.slice(a,b),context);
 await assert.rejects(()=>context.assertTelegramActorOwnsService({from:{id:55},chat:{id:-100,type:'group'}},42,'proof_view'),/личном/);assert.equal(resolutions,0);
 assert.equal(await context.assertTelegramActorOwnsService({from:{id:55},chat:{id:55,type:'private'}},42,'proof_view'),5);
});

test('Telegram separates waiting and returned services and history remains private',async()=>{
 const f=fixture(),{flow}=flowFor(f);let ctx=context({},'corr:list:0');await flow(ctx,()=>{});assert.ok(ctx.replies.at(-1).opts.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='corr:open:42'));
 f.state.service.status='pending';f.state.service.moderation_status='pending';f.state.service.submitted_at='2026-10-29T00:00:00Z';ctx=context({},'corr:returned:0');await flow(ctx,()=>{});assert.match(ctx.replies.at(-1).text,/повторную проверку/);assert.ok(ctx.replies.at(-1).opts.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='corr:open:42'));
 ctx=context({},'corr:history:42');await flow(ctx,()=>{});assert.ok(ctx.replies.some(r=>r.text.includes('Уточните цену и proof')));
 ctx=context({},'corr:history:42',1,77);await flow(ctx,()=>{});assert.ok(!JSON.stringify(ctx.replies).includes('Уточните цену и proof'));
});
