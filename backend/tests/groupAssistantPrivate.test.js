const test=require('node:test');
const assert=require('node:assert/strict');
const {createPrivateGroupAssistant}=require('../telegram/handlers/groupAssistantPrivate');
const {normalizeIntent}=require('../ai/groupAssistantModel');
const {createGroupAssistantHandoffs}=require('../ai/groupAssistantHandoffs');
const output=normalizeIntent({kind:'search',language:'ru',filters:{destination:['Вьетнам'],origin:['Ташкент'],start:'2099-12-01',end:'2099-12-31',guests:2,budget:null,category:'refused_tour'}});
function fixture(){
 const replies=[],posts=[],calls=[],panels=new Map(),links=new Map();let sequence=0,tokenId=0;
 const state={offers:[{id:42,title:'Отказной тур',category:'refused_tour',origin:'Ташкент',destination:'Вьетнам',start:'2099-12-01',end:'2099-12-10',price:900,currency:'USD',priceBasis:'total',guests:2}],member:true};
 const handoffs={initialize:async()=>{},create:async value=>{const token=String(++tokenId).padStart(48,'0');links.set(token,{...value});return token;},update:async(token,ownerId,question)=>{if(links.get(token)?.ownerId===ownerId)links.get(token).question=question;},get:async(token,actor)=>{const value=links.get(token);return value&&(value.ownerId==null||value.ownerId===actor)?{groupId:value.groupId,topicId:value.topicId,title:value.title,question:value.question}:null;}};
 const store={initialize:async()=>{},enabled:async()=>true,autoEnabled:async()=>true,reserve:async id=>{calls.push({kind:'quota',id});return true;},activate:async()=>{},setAuto:async()=>{}};
 const options={pool:{},handoffs,store,model:{ready:()=>true,interpret:async(text,previous)=>{calls.push({kind:'model',text,previous});return output;}},search:async filters=>{calls.push({kind:'search',filters});return state.offers;}};
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
