const test=require('node:test'),assert=require('node:assert/strict');
const {createBookingProofSources}=require('../telegram/handlers/bookingProofSources');
function fixture(options={}){
 const state={row:{id:42,category:'refused_hotel',status:'draft',moderation_status:'draft',details:{}},source:null},replies=[],previews=[],loads=[];let snapshot;
 async function query(sql,args=[]){
  if(sql.startsWith('CREATE')||sql.startsWith('DELETE'))return {rows:[]};
  if(sql.startsWith('BEGIN')){snapshot=JSON.parse(JSON.stringify(state));return {rows:[]};}
  if(sql.startsWith('ROLLBACK')){if(snapshot)Object.assign(state,JSON.parse(JSON.stringify(snapshot)));return {rows:[]};}
  if(sql.startsWith('COMMIT')){snapshot=null;return {rows:[]};}
  if(sql.startsWith('INSERT INTO telegram_booking_proof_sources')){state.source={files:JSON.parse(args[2]),used:false,actor:args[1],id:args[0]};return {rows:[]};}
  if(sql.startsWith('SELECT files,used'))return {rows:state.source&&state.source.actor===args[1]&&state.source.id===args[0]?[{files:state.source.files,used:state.source.used}]:[]};
  if(sql.startsWith('SELECT id,category')||sql.startsWith('SELECT details,status'))return {rows:args[0]===42&&args[1]===99?[JSON.parse(JSON.stringify(state.row))]:[]};
  if(sql.startsWith('UPDATE services')){state.row.details=JSON.parse(args[0]);return {rowCount:1,rows:[]};}
  if(sql.startsWith('UPDATE telegram_booking_proof_sources')){if(state.failMark)throw Error('db');state.source.used=true;return {rowCount:1,rows:[]};}
  throw Error('Unexpected SQL '+sql.slice(0,40));
 }
 const pool={query,connect:async()=>({query,release(){}})};
 const flow=createBookingProofSources({pool,resolveOwner:async ctx=>{if(ctx.from.id!==7)throw Error('DENIED');return 99;},loadImage:async id=>{loads.push(id);return 'data:image/png;base64,'+Buffer.from(id).toString('base64');},now:()=>100,...options});
 const session={};function context(actor=7,chat=7){return {session,from:{id:actor},chat:{id:chat,type:chat<0?'supergroup':'private'},reply:async(text,extra)=>{replies.push({text,extra});return {message_id:replies.length};},replyWithPhoto:async(id)=>{previews.push({id,kind:'photo'});return {message_id:1};},replyWithDocument:async(id)=>{previews.push({id,kind:'document'});return {message_id:1};},answerCbQuery:async()=>{}};}
 async function press(action,{actor=7,chat=7,token=session.bookingProofReview?.token}={}){const ctx=context(actor,chat);ctx.callbackQuery={data:`bookingproof:${action}:42:${token||'missing'}`};return flow(ctx,()=>{});}
 return {state,flow,replies,previews,loads,session,press,context};
}
test('proof requires private ownership, preview of every source and explicit privacy confirmation',async()=>{
 const f=fixture();await f.flow.prepare(f.context(),42,[{id:'one',kind:'photo'},{id:'two',kind:'document'}]);
 assert.equal(f.loads.length,0);assert.equal(f.state.row.details.proofImages,undefined);
 await f.press('attach');assert.equal(f.loads.length,0);assert.equal(f.state.source.used,false);
 await f.press('preview',{actor:8,chat:8});assert.equal(f.previews.length,0);
 await f.press('preview',{chat:-100});assert.equal(f.previews.length,0);
 await f.press('preview');assert.deepEqual(f.previews,[{id:'one',kind:'photo'},{id:'two',kind:'document'}]);assert.equal(f.loads.length,0);assert.ok(f.session.bookingProofReview);
 await f.press('attach');assert.equal(f.state.row.details.proofImages.length,2);assert.equal(f.state.source.used,true);assert.match(f.replies.at(-1).text,/ещё не отправлена/);
 const count=f.loads.length;await f.press('attach');assert.equal(f.state.row.details.proofImages.length,2);assert.equal(f.loads.length,count);
});
test('cancel, changed files and moderation status cannot attach unreviewed proof',async()=>{
 const f=fixture();await f.flow.prepare(f.context(),42,['one']);await f.press('preview');await f.press('cancel');assert.equal(f.state.row.details.proofImages,undefined);assert.equal(f.state.source.used,false);
 await f.press('preview');f.state.source.files.push({id:'changed',kind:'photo'});await f.press('attach');assert.equal(f.loads.length,0);
 f.state.row.status='pending';await f.press('preview');assert.equal(f.state.row.details.proofImages,undefined);
});
test('proof update and single-use marker roll back together, and concurrent confirmations do not duplicate files',async()=>{
 const f=fixture();await f.flow.prepare(f.context(),42,['one']);await f.press('preview');f.state.failMark=true;await f.press('attach');
 assert.equal(f.state.row.details.proofImages,undefined);assert.equal(f.state.source.used,false);
 f.state.failMark=false;await Promise.all([f.press('attach'),f.press('attach')]);assert.equal(f.state.row.details.proofImages.length,1);assert.equal(f.state.source.used,true);
});
test('proof count limit preserves all existing files and never sets the used marker on failure',async()=>{
 const f=fixture();f.state.row.details.proofImages=Array.from({length:20},(_,i)=>'existing'+i);await f.flow.prepare(f.context(),42,['one']);await f.press('preview');await f.press('attach');
 assert.equal(f.state.row.details.proofImages.length,20);assert.equal(f.state.source.used,false);
});

test('locally detected personal data blocks originals and requires a new confirmation after redaction',async()=>{
 const f=fixture({inspectImage:async()=>({status:'detected',boxes:[{kind:'name',x:0,y:500,width:1000,height:500}]}),redact:async()=>['data:image/png;base64,UkVEQUNURUQ=']});
 await f.flow.prepare(f.context(),42,['one']);await f.press('preview');assert.equal(f.session.bookingProofReview.flagged,true);assert.match(f.replies.at(-1).text,/личные данные/);const old=f.session.bookingProofReview.token;await f.press('attach');assert.equal(f.state.row.details.proofImages,undefined);await f.press('redact');assert.notEqual(f.session.bookingProofReview.token,old);assert.equal(f.state.row.details.proofImages,undefined);await f.press('attach',{token:old});assert.equal(f.state.row.details.proofImages,undefined);await f.press('attach');assert.deepEqual(f.state.row.details.proofImages,['data:image/png;base64,UkVEQUNURUQ=']);
});
test('unavailable local check says so explicitly and still requires manual review',async()=>{const f=fixture({inspectImage:async()=>{throw Error('OCR');}});await f.flow.prepare(f.context(),42,['one']);await f.press('preview');assert.ok(f.replies.some(r=>/недоступна/.test(r.text)));assert.equal(f.state.row.details.proofImages,undefined);await f.press('attach');assert.equal(f.state.row.details.proofImages.length,1);});

test('proof mismatch is shown and requires a separate manual conditions confirmation',async()=>{const f=fixture({inspectImage:async()=>({status:'clear',boxes:[],content:[{field:'hotel',status:'different'},{field:'start',status:'match'}]})});f.state.row.details={hotel:'TEST Hotel',startDate:'2099-12-01'};await f.flow.prepare(f.context(),42,['one']);await f.press('preview');assert.match(f.replies.at(-1).text,/расхождение/);await f.press('attach');assert.equal(f.state.row.details.proofImages,undefined);const old=f.session.bookingProofReview.token;await f.press('matchack');assert.notEqual(f.session.bookingProofReview.token,old);await f.press('attach');assert.equal(f.state.row.details.proofImages.length,1);});
test('changing the card after proof review requires a fresh comparison',async()=>{const f=fixture();f.state.row.details={hotel:'TEST A',startDate:'2099-12-01'};await f.flow.prepare(f.context(),42,['one']);await f.press('preview');f.state.row.details.hotel='TEST B';await f.press('attach');assert.equal(f.state.row.details.proofImages,undefined);assert.match(f.replies.at(-1).text,/изменилась/);assert.equal(f.session.bookingProofReview,undefined);});
test('transaction rechecks the card fingerprint if the card changes while the image downloads',async()=>{let f;f=fixture({loadImage:async()=>{f.state.row.details.hotel='TEST B';return 'data:image/png;base64,VEVTVA==';}});f.state.row.details={hotel:'TEST A'};await f.flow.prepare(f.context(),42,['one']);await f.press('preview');await f.press('attach');assert.equal(f.state.row.details.proofImages,undefined);assert.equal(f.state.source.used,false);assert.match(f.replies.at(-1).text,/изменилась/);});
