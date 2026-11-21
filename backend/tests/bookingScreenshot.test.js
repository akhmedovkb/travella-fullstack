const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeBooking,importedNextStep}=require('../ai/bookingScreenshot');
const {createBookingScreenshotFlow}=require('../telegram/handlers/bookingScreenshotFlow');
const {getServiceWizardSteps}=require('../utils/serviceWizardEngine');
test('booking extraction whitelists travel facts and never copies personal records, prices, party guesses or images',()=>{
 const d=normalizeBooking({hotel:'Hotel +998901234567 AB1234567',fromCity:'Ташкент',toCity:'Фукуок',startDate:'25.11.2026',endDate:'02.12.2026',food:'BB',transferIncluded:true,insuranceIncluded:null,flights:[],names:['PRIVATE'],passport:'AB1234567',birthDate:'2002-06-17',price:123,adt:2,proofImages:['secret'],images:['secret']});
 assert.equal(d.startDate,'2026-11-25');assert.equal(d.endDate,'2026-12-02');assert.equal(d.transferIncluded,true);assert.equal(d.insuranceIncluded,undefined);
 assert.deepEqual(d.images,[]);for(const k of ['names','passport','birthDate','price','adt','proofImages'])assert.equal(d[k],undefined);
 assert.ok(!d.hotel.includes('998901234567'));assert.ok(!d.hotel.includes('AB1234567'));
});
test('invalid dates and impossible date order stay missing rather than becoming confirmed wizard values',()=>{
 const d=normalizeBooking({startDate:'2026-02-30',endDate:'junk',flights:[]});assert.equal(d.startDate,undefined);assert.equal(d.endDate,undefined);
 const e=normalizeBooking({startDate:'2026-12-02',endDate:'2026-11-25'});assert.equal(e.endDate,undefined);
});
test('recognized steps advance through the real tour contract but remain editable when going back',()=>{
 const d={bookingImportSkip:['svc_create_tour_country','svc_create_tour_from','svc_create_tour_to']};
 const steps=getServiceWizardSteps('refused_tour');
 assert.equal(importedNextStep(d,'svc_create_tour_country',steps),'svc_create_tour_start');
 assert.equal(importedNextStep(d,'svc_create_tour_country',steps),'svc_create_tour_country');
 assert.equal(importedNextStep(d,'svc_create_price',steps),'svc_create_price');
});
function fixture(){
 const session={},replies=[],accepted=[],calls=[];let clock=100000;
 const state={authorized:true,fail:false};
 const flow=createBookingScreenshotFlow({authorize:async()=>state.authorized,now:()=>clock,loadImage:async()=>{calls.push('download');return Buffer.from('image');},read:async(_bytes,category)=>{calls.push('read');if(state.fail)throw Error('failed');return normalizeBooking({country:'Вьетнам',hotel:'Hotel',accommodation:'DBL',startDate:'2099-11-25',endDate:'2099-12-02',transferIncluded:true,flightType:state.flightType,flights:[],...state.source},category);},onAccept:async(ctx,draft,step)=>accepted.push({draft,step})});
 async function send({text,data,photo,document,chat=7,actor=7}={}){
  let passed=false;await flow({session,chat:{id:chat,type:chat<0?'supergroup':'private'},from:{id:actor},message:data?undefined:{text,photo,document},callbackQuery:data?{data}:undefined,answerCbQuery:async()=>{},editMessageText:state.inlineEdit?async()=>{calls.push('edit-panel');return {message_id:1};}:undefined,reply:async(text,extra)=>{replies.push({text,extra});}},()=>{passed=true;});return passed;
 }
 const press=async action=>send({data:`booking:${action}:${session.bookingImport?.token}`});
 return {session,replies,accepted,calls,state,send,press,expire(){clock+=16*60000;}};
}
test('image consent, review, party confirmation and accept use no public sends and do not auto-publish the source',async()=>{
 const f=fixture();await f.send({photo:[{file_id:'private',file_size:100}]});assert.equal(f.calls.length,0);assert.match(f.replies.at(-1).text,/Распознать/);assert.doesNotMatch(f.replies.at(-1).text,/OpenAI|ИИ/);
 await f.press('read');assert.deepEqual(f.calls,['download','read']);assert.equal(f.accepted.length,0);assert.match(f.replies.at(-1).text,/Hotel/);
 await f.press('accept');assert.equal(f.session.bookingImport.stage,'party');assert.equal(f.accepted.length,0);
 await f.send({text:'Иван Иванов'});assert.equal(f.accepted.length,0);
 await f.send({text:'2+0+0'});const stale=`booking:accept:${f.session.bookingImport.token}`;await f.press('accept');
 assert.equal(f.accepted.length,1);assert.equal(f.accepted[0].draft.adt,2);assert.equal(f.accepted[0].draft.bookingPartyConfirmed,true);assert.deepEqual(f.accepted[0].draft.images,[]);
 assert.ok(f.accepted[0].draft.bookingImportSkip.includes('svc_create_tour_hotel'));
 await f.send({data:stale});assert.equal(f.accepted.length,1);
});
test('edit selects an existing field while keeping other recognized fields and confirmed party intact',async()=>{
 const f=fixture();await f.send({photo:[{file_id:'x'}]});await f.press('read');await f.press('edit');await f.press('fix_svc_create_tour_hotel');await f.send({text:'2+1+0'});await f.press('accept');
 assert.equal(f.accepted[0].step,'svc_create_tour_hotel');assert.equal(f.accepted[0].draft.chd,1);assert.ok(!f.accepted[0].draft.bookingImportSkip.includes('svc_create_tour_hotel'));assert.ok(f.accepted[0].draft.bookingImportSkip.includes('svc_create_tour_start'));
});
test('group images, proof, edits and existing wizard uploads keep their original routes',async()=>{
 for(const session of [{state:'svc_create_photo'}, {awaitingProofForServiceId:42}, {editingServiceId:42},{correctionFlow:{}},{companionFlow:{}}]){
  const f=fixture();Object.assign(f.session,session);assert.equal(await f.send({photo:[{file_id:'x'}]}),true);assert.equal(f.calls.length,0);
 }
 const f=fixture();assert.equal(await f.send({chat:-100,photo:[{file_id:'x'}]}),true);assert.equal(f.replies.length,0);
});
test('authorization, expiry, oversized files and failed recognition cannot accept a draft',async()=>{
 const f=fixture();f.state.authorized=false;await f.send({photo:[{file_id:'x'}]});assert.equal(f.session.bookingImport,undefined);
 f.state.authorized=true;await f.send({photo:[{file_id:'x',file_size:7*1024*1024}]});assert.equal(f.session.bookingImport,undefined);
 await f.send({photo:[{file_id:'x'}]});f.expire();await f.press('read');assert.equal(f.calls.length,0);
 await f.send({photo:[{file_id:'x'}]});f.state.fail=true;await f.press('read');assert.equal(f.accepted.length,0);assert.match(f.replies.at(-1).text,/Не удалось/);
});

test('after fixing a recognized field the real wizard returns to earlier missing fields without asking fixed values twice',()=>{
 const steps=getServiceWizardSteps('refused_tour');
 const d=normalizeBooking({country:'Вьетнам',fromCity:'Ташкент',toCity:'Фукуок',startDate:'2099-11-25',endDate:'2099-12-02',hotel:'TEST Hotel',accommodation:'DBL',roomCategory:'Standard',food:'BB',flightDetails:'ignored',transferIncluded:true,insuranceIncluded:true});
 delete d.title; // Existing drafts without an auto-generated title still require it.
 d.flightDetails='HH2233';
 const {stepFields}=require('../ai/bookingScreenshot');
 d.bookingImportSkip=Object.entries(stepFields).filter(([s,k])=>s!=='svc_create_tour_hotel'&&d[k]!==undefined).map(([s])=>s);
 d.bookingImportEditingStep='svc_create_tour_hotel';
 assert.equal(importedNextStep(d,'svc_create_tour_hotel',steps),'svc_create_tour_hotel');
 d.hotel='TEST corrected';
 assert.equal(importedNextStep(d,'svc_create_tour_accommodation',steps),'svc_create_title');
 d.title='TEST tour';
 assert.equal(importedNextStep(d,'svc_create_tour_country',steps),'svc_create_tour_visa');
 assert.equal(d.hotel,'TEST corrected');assert.equal(d.bookingImportEditingStep,undefined);
});

test('hotel and flight normalization keeps only category-specific facts and never guesses one-way from one leg',()=>{
 const raw={hotel:'TEST hotel',country:'Вьетнам',fromCity:'Ташкент',toCity:'Фукуок',startDate:'2099-12-01',endDate:'2099-12-08',food:'BB',flights:[{number:'HH2233',date:'2099-12-01',from:'TAS',to:'PQC'}]};
 const hotel=normalizeBooking(raw,'refused_hotel');assert.equal(hotel.hotel,'TEST hotel');assert.equal(hotel.flightDetails,undefined);assert.equal(hotel.fromCity,undefined);
 const flight=normalizeBooking(raw,'refused_flight');assert.equal(flight.hotel,undefined);assert.equal(flight.food,undefined);assert.equal(flight.startDate,undefined);assert.equal(flight.departureFlightDate,'2099-12-01');assert.equal(flight.flightType,undefined);
 const round=normalizeBooking({...raw,flightType:'round_trip',returnFlightDate:'2099-12-08',flights:[...raw.flights,{date:'2099-12-08',number:'HH2234'}]},'refused_flight');assert.equal(round.returnFlightDate,'2099-12-08');
 const one=normalizeBooking({...raw,flightType:'one_way',flights:round.flights},'refused_flight');assert.equal(one.returnFlightDate,undefined);
});
test('category selection reaches the appropriate real wizard and field corrections cannot cross categories',async()=>{
 const {stepFieldsFor}=require('../ai/bookingScreenshot');
 for(const category of ['refused_hotel','refused_flight']){
  const f=fixture();await f.send({text:'/frombooking'});await f.press('cat_'+category);await f.send({photo:[{file_id:'test'}]});await f.press('read');
  assert.equal(f.session.bookingImport.draft.category,category);
  await f.press('fix_svc_create_tour_hotel');assert.equal(f.accepted.length,0);assert.equal(f.session.bookingImport.stage,'review');
  await f.press('edit');const step=category==='refused_hotel'?'svc_hotel_name':'svc_create_flight_details';await f.press('fix_'+step);await f.send({text:'2+0+0'});await f.press('accept');
  const d=f.accepted[0].draft;assert.equal(d.category,category);assert.equal(f.accepted[0].step,step);
  const steps=getServiceWizardSteps(category,'',d);assert.ok(steps.includes(step));assert.ok(d.bookingImportSkip.every(s=>steps.includes(s)));
  assert.equal(stepFieldsFor(category)[step],category==='refused_hotel'?'hotel':'flightDetails');
 }
});
test('one-way imported flights never stop at return date and stale category buttons cannot change a newer image',async()=>{
 const {stepFieldsFor}=require('../ai/bookingScreenshot');
 const d={category:'refused_flight',bookingPartyConfirmed:true,flightType:'one_way',departureFlightDate:'2099-12-01',flightDetails:'HH2233'};
 d.bookingImportSkip=Object.entries(stepFieldsFor(d.category)).filter(([,k])=>d[k]!==undefined).map(([s])=>s);
 const steps=getServiceWizardSteps(d.category,'',d);assert.ok(!steps.includes('svc_create_flight_return'));assert.equal(importedNextStep(d,'svc_create_flight_type',steps),'svc_create_price');
 assert.equal(importedNextStep(d,'svc_create_tour_country',steps),'svc_create_tour_from');
 const f=fixture();await f.send({text:'/frombooking'});const stale='booking:cat_refused_hotel:'+f.session.bookingImport.token;await f.send({photo:[{file_id:'new'}]});await f.send({data:stale});assert.equal(f.session.bookingImport.category,'refused_tour');
});

test('connecting flights never turn the second outbound segment into a return journey',()=>{
 const raw={flightType:'round_trip',flights:[{from:'TAS',to:'IST',date:'2099-12-01'},{from:'IST',to:'CDG',date:'2099-12-02'}]};
 assert.equal(normalizeBooking(raw,'refused_flight').returnFlightDate,undefined);
 assert.equal(normalizeBooking({...raw,returnFlightDate:'2099-12-10'},'refused_flight').returnFlightDate,'2099-12-10');
});

test('compact edit menu groups hotel fields and returning to review neither reparses nor saves the draft',async()=>{
 const {bookingEditRows}=require('../ai/bookingScreenshotUi');
 const rows=bookingEditRows({category:'refused_hotel'});
 assert.ok(rows.length<=8);assert.ok(rows.every(r=>r.length<=2));
 const f=fixture();await f.send({text:'/frombooking'});await f.press('cat_refused_hotel');await f.send({photo:[{file_id:'test'}]});await f.press('read');
 const before=JSON.stringify(f.session.bookingImport.draft);await f.press('edit');await f.press('review');
 assert.equal(JSON.stringify(f.session.bookingImport.draft),before);assert.equal(f.calls.filter(x=>x==='read').length,1);assert.equal(f.accepted.length,0);assert.match(f.replies.at(-1).text,/Проверьте распознанные данные/);
});
test('one-way flight edit menu omits return date and forged stale return actions cannot enter a party or save',async()=>{
 const {bookingEditRows}=require('../ai/bookingScreenshotUi');
 assert.ok(!bookingEditRows({category:'refused_flight',flightType:'one_way'}).flat().some(([,a])=>a==='fix_svc_create_flight_return'));
 assert.ok(bookingEditRows({category:'refused_flight',flightType:'round_trip'}).flat().some(([,a])=>a==='fix_svc_create_flight_return'));
 const f=fixture();f.state.flightType='one_way';await f.send({text:'/frombooking'});await f.press('cat_refused_flight');await f.send({photo:[{file_id:'test'}]});await f.press('read');
 await f.press('fix_svc_create_flight_return');assert.equal(f.session.bookingImport.stage,'review');assert.equal(f.accepted.length,0);
});

test('edit and review update one Telegram panel without losing recognized data or issuing another AI request',async()=>{
 const f=fixture();f.state.inlineEdit=true;await f.send({photo:[{file_id:'test'}]});await f.press('read');
 const count=f.replies.length;const draft=JSON.stringify(f.session.bookingImport.draft);
 await f.press('edit');await f.press('review');
 assert.equal(f.calls.filter(x=>x==='edit-panel').length,2);assert.equal(f.replies.length,count);assert.equal(f.calls.filter(x=>x==='read').length,1);assert.equal(JSON.stringify(f.session.bookingImport.draft),draft);assert.equal(f.accepted.length,0);
});

test('auto titles use only recognized category facts and do not invent a missing destination or hotel',()=>{
 assert.equal(normalizeBooking({toCity:'Фукуок'}).title,'Отказной тур — Фукуок');
 assert.equal(normalizeBooking({country:'Вьетнам'}).title,'Отказной тур — Вьетнам');
 assert.equal(normalizeBooking({hotel:'TH Luxury Phu Quoc'},'refused_hotel').title,'Отказной отель — TH Luxury Phu Quoc');
 assert.equal(normalizeBooking({fromCity:'Ташкент',toCity:'Дубай'},'refused_flight').title,'Отказной авиабилет — Ташкент → Дубай');
 assert.equal(normalizeBooking({}).title,undefined);assert.equal(normalizeBooking({toCity:'Дубай'},'refused_flight').title,undefined);assert.equal(normalizeBooking({country:'Вьетнам'},'refused_hotel').title,undefined);
});
test('all categories can change the title in review and accept it without a second wizard title prompt',async()=>{
 for(const category of ['refused_tour','refused_hotel','refused_flight']){
  const f=fixture();await f.send({text:'/frombooking'});await f.press('cat_'+category);await f.send({photo:[{file_id:'test'}]});await f.press('read');
  await f.press('fix_svc_create_title');assert.equal(f.session.bookingImport.stage,'title');
  await f.send({text:'x'});assert.equal(f.session.bookingImport.stage,'title');
  await f.send({text:'TEST — моё название'});assert.equal(f.session.bookingImport.stage,'review');assert.match(f.replies.at(-1).text,/TEST — моё название/);assert.equal(f.accepted.length,0);
  await f.press('accept');await f.send({text:'2+0+0'});await f.press('accept');
  const d=f.accepted[0].draft;assert.equal(d.title,'TEST — моё название');assert.ok(d.bookingImportSkip.includes('svc_create_title'));
  assert.notEqual(importedNextStep(d,'svc_create_title',getServiceWizardSteps(category,'',d)),'svc_create_title');assert.equal(f.calls.filter(x=>x==='read').length,1);
 }
});
test('back from title editing preserves the generated title without accepting or rerunning recognition',async()=>{
 const f=fixture();await f.send({photo:[{file_id:'test'}]});await f.press('read');const title=f.session.bookingImport.draft.title;
 await f.press('fix_svc_create_title');await f.press('review');assert.equal(f.session.bookingImport.draft.title,title);assert.equal(f.session.bookingImport.stage,'review');assert.equal(f.accepted.length,0);
});

test('accepting an automatically generated title skips the title step for tours hotels and flights',async()=>{
 for(const category of ['refused_tour','refused_hotel','refused_flight']){
  const f=fixture();f.state.source={fromCity:'Ташкент',toCity:'Дубай',hotel:'TEST Hotel'};
  await f.send({text:'/frombooking'});await f.press('cat_'+category);await f.send({photo:[{file_id:'test'}]});await f.press('read');
  const title=f.session.bookingImport.draft.title;assert.ok(title);assert.match(f.replies.at(-1).text,/Название:/);
  await f.press('accept');await f.send({text:'1+0+0'});await f.press('accept');
  const d=f.accepted[0].draft;assert.equal(d.title,title);assert.ok(d.bookingImportSkip.includes('svc_create_title'));assert.notEqual(importedNextStep(d,'svc_create_title',getServiceWizardSteps(category,'',d)),'svc_create_title');
 }
});
