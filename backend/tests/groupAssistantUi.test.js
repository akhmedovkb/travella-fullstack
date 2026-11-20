const test = require('node:test');
const assert = require('node:assert/strict');
const { startSearchUi, uiAction, renderSearchUi, uiIntent, uiText, dateChoice } = require('../ai/groupAssistantUi');
const { createGroupAssistantFlow } = require('../telegram/handlers/groupAssistantFlow');
const NOW = Date.parse('2026-11-20T12:00:00Z');
function fixture({ interpreted } = {}) {
  const calls=[], messages=[], edits=[], answers=[];
  let panel, messageId=100, time=NOW;
  function record(id,text,options){const item={id,text,options};if(options?.reply_markup?.inline_keyboard)panel=item;return {message_id:id};}
  const telegram={editMessageText:async(_chat,id,_inline,text,options)=>{edits.push({id,text,options});return record(id,text,options);},editMessageReplyMarkup:async()=>{}};
  const flow=createGroupAssistantFlow({pool:{},now:()=>time,
    model:{ready:()=>true,interpret:async(text,previous)=>{calls.push({kind:'model',text,previous});return interpreted;}},
    store:{enabled:async()=>true,reserve:async()=>{calls.push({kind:'reserve'});return true;}},
    search:async filters=>{calls.push({kind:'search',filters});return [{id:42,title:'Отказной тур',category:'refused_tour',origin:'Ташкент',destination:'Дубай',start:'2026-11-21',end:'2026-11-22',price:900,currency:'USD',priceBasis:'total',guests:2}];},
  });
  function ctx({text,data,actor=7,id}={}){const value={chat:{id:-100,type:'supergroup'},from:{id:actor},botInfo:{id:99,username:'TravellaBot'},telegram,
    message:data?undefined:{text,message_id:10,reply_to_message:{from:{id:99}}},callbackQuery:data?{data,message:{message_id:id||panel.id}}:undefined,
    answerCbQuery:async text=>answers.push(text),sendChatAction:async action=>calls.push({kind:'effect',action}),
    reply:async(text,options)=>{messages.push({text,options});return record(++messageId,text,options);},
    editMessageText:async(text,options)=>telegram.editMessageText(-100,id||panel.id,undefined,text,options),editMessageReplyMarkup:async()=>{},
  };return value;}
  const dispatch=async input=>flow(ctx(input),()=>assert.fail('group must not reach personal flows'));
  return {calls,messages,edits,answers,dispatch,get panel(){return panel;},setTime(value){time=value;},
    async press(action,actor=7){const button=panel.options.reply_markup.inline_keyboard.flat().find(b=>b.callback_data?.split(':')[1]===action);assert.ok(button,'Missing button '+action+' in '+panel.text);const data=button.callback_data;await dispatch({data,actor});return data;},
  };
}
test('button journey edits one panel, preserves selections and searches only after review without model spend',async()=>{
  const f=fixture();await f.dispatch({text:'/ask@TravellaBot'});
  assert.match(f.panel.text,/Найдём подходящий тур/);assert.equal(f.panel.options.reply_markup.inline_keyboard.length,3);
  const initialId=f.panel.id;
  for(const action of ['ui_tour','ui_dest_turkey','ui_origin_tashkent','ui_date_weekend','ui_guests_2','ui_budget_1000','ui_basis_total'])await f.press(action);
  assert.match(f.panel.text,/Проверьте условия/);assert.match(f.panel.text,/2 взрослых/);assert.match(f.panel.text,/1000 USD на всех/);
  assert.equal(f.calls.filter(c=>c.kind==='search').length,0);
  await f.press('ui_edit');await f.press('ui_edit_destination');await f.press('ui_dest_uae');
  assert.match(f.panel.text,/ОАЭ/);assert.match(f.panel.text,/Ташкент/);assert.match(f.panel.text,/1000 USD на всех/);
  const oldButton=await f.press('ui_search');
  assert.equal(f.calls.filter(c=>c.kind==='model').length,0);assert.equal(f.calls.filter(c=>c.kind==='reserve').length,0);
  const search=f.calls.find(c=>c.kind==='search');assert.equal(search.filters.guests,2);assert.equal(search.filters.priceBasis,'total');assert.equal(search.filters.start,'2026-11-21');assert.equal(search.filters.end,'2026-11-22');assert.ok(search.filters.destination.includes('UAE'));
  assert.equal(f.messages.length,1);assert.ok(f.edits.every(e=>e.id===initialId));assert.ok(f.edits.some(e=>/Ищу подходящие/.test(e.text)));
  assert.match(f.panel.text,/900 USD/);assert.ok(f.panel.options.reply_markup.inline_keyboard.flat().some(b=>b.url?.endsWith('opened=42')));
  await f.dispatch({data:oldButton});assert.equal(f.calls.filter(c=>c.kind==='search').length,1);
  await f.press('ui_home');assert.match(f.panel.text,/Найдём подходящий тур/);
});
test('companion and hotel paths show relevant steps and allow unrestricted dates and budget',()=>{
  const ui=startSearchUi(10);uiAction(ui,'ui_companion',NOW);assert.equal(ui.step,'gender');
  for(const action of ['ui_gender_female','ui_dest_any','ui_origin_any','ui_date_any','ui_guests_any','ui_budget_any'])uiAction(ui,action,NOW);
  assert.equal(ui.step,'review');assert.ok(uiIntent(ui).filters.companion);assert.equal(uiIntent(ui).filters.gender,'female');assert.ok(uiIntent(ui).filters.anyDestination);
  uiAction(ui,'ui_home',NOW);uiAction(ui,'ui_hotel',NOW);uiAction(ui,'ui_dest_vietnam',NOW);assert.equal(ui.step,'dates');
  assert.ok(renderSearchUi(ui,NOW).rows.flat().some(b=>b.action==='ui_date_month'));
});
test('date shortcuts use Tashkent dates across month and year boundaries',()=>{
  assert.deepEqual(dateChoice('tomorrow',Date.parse('2026-12-31T12:00:00Z')),['2027-01-01','2027-01-01']);
  assert.deepEqual(dateChoice('month',Date.parse('2026-12-20T12:00:00Z')),['2027-01-01','2027-01-31']);
  assert.deepEqual(dateChoice('tomorrow',Date.parse('2026-11-20T20:00:00Z')),['2026-11-22','2026-11-22']);
  assert.deepEqual(dateChoice('weekend',NOW),['2026-11-21','2026-11-22']);
});
test('custom numeric inputs use a selective reply prompt and preserve party and currency',async()=>{
  const f=fixture();await f.dispatch({text:'/ask@TravellaBot'});
  for(const action of ['ui_hotel','ui_dest_turkey','ui_date_any','ui_custom_guests'])await f.press(action);
  const prompt=f.messages.at(-1);assert.equal(prompt.options.reply_markup.force_reply,true);assert.equal(prompt.options.reply_markup.selective,true);assert.equal(prompt.options.reply_parameters.message_id,10);
  await f.dispatch({text:'0'});assert.match(f.panel.text,/число взрослых/);
  await f.dispatch({text:'3'});assert.match(f.panel.text,/Какой бюджет/);assert.match(f.panel.text,/Взрослых: 3/);
  await f.press('ui_custom_budget');await f.dispatch({text:'800 EUR'});assert.match(f.panel.text,/800 EUR/);
  await f.press('ui_basis_total');assert.match(f.panel.text,/3 взрослых/);assert.match(f.panel.text,/800 EUR на всех/);
  assert.equal(f.calls.filter(c=>c.kind==='model').length,0);
});
test('foreign users and expired UI callbacks cannot change another user’s selections',async()=>{
  const f=fixture();await f.dispatch({text:'/ask@TravellaBot'});const before=f.panel.text;
  await f.press('ui_tour',8);assert.equal(f.panel.text,before);assert.match(f.answers.at(-1),/автору/);
  const button=f.panel.options.reply_markup.inline_keyboard[0][0].callback_data;
  f.setTime(NOW+16*60000);await f.dispatch({data:button});assert.equal(f.calls.filter(c=>c.kind==='search').length,0);
});
test('custom date interpretation changes only dates, keeping existing direction and guests',async()=>{
  const f=fixture({interpreted:{kind:'search',language:'ru',filters:{start:'2027-01-10',end:'2027-01-15'}}});
  await f.dispatch({text:'/ask@TravellaBot'});for(const action of ['ui_tour','ui_dest_turkey','ui_origin_tashkent','ui_date_any','ui_guests_2','ui_budget_any','ui_edit','ui_edit_dates','ui_custom_dates'])await f.press(action);
  await f.dispatch({text:'10–15 января'});assert.match(f.panel.text,/10.01.2027/);assert.match(f.panel.text,/Турция/);assert.match(f.panel.text,/Ташкент/);assert.match(f.panel.text,/2 взрослых/);
  assert.equal(f.calls.filter(c=>c.kind==='model').length,1);
});

test('visual heading hierarchy escapes text instead of accepting supplier HTML',()=>{
  const {uiHtml}=require('../ai/groupAssistantUi');
  const html=uiHtml('Шаг 1 из 5\n\n🌍 Куда поехать?\n\n✓ A & B <unsafe>');
  assert.match(html,/<i>Шаг 1 из 5<\/i>/);
  assert.match(html,/<b>🌍 Куда поехать\?<\/b>/);
  assert.match(html,/A &amp; B &lt;unsafe&gt;/);
  assert.ok(!html.includes('<unsafe>'));
});
