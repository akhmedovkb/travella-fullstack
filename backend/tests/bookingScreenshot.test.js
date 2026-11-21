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
 const flow=createBookingScreenshotFlow({authorize:async()=>state.authorized,now:()=>clock,loadImage:async()=>{calls.push('download');return Buffer.from('image');},read:async()=>{calls.push('read');if(state.fail)throw Error('failed');return normalizeBooking({country:'Вьетнам',hotel:'Hotel',accommodation:'DBL',startDate:'2099-11-25',endDate:'2099-12-02',transferIncluded:true,flights:[]});},onAccept:async(ctx,draft,step)=>accepted.push({draft,step})});
 async function send({text,data,photo,document,chat=7,actor=7}={}){
  let passed=false;await flow({session,chat:{id:chat,type:chat<0?'supergroup':'private'},from:{id:actor},message:data?undefined:{text,photo,document},callbackQuery:data?{data}:undefined,answerCbQuery:async()=>{},reply:async(text,extra)=>{replies.push({text,extra});}},()=>{passed=true;});return passed;
 }
 const press=async action=>send({data:`booking:${action}:${session.bookingImport?.token}`});
 return {session,replies,accepted,calls,state,send,press,expire(){clock+=16*60000;}};
}
test('image consent, review, party confirmation and accept use no public sends and do not auto-publish the source',async()=>{
 const f=fixture();await f.send({photo:[{file_id:'private',file_size:100}]});assert.equal(f.calls.length,0);assert.match(f.replies.at(-1).text,/OpenAI/);
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
