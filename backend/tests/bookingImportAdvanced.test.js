const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeBooking}=require('../ai/bookingScreenshot');
const {mergeRecognition,missingFields,validateEdit,setField}=require('../ai/bookingImportReview');
const {createBookingScreenshotFlow}=require('../telegram/handlers/bookingScreenshotFlow');
const {createBookingDuplicateFinder,createBookingDuplicateGuard}=require('../ai/bookingDuplicates');
function fixture(){
 const session={},replies=[],accepted=[],calls=[];let clock=100000;const state={sources:[],matches:[]};
 const flow=createBookingScreenshotFlow({authorize:async()=>true,now:()=>clock,loadImage:async(_ctx,id)=>Buffer.from(id),read:async(_bytes,category)=>{calls.push('read');return normalizeBooking(state.sources.shift()||{country:'Вьетнам',toCity:'Фукуок',hotel:'TEST Hotel',startDate:'2099-12-01',endDate:'2099-12-08'},category);},findDuplicates:async()=>{if(state.dbError)throw Error('db');return state.matches;},onAccept:async(_ctx,d)=>accepted.push(d)});
 async function send({text,data,id,chat=7,actor=7}={}){let passed=false;await flow({session,chat:{id:chat,type:chat<0?'supergroup':'private'},from:{id:actor},message:data?undefined:{text,...(id?{photo:[{file_id:id,file_size:100}]}:{})},callbackQuery:data?{data}:undefined,answerCbQuery:async()=>{},reply:async(text,extra)=>{replies.push({text,extra});return {message_id:replies.length};}},()=>{passed=true;});return passed;}
 const press=action=>send({data:`booking:${action}:${session.bookingImport?.token}`});
 return {session,replies,accepted,calls,state,send,press,advance(){clock+=31000;}};
}
test('unreadable fields stay empty while uncertainty uses safe field identifiers only',()=>{
 const d=normalizeBooking({toCity:'Фукуок',hotel:'Hotel',startDate:'2099-12-01',uncertainFields:[{field:'startDate',reason:'unreadable'},{field:'hotel',reason:'partial'},{field:'passport',reason:'unreadable'},{field:'hotel',reason:'PRIVATE TEXT'}]});
 assert.equal(d.startDate,undefined);assert.equal(d.hotel,'Hotel');assert.equal(d.bookingWarnings.length,2);assert.ok(!JSON.stringify(d).includes('PRIVATE TEXT'));
 assert.ok(missingFields(d).includes('Заезд / начало'));assert.ok(missingFields(d).includes('Цена поставщика'));assert.ok(missingFields(d).includes('Срок актуальности'));
});
test('complementary screenshots merge but contradictory hotel values require an explicit choice',async()=>{
 const f=fixture();f.state.sources=[{country:'Вьетнам',toCity:'Фукуок',hotel:'TEST A',startDate:'2099-12-01',endDate:'2099-12-08'},{hotel:'TEST B',food:'BB',roomCategory:'Deluxe'}];
 await f.send({text:'/frombooking'});await f.press('cat_refused_hotel');await f.send({id:'one'});await f.send({id:'two'});assert.equal(f.calls.length,0);await f.press('read');
 const s=f.session.bookingImport;assert.equal(s.files.length,2);assert.equal(s.draft.hotel,'TEST A');assert.equal(s.draft.food,'BB');assert.equal(s.conflicts.length,1);
 await f.press('accept');assert.equal(f.accepted.length,0);assert.match(f.replies.at(-1).text,/разные значения/);
 await f.press('choose_0_1');assert.equal(s.draft.hotel,'TEST B');assert.equal(s.conflicts.length,0);assert.match(f.replies.at(-1).text,/TEST B/);
 assert.match(s.draft.title,/TEST B/);
});
test('all field corrections return to review and new screenshots do not overwrite a manual correction',async()=>{
 const f=fixture();await f.send({id:'one'});await f.press('read');await f.press('fix_svc_create_tour_hotel');await f.send({text:'TEST Manual'});
 assert.equal(f.session.bookingImport.stage,'review');assert.match(f.replies.at(-1).text,/TEST Manual/);assert.equal(f.accepted.length,0);
 f.advance();f.state.sources=[{hotel:'TEST OCR Other',food:'HB'}];await f.send({id:'two'});await f.press('read');assert.equal(f.session.bookingImport.draft.hotel,'TEST Manual');assert.equal(f.session.bookingImport.conflicts.length,0);assert.equal(f.session.bookingImport.draft.food,'HB');
});
test('partial values require acknowledgement and correcting an unreadable field removes its warning',async()=>{
 const f=fixture();f.state.sources=[{toCity:'Фукуок',hotel:'TEST Hotel',uncertainFields:[{field:'hotel',reason:'partial'},{field:'startDate',reason:'unreadable'}]}];await f.send({id:'one'});await f.press('read');
 assert.match(f.replies.at(-1).text,/⚠️/);await f.press('accept');assert.equal(f.session.bookingImport.stage,'review');assert.equal(f.accepted.length,0);
 await f.press('ackwarnings');await f.press('fix_svc_create_tour_start');await f.send({text:'31.02.2099'});assert.equal(f.session.bookingImport.stage,'field');await f.send({text:'01.12.2099'});assert.equal(f.session.bookingImport.stage,'review');assert.equal(f.session.bookingImport.warnings.length,0);
});
test('duplicate warning is scoped to the current search signature and cannot be accepted silently',async()=>{
 const f=fixture();await f.send({id:'one'});await f.press('read');await f.press('accept');await f.send({text:'2+0+0'});f.state.matches=[{id:42,title:'TEST existing'}];await f.press('accept');assert.equal(f.accepted.length,0);assert.match(f.replies.at(-1).text,/Похожее/);
 f.state.matches=[{id:43,title:'TEST new duplicate'}];await f.press('duplicate_continue');assert.equal(f.accepted.length,0);await f.press('duplicate_continue');assert.equal(f.accepted.length,1);assert.ok(f.accepted[0].bookingDuplicateAcknowledged);assert.equal(f.accepted[0].bookingSourceFiles[0].id,'one');assert.deepEqual(f.accepted[0].images,[]);
});
test('failed duplicate lookup preserves review and file limits plus stale callbacks prevent accidental replacement',async()=>{
 const f=fixture();await f.send({id:'one'});const old=`booking:read:${f.session.bookingImport.token}`;await f.send({id:'two'});await f.send({data:old});assert.equal(f.calls.length,0);
 for(const id of ['three','four','five','six'])await f.send({id});assert.equal(f.session.bookingImport.files.length,5);
 await f.press('read');await f.press('accept');await f.send({text:'1+0+0'});f.state.dbError=true;await f.press('accept');assert.equal(f.accepted.length,0);assert.equal(f.session.bookingImport.stage,'review');
});
test('merge keeps distinct flight numbers but flags conflicting data for the same flight',()=>{
 const s={category:'refused_flight',files:[]};mergeRecognition(s,normalizeBooking({fromCity:'TAS',toCity:'DXB',flights:[{number:'HY333',date:'2099-12-01',departure:'08:00'}]},'refused_flight'),1);
 mergeRecognition(s,normalizeBooking({flights:[{number:'HY334',date:'2099-12-08'}]},'refused_flight'),2);assert.match(s.draft.flightDetails,/HY333/);assert.match(s.draft.flightDetails,/HY334/);
 mergeRecognition(s,normalizeBooking({flights:[{number:'HY333',date:'2099-12-01',departure:'09:00'}]},'refused_flight'),3);assert.ok(s.conflicts.some(c=>c.field==='flightDetails'));
});
test('date and enum editing reject impossible values and never invent a return date for one-way flights',()=>{
 assert.throws(()=>validateEdit('food','something',{}));assert.throws(()=>validateEdit('endDate','01.12.2099',{startDate:'2099-12-08'}));
 const s={draft:{category:'refused_flight',returnFlightDate:'2099-12-08'},conflicts:[{field:'returnFlightDate'}]};setField(s,'flightType','one_way');assert.equal(s.draft.returnFlightDate,undefined);assert.equal(s.conflicts.length,0);
});
test('duplicate SQL always includes the resolved provider, category and dates and excludes unrelated routes',async()=>{
 let args,sql;const pool={query:async(q,a)=>{sql=q;args=a;return {rows:[{id:1,title:'match',details:{directionFrom:'Ташкент',directionTo:'Фукуок',hotel:'TEST'}},{id:2,title:'other',details:{directionFrom:'Самарканд',directionTo:'Фукуок',hotel:'TEST'}}]};}};
 const find=createBookingDuplicateFinder(pool,async(_pool,actor)=>{assert.equal(actor,7);return {id:99};});const result=await find({from:{id:7}},{category:'refused_tour',fromCity:'Ташкент',toCity:'Фукуок',hotel:'TEST',startDate:'2099-12-01',endDate:'2099-12-08'});
 assert.deepEqual(args,[99,'refused_tour','2099-12-01','2099-12-08']);assert.match(sql,/provider_id=\$1/);assert.match(sql,/deleted_at IS NULL/);assert.equal(result.length,1);assert.equal(result[0].id,1);
});
test('final creation guard rechecks duplicates and explicit confirmation is single-use',async()=>{
 let matches=[{id:42,title:'TEST'}],continued=0;const session={serviceDraft:{category:'refused_hotel',hotel:'TEST',toCity:'City',startDate:'2099-12-01',bookingImportVersion:2}};const replies=[];
 const ctx={session,chat:{id:7,type:'private'},from:{id:7},reply:async(t,e)=>replies.push({t,e}),answerCbQuery:async()=>{}};
 const guard=createBookingDuplicateGuard({find:async()=>matches,onContinue:async()=>{continued++;},now:()=>100});assert.equal(await guard.check(ctx,session.serviceDraft),false);
 const token=session.bookingDuplicatePending.token;ctx.callbackQuery={data:'bookingdup:confirm:'+token};await Promise.all([guard(ctx,()=>{}),guard(ctx,()=>{})]);assert.equal(continued,1);
 await guard(ctx,()=>{});assert.equal(continued,1);
});
