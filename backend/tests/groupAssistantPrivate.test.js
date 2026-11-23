const test=require('node:test');
const assert=require('node:assert/strict');
const {createPrivateGroupAssistant}=require('../telegram/handlers/groupAssistantPrivate');
const {normalizeIntent}=require('../ai/groupAssistantModel');
const {createGroupAssistantHandoffs}=require('../ai/groupAssistantHandoffs');
const output=normalizeIntent({kind:'search',language:'ru',filters:{destination:['Вьетнам'],origin:['Ташкент'],start:'2099-12-01',end:'2099-12-31',guests:2,budget:null,category:'refused_tour'}});
function fixture(extra={}){
 const replies=[],posts=[],calls=[],panels=new Map(),links=new Map();let sequence=0,tokenId=0;
 const state={offers:[{id:42,title:'Отказной тур',category:'refused_tour',origin:'Ташкент',destination:'Вьетнам',start:'2099-12-01',end:'2099-12-10',price:900,currency:'USD',priceBasis:'total',guests:2}],member:true};
 const handoffs={initialize:async()=>{},create:async value=>{const token=String(++tokenId).padStart(48,'0');links.set(token,{...value});return token;},update:async(token,ownerId,question)=>{if(links.get(token)?.ownerId===ownerId)links.get(token).question=question;},get:async(token,actor)=>{const value=links.get(token);return value&&(value.ownerId==null||value.ownerId===actor)?{groupId:value.groupId,topicId:value.topicId,title:value.title,question:value.question}:null;}};
 const store={initialize:async()=>{},enabled:async()=>true,autoEnabled:async()=>true,reserve:async id=>{calls.push({kind:'quota',id});return true;},activate:async()=>{},setAuto:async()=>{}};
 const options={pool:{},handoffs,store,model:{ready:()=>true,interpret:async(text,previous)=>{calls.push({kind:'model',text,previous});return output;}},search:async filters=>{calls.push({kind:'search',filters});return state.offers;}};
 Object.assign(options,extra);
 let flow=createPrivateGroupAssistant(options);
 function record(chat,text,extra,id=++sequence){const item={chat,text,extra,id};if(extra?.reply_markup?.inline_keyboard)panels.set(chat,item);return {message_id:id};}
 const telegram={getChat:async()=>({permissions:{can_send_messages:state.groupCanSend!==false}}),getChatMember:async()=>({status:state.member?(state.memberRole||'member'):'left',is_member:state.member,can_send_messages:state.canSend!==false}),editMessageText:async(chat,id,_inline,text,extra)=>record(chat,text,extra,id),editMessageReplyMarkup:async()=>{},sendMessage:async(chat,text,extra)=>{posts.push({chat,text,extra});return {message_id:++sequence};}};
 async function send({text,chat=-100,actor=7,data,messageId,topic}={}){
  const ctx={chat:{id:chat,type:chat>0?'private':'supergroup',title:chat<0?'Коллеги '+chat:undefined},from:{id:actor},botInfo:{id:99,username:'TravellaBot'},telegram,
   message:data?undefined:{text,message_id:++sequence,...(topic?{is_topic_message:true,message_thread_id:topic}:{})},callbackQuery:data?{data,message:{message_id:messageId||panels.get(chat)?.id}}:undefined,
   reply:async(text,extra)=>{replies.push({chat,text,extra});return record(chat,text,extra);},answerCbQuery:async text=>{calls.push({kind:'ack',text});},editMessageText:async(text,extra)=>record(chat,text,extra,messageId||panels.get(chat)?.id),editMessageReplyMarkup:async()=>{},sendChatAction:async()=>{},
  };
  let passed=false;await flow(ctx,()=>{passed=true;});return {passed,ctx};
 }
 const link=chat=>new URL(panels.get(chat).extra.reply_markup.inline_keyboard[0][0].url).searchParams.get('start');
 const press=async(action,{actor=7,chat=7}={})=>{const panel=panels.get(chat);const button=panel.extra.reply_markup.inline_keyboard.flat().find(b=>b.callback_data?.split(':')[1]===action);assert.ok(button,'Missing '+action+' in '+panel.text);return send({chat,actor,data:button.callback_data,messageId:panel.id});};
 return {state,replies,posts,calls,panels,links,options,send,press,link,restart(){flow=createPrivateGroupAssistant(options);}};
}
test('group /ask shows only a deep link; the complete journey and results stay private until explicit share',async()=>{
 const f=fixture();await f.send({text:'/ask@TravellaBot'});
 assert.equal(f.replies.length,1);assert.match(f.replies[0].text,/личном чате/);assert.equal(f.calls.filter(c=>c.kind==='model').length,0);
 const start=f.link(-100);assert.match(start,/^pick_[a-f0-9]{48}$/);
 await f.send({chat:7,text:'/start '+start});assert.match(f.panels.get(7).text,/Найдём подходящий тур/);
 for(const action of ['ui_tour','ui_dest_vietnam','ui_origin_tashkent','ui_date_any','ui_guests_2','ui_budget_any','ui_search'])await f.press(action);
 assert.equal(f.posts.length,0);assert.equal(f.replies.filter(c=>c.chat<0).length,1);
 assert.match(f.panels.get(7).text,/900 USD/);assert.ok(f.panels.get(7).extra.reply_markup.inline_keyboard.flat().some(b=>b.text==='📤 Поделиться в группе'));
 const shareButton=f.panels.get(7).extra.reply_markup.inline_keyboard.flat().find(b=>b.callback_data?.includes(':share:')).callback_data;
 await f.press('share');assert.equal(f.posts.length,1);assert.equal(f.posts[0].chat,-100);assert.match(f.posts[0].text,/900 USD/);
 assert.ok(!f.posts[0].extra.reply_markup.inline_keyboard.flat().some(b=>b.callback_data));
 await f.send({chat:7,data:shareButton});assert.equal(f.posts.length,1);
 assert.ok(f.calls.filter(c=>c.kind==='quota').every(c=>c.id===-100));
});
test('a group text request is carried privately only for its author, including after a restart',async()=>{
 const f=fixture();await f.send({text:'/ask@TravellaBot Вьетнам на двоих'});
 const start=f.link(-100);assert.ok(!start.includes('Вьетнам'));assert.ok(!f.replies[0].text.includes('Вьетнам'));
 f.restart();await f.send({chat:8,actor:8,text:'/start '+start});assert.match(f.replies.at(-1).text,/предназначена автору/);assert.equal(f.calls.filter(c=>c.kind==='model').length,0);
 await f.send({chat:7,text:'/start '+start});assert.equal(f.calls.find(c=>c.kind==='model').text,'Вьетнам на двоих');assert.match(f.panels.get(7).text,/Правильно понял/);
 await f.press('search');assert.match(f.panels.get(7).text,/900 USD/);assert.equal(f.posts.length,0);assert.equal(f.replies.filter(c=>c.chat<0).length,1);
});
test('automatic detection leaves one group link and carries same-author refinements into the private conversation',async()=>{
 const f=fixture();await f.send({text:'У кого есть отказной на двоих на завтра?'});const start=f.link(-100);
 await f.send({text:'Бюджет 1000$ на двоих'});await f.send({text:'Кроме арабских стран'});await f.send({text:'куда',actor:8});
 assert.equal(f.replies.filter(c=>c.chat<0).length,1);assert.equal(f.calls.filter(c=>c.kind==='model').length,0);
 await f.send({chat:7,text:'/start '+start});const question=f.calls.find(c=>c.kind==='model').text;
 assert.match(question,/на завтра/);assert.match(question,/1000\$/);assert.match(question,/Кроме арабских/);assert.ok(!question.includes('куда'));
 assert.equal(f.replies.filter(c=>c.chat<0).length,1);
});
test('sharing rechecks current public offers and never posts withdrawn results',async()=>{
 const f=fixture();await f.send({text:'/ask@TravellaBot Вьетнам'});await f.send({chat:7,text:'/start '+f.link(-100)});await f.press('search');
 f.state.offers=[];await f.press('share');assert.equal(f.posts.length,0);assert.match(f.replies.at(-1).text,/Ничего не опубликовано/);
});
test('handoff and sharing require membership, old group callbacks cannot run a public search',async()=>{
 const f=fixture();await f.send({text:'/ask@TravellaBot'});const start=f.link(-100);
 f.state.member=false;await f.send({chat:7,text:'/start '+start});assert.match(f.replies.at(-1).text,/Ссылка недоступна/);
 f.state.member=true;await f.send({chat:7,text:'/start '+start});
 await f.send({data:'grp_ai:search:old'});assert.equal(f.calls.filter(c=>c.kind==='search').length,0);assert.match(f.panels.get(-100).text,/личном чате/);
 assert.equal((await f.send({chat:7,text:'🧳 Мои услуги'})).passed,true);
 assert.equal((await f.send({chat:7,text:'/start'})).passed,true);
});
test('sharing stays bound to the source forum topic and ignores callbacks from other private users',async()=>{
 const f=fixture();await f.send({text:'/ask@TravellaBot Вьетнам',chat:-200,topic:123});await f.send({chat:7,text:'/start '+f.link(-200)});await f.press('search');
 const data=f.panels.get(7).extra.reply_markup.inline_keyboard.flat().find(b=>b.callback_data?.includes(':share:')).callback_data;
 await f.send({chat:8,actor:8,data,messageId:f.panels.get(7).id});assert.equal(f.posts.length,0);
 await f.press('share');assert.equal(f.posts.length,1);assert.equal(f.posts[0].chat,-200);assert.equal(f.posts[0].extra.message_thread_id,123);
});
test('database handoffs hash opaque tokens and bind reads and updates to the owner and expiry',async()=>{
 const queries=[];const handoffs=createGroupAssistantHandoffs({query:async(sql,args)=>{queries.push({sql,args});return {rows:[]};}});
 const token=await handoffs.create({ownerId:7,groupId:-100,question:'Вьетнам, телефон +998901234567'});
 assert.match(token,/^[a-f0-9]{48}$/);const insert=queries.find(q=>q.sql.includes('INSERT INTO telegram_assistant_handoffs'));
 assert.notEqual(insert.args[0],token);assert.equal(insert.args[0].length,64);assert.ok(!insert.args[5].includes('998901234567'));
 await handoffs.get(token,8);const read=queries.at(-1);assert.match(read.sql,/owner_id IS NULL OR owner_id=\$2/);assert.match(read.sql,/expires_at>NOW/);assert.equal(read.args[1],8);
});

test('an older AI response cannot overwrite a newer private session from another group',async()=>{
 const f=fixture();let resolve,started;
 const entered=new Promise(done=>{started=done;});
 f.options.model.interpret=async()=>{started();return new Promise(done=>{resolve=done;});};
 await f.send({text:'/ask@TravellaBot Вьетнам',chat:-100});
 const old=f.send({chat:7,text:'/start '+f.link(-100)});await entered;
 await f.send({text:'/ask@TravellaBot',chat:-200});await f.send({chat:7,text:'/start '+f.link(-200)});
 resolve(output);await old;assert.match(f.panels.get(7).text,/Найдём подходящий тур/);
 for(const action of ['ui_tour','ui_dest_vietnam','ui_origin_tashkent','ui_date_any','ui_guests_2','ui_budget_any','ui_search'])await f.press(action);
 await f.press('share');assert.equal(f.posts.length,1);assert.equal(f.posts[0].chat,-200);
});
test('sharing does not bypass a member mute or a read-only group and concurrent clicks post once',async()=>{
 const f=fixture();await f.send({text:'/ask@TravellaBot Вьетнам'});await f.send({chat:7,text:'/start '+f.link(-100)});await f.press('search');
 f.state.memberRole='restricted';f.state.canSend=false;await f.press('share');assert.equal(f.posts.length,0);
 f.state.memberRole='member';f.state.groupCanSend=false;await f.press('share');assert.equal(f.posts.length,0);
 f.state.groupCanSend=true;
 const data=f.panels.get(7).extra.reply_markup.inline_keyboard.flat().find(b=>b.callback_data?.includes(':share:')).callback_data;
 await Promise.all([f.send({chat:7,data}),f.send({chat:7,data})]);assert.equal(f.posts.length,1);
});

test('empty private results have no share button and an old share callback cannot publish',async()=>{
 const f=fixture();await f.send({text:'/ask@TravellaBot Вьетнам'});await f.send({chat:7,text:'/start '+f.link(-100)});await f.press('search');
 const old=f.panels.get(7);const share=old.extra.reply_markup.inline_keyboard.flat().find(b=>b.callback_data?.includes(':share:')).callback_data;
 await f.press('ui_edit');await f.press('ui_edit_destination');await f.press('ui_dest_turkey');
 f.state.offers=[];await f.press('ui_search');
 const panel=f.panels.get(7);assert.ok(!panel.extra.reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.includes(':share:')));
 await f.send({chat:7,data:share,messageId:old.id});
 assert.equal(f.posts.length,0);assert.equal(f.replies.filter(r=>r.chat<0).length,1);
});

test('editing and starting a new private search never publish or revive a previously shared result',async()=>{
 const f=fixture();await f.send({text:'/ask@TravellaBot Вьетнам'});await f.send({chat:7,text:'/start '+f.link(-100)});await f.press('search');
 const original=f.panels.get(7);const oldShare=original.extra.reply_markup.inline_keyboard.flat().find(b=>b.callback_data?.includes(':share:')).callback_data;
 await f.press('share');await f.send({chat:7,data:oldShare,messageId:original.id});assert.equal(f.posts.length,1);
 await f.press('ui_edit');await f.press('ui_edit_destination');await f.press('ui_dest_turkey');await f.press('ui_search');
 assert.ok(f.calls.filter(c=>c.kind==='search').at(-1).filters.destination.includes('Турция'));
 await f.send({chat:7,data:oldShare,messageId:original.id});assert.equal(f.posts.length,1);
 await f.press('ui_home');
 for(const action of ['ui_tour','ui_dest_vietnam','ui_origin_tashkent','ui_date_any','ui_guests_2','ui_budget_any','ui_search'])await f.press(action);
 assert.ok(f.calls.filter(c=>c.kind==='search').at(-1).filters.destination.includes('Вьетнам'));
 assert.equal(f.posts.length,1);assert.equal(f.replies.filter(r=>r.chat<0).length,1);
});

test('Russian bot name opens an author-bound private handoff without publishing the request',async()=>{
 for(const name of ['ОТКАЗБОТ, ', 'отказбот ', 'Отказбот: ', 'ОТКАЗБОТ — ']){
  const f=fixture();await f.send({text:name+'найди мне на Фукуок на ближайшие даты'});
  assert.equal(f.replies.length,1);assert.equal(f.posts.length,0);assert.equal(f.calls.filter(c=>c.kind==='model').length,0);
  const start=f.link(-100);await f.send({chat:8,actor:8,text:'/start '+start});assert.equal(f.calls.filter(c=>c.kind==='model').length,0);
  await f.send({chat:7,text:'/start '+start});assert.equal(f.calls.find(c=>c.kind==='model').text,'найди мне на Фукуок на ближайшие даты');
  assert.equal(f.replies.filter(r=>r.chat<0).length,1);assert.equal(f.posts.length,0);
 }
});

test('bot name matches only a direct address, not a word fragment or discussion about the bot',()=>{
 const {addressed}=require('../telegram/handlers/groupAssistantFlow');
 for(const text of ['ОТКАЗБОТик найди тур','Про ОТКАЗБОТ говорят','не ОТКАЗБОТ, а другой бот'])assert.equal(addressed({message:{text},botInfo:{id:99,username:'TravellaBot'}}),false);
});

async function startPaged(f){f.state.offers=Array.from({length:12},(_,i)=>({id:i+1,title:'TEST OFFER '+(i+1),category:'refused_tour',origin:'Ташкент',destination:'Вьетнам',hotel:'TEST HOTEL '+(i+1),food:'BB',roomCategory:'Deluxe',accommodation:'DBL',start:'2099-12-01',end:'2099-12-10',price:900+i,currency:'USD',priceBasis:'person'}));await f.send({text:'/ask@TravellaBot'});await f.send({chat:7,text:'/start '+f.link(-100)});for(const action of ['ui_tour','ui_dest_vietnam','ui_origin_tashkent','ui_date_any','ui_guests_2','ui_budget_any','ui_search'])await f.press(action);}
test('private results show five per page, details, two-item last page and no automatic group posts',async()=>{const f=fixture();await startPaged(f);assert.match(f.panels.get(7).text,/Страница 1\/3/);let buttons=f.panels.get(7).extra.reply_markup.inline_keyboard.flat();assert.equal(buttons.filter(b=>b.callback_data?.includes(':offer_')).length,5);assert.doesNotMatch(f.panels.get(7).text,/TEST OFFER 6/);const old=buttons.find(b=>b.callback_data?.includes(':page_1:')).callback_data;await f.press('page_1');assert.match(f.panels.get(7).text,/Страница 2\/3/);assert.match(f.panels.get(7).text,/TEST OFFER 6/);await f.send({chat:7,data:old});assert.match(f.panels.get(7).text,/Страница 2\/3/);await f.press('offer_7');assert.match(f.panels.get(7).text,/TEST HOTEL 7/);assert.match(f.panels.get(7).text,/Питание: BB/);assert.ok(f.panels.get(7).extra.reply_markup.inline_keyboard.flat().some(b=>b.url?.endsWith('opened=7')));await f.press('results');assert.match(f.panels.get(7).text,/Страница 2\/3/);await f.press('page_2');assert.match(f.panels.get(7).text,/Страница 3\/3/);assert.equal(f.panels.get(7).extra.reply_markup.inline_keyboard.flat().filter(b=>b.callback_data?.includes(':offer_')).length,2);assert.equal(f.posts.length,0);});
test('sharing publishes only the viewed page or selected detail and cannot duplicate after navigating back',async()=>{const f=fixture();await startPaged(f);await f.press('page_1');await f.press('share');assert.equal(f.posts.length,1);assert.match(f.posts[0].text,/TEST OFFER 6/);assert.match(f.posts[0].text,/TEST OFFER 10/);assert.doesNotMatch(f.posts[0].text,/TEST OFFER 11/);await f.press('offer_7');await f.press('share');assert.equal(f.posts.length,2);assert.match(f.posts[1].text,/TEST OFFER 7/);assert.doesNotMatch(f.posts[1].text,/TEST OFFER 6/);await f.press('results');await f.press('offer_7');await f.press('share');assert.equal(f.posts.length,2);await f.press('results');await f.press('share');assert.equal(f.posts.length,2);});
test('withdrawn and arbitrary offers are not exposed through result callbacks and empty pages have no share',async()=>{const f=fixture();await startPaged(f);const panel=f.panels.get(7),token=panel.extra.reply_markup.inline_keyboard.flat().find(b=>b.callback_data?.includes(':offer_')).callback_data.split(':')[2];await f.send({chat:7,data:'grp_ai:offer_999:'+token,messageId:panel.id});assert.equal(f.panels.get(7),panel);f.state.offers=f.state.offers.filter(o=>o.id!==1);await f.press('offer_1');assert.ok(f.replies.some(r=>r.text.includes('больше недоступно')));assert.doesNotMatch(f.panels.get(7).text,/TEST OFFER 1\n/);f.state.offers=[];await f.press('page_1');assert.match(f.panels.get(7).text,/не нашёл/);assert.ok(!f.panels.get(7).extra.reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.includes(':share:')));assert.equal(f.posts.length,0);});

test('closing a private search releases ordinary private input instead of intercepting draft values',async()=>{const f=fixture();await startPaged(f);await f.press('ui_close');const modelCalls=f.calls.filter(c=>c.kind==='model').length;const result=await f.send({chat:7,text:'1000'});assert.equal(result.passed,true);assert.equal(f.calls.filter(c=>c.kind==='model').length,modelCalls);assert.equal(f.posts.length,0);});

test('private results include accessible contacts and card links; contact actions preserve pagination',async()=>{
 const resolved=[],opened=[];const f=fixture({resolveOfferContacts:async(_ctx,id)=>{resolved.push(id);return {name:'TEST supplier '+id,telegram:'test_supplier_'+id,phone:'+998900000000'};},onContacts:async(ctx,id)=>{opened.push(id);return ctx.reply('TEST CONTACT '+id);}});
 await startPaged(f);const text=f.panels.get(7).text;assert.match(text,/https:\/\/travella.uz\/marketplace\?opened=1/);assert.ok(f.panels.get(7).extra.entities.some(e=>e.url==='https://t.me/test_supplier_1'));assert.match(text,/998900000000/);assert.ok(!resolved.includes(6));assert.equal(f.panels.get(7).extra.reply_markup.inline_keyboard.flat().filter(b=>b.callback_data?.includes(':contacts_')).length,0);
 await f.press('offer_1');await f.press('contacts_1');await f.press('results');assert.deepEqual(opened,[1]);await f.press('page_1');assert.ok(f.panels.get(7).extra.entities.some(e=>e.url==='https://t.me/test_supplier_6'));assert.match(f.panels.get(7).text,/opened=6/);await f.press('offer_7');assert.ok(f.panels.get(7).extra.entities.some(e=>e.url==='https://t.me/test_supplier_7'));assert.match(f.panels.get(7).text,/opened=7/);assert.equal(f.posts.length,0);
 const panel=f.panels.get(7),button=panel.extra.reply_markup.inline_keyboard.flat().find(b=>b.callback_data?.includes(':contacts_'));await f.send({chat:7,actor:8,data:button.callback_data,messageId:panel.id});assert.deepEqual(opened,[1]);
});
test('private contacts never enter group sharing and failed contact lookups do not remove offers',async()=>{
 const f=fixture({resolveOfferContacts:async(_ctx,id)=>{if(id===2)throw Error('unavailable');return {name:'PRIVATE_NAME',telegram:'private_supplier',phone:'+998900000000'};}});await startPaged(f);assert.match(f.panels.get(7).text,/PRIVATE_NAME/);assert.match(f.panels.get(7).text,/TEST OFFER 2/);await f.press('share');assert.equal(f.posts.length,1);assert.doesNotMatch(f.posts[0].text,/PRIVATE_NAME|private_supplier|998900000000/);assert.ok(!f.posts[0].extra.reply_markup.inline_keyboard.flat().some(b=>b.callback_data?.includes('contacts')));
});
