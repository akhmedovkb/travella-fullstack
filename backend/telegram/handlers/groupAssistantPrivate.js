const { createGroupAssistantFlow, addressed, stripAssistantName, formatOffers, offerButtons } = require('./groupAssistantFlow');
const { createGroupAssistantStore } = require('../../ai/groupAssistantStore');
const { createGroupAssistantHandoffs } = require('../../ai/groupAssistantHandoffs');
const { searchGroupOffers } = require('../../ai/groupAssistantSearch');
const {createGroupAssistantModel}=require('../../ai/groupAssistantModel');
const { randomBytes } = require('node:crypto');

function createPrivateGroupAssistant({ pool, env=process.env, store=createGroupAssistantStore(pool), handoffs=createGroupAssistantHandoffs(pool), search=filters=>searchGroupOffers(pool,filters), now=Date.now, groupPreview=true, ...options }={}) {
  const origins=new Map(),previewBusy=new Set();
  const previewModel=options.model||createGroupAssistantModel({env});
  const groupId=id=>Number(id)>0 ? origins.get(String(id))?.origin?.groupId : id;
  const scopedStore={
    initialize:()=>store.initialize?.(), enabled:id=>groupId(id) ? store.enabled(groupId(id)) : false,
    reserve:id=>groupId(id) ? store.reserve(groupId(id)) : false,
    autoEnabled:id=>Number(id)<0 ? store.autoEnabled?.(id) : false,
    activate:(...args)=>store.activate(...args),setAuto:(...args)=>store.setAuto(...args),
  };
  const username=ctx=>ctx.botInfo?.username || env.TELEGRAM_CLIENT_BOT_USERNAME || 'OTKAZNYX_TUROV_UZB_BOT';
  const topic=ctx=>{const message=ctx.message||ctx.callbackQuery?.message;return message?.is_topic_message ? message.message_thread_id : null;};
  async function entryLink(ctx,question='',edit=false,reason='') {
    const token=await handoffs.create({ownerId:question ? ctx.from.id : null,groupId:ctx.chat.id,topicId:topic(ctx),title:ctx.chat.title,question});
    const text=reason||'🔎 Подбор — в личном чате\n\nВыберите условия и получите предложения в боте. Поделиться результатами с группой можно отдельной кнопкой.';
    const extra={reply_markup:{inline_keyboard:[[{text:'🔎 Подобрать в личном чате',url:`https://t.me/${username(ctx)}?start=pick_${token}`}]]}};
    if(edit&&ctx.editMessageText)return ctx.editMessageText(text,extra).catch(()=>{});
    return ctx.reply(text,{...extra,...(topic(ctx)?{message_thread_id:topic(ctx)}:{})});
  }
  async function preview(ctx,question){
    const key=String(ctx.chat.id)+':'+ctx.from.id;
    if(previewBusy.has(key))return entryLink(ctx,question,false,'⏳ Предыдущий поиск ещё выполняется.\n\nЭтот запрос можно продолжить в личном чате.');
    previewBusy.add(key);
    try{
      if(!previewModel.ready())return await entryLink(ctx,question,false,'⏳ Поиск временно недоступен. Попробуйте позже в личном чате.');
      if(!await store.reserve(ctx.chat.id))return await entryLink(ctx,question,false,'⏳ Лимит поиска в группе на сегодня исчерпан. Попробуйте завтра.');
      const intent=await previewModel.interpret(question);
      if(intent.kind!=='search'||(!intent.filters?.destination?.length&&!intent.filters?.anyDestination))return await entryLink(ctx,question,false,'✏️ Нужно уточнить условия поиска.\n\nПродолжите в личном чате — запрос уже перенесён.');
      const offers=await search(intent.filters);
      if(!await store.enabled(ctx.chat.id))return;
      const token=await handoffs.create({ownerId:ctx.from.id,groupId:ctx.chat.id,topicId:topic(ctx),title:ctx.chat.title,question});
      const url=`https://t.me/${username(ctx)}?start=pick_${token}`;
      const count=offers.length,language=intent.language||'ru';
      const heading={ru:`🔎 Найдено вариантов: ${count}${count>3?' · показываю 3':''}`,uz:`🔎 Topildi: ${count}${count>3?' · 3 ta variant':''}`,en:`🔎 Found: ${count}${count>3?' · showing 3':''}`}[language];
      const text=count?heading+'\n\n'+formatOffers(offers.slice(0,3),language).split('\n\n').slice(1).join('\n\n')+'\n\n'+({ru:'👇 Продолжите подбор или измените условия в личном чате.',uz:'👇 Shaxsiy chatda davom eting yoki shartlarni o‘zgartiring.',en:'👇 Continue or change your search in private.'}[language]):({ru:'🔎 Подходящих вариантов сейчас нет.\n\nИзмените даты или направление в личном чате.',uz:'🔎 Mos variantlar topilmadi. Shaxsiy chatda shartlarni o‘zgartiring.',en:'🔎 No matching offers. Change your search in private.'}[language]);
      const rows=offers.slice(0,3).map((offer,i)=>[{text:'🌐 '+(i+1)+'. '+({ru:'Открыть карточку',uz:'Taklifni ochish',en:'Open offer'}[language]),url:`https://travella.uz/marketplace?opened=${Number(offer.id)}`}]);
      rows.push([{text:count?({ru:`📋 Все варианты (${count}) →`,uz:`📋 Barcha variantlar (${count}) →`,en:`📋 All offers (${count}) →`}[language]):'✏️ Изменить условия в личке',url}]);
      return await ctx.reply(text,{disable_web_page_preview:true,reply_markup:{inline_keyboard:rows},...(topic(ctx)?{message_thread_id:topic(ctx)}:{})});
    }catch{return await entryLink(ctx,question,false,'⚠️ Не удалось выполнить поиск.\n\nПовторите запрос или продолжите в личном чате.');}finally{previewBusy.delete(key);}
  }
  async function member(ctx,origin,publish=false) {
    const value=await ctx.telegram.getChatMember(origin.groupId,ctx.from.id);
    if(['creator','administrator'].includes(value?.status))return true;
    if(value?.status==='restricted')return value.is_member===true&&(!publish||value.can_send_messages===true);
    if(value?.status!=='member')return false;
    if(publish&&ctx.telegram.getChat){const chat=await ctx.telegram.getChat(origin.groupId);if(chat.permissions?.can_send_messages===false)return false;}
    return true;
  }
  async function share(ctx,state) {
    const origin=state.origin;
    if(!origin || !state.results?.ids?.length)throw new Error('NO_SHARE_RESULTS');
    if(!await store.enabled(origin.groupId)||!await member(ctx,origin,true))return {sent:false,text:'Не удалось подтвердить доступ к исходной группе. Ничего не опубликовано.'};
    const latest=(await search(state.results.filters)).filter(offer=>state.results.ids.includes(offer.id)).slice(0,5);
    if(!latest.length)return {sent:false,text:'Эти предложения уже не соответствуют поиску. Ничего не опубликовано — обновите подбор.'};
    const token=await handoffs.create({groupId:origin.groupId,topicId:origin.topicId,title:origin.title});
    const extra=offerButtons(latest,state.results.language);
    extra.reply_markup=extra.reply_markup||{inline_keyboard:[]};
    extra.reply_markup.inline_keyboard.push([{text:'🔎 Подобрать для себя',url:`https://t.me/${username(ctx)}?start=pick_${token}`}]);
    const message=await ctx.telegram.sendMessage(origin.groupId,formatOffers(latest,state.results.language),{
      ...extra,disable_web_page_preview:true,...(origin.topicId?{message_thread_id:origin.topicId}:{}),
    });
    if(!message?.message_id)throw new Error('SHARE_DELIVERY_UNCONFIRMED');
    return {sent:true,text:'✅ Подбор опубликован в исходной группе.'};
  }
  const core=createGroupAssistantFlow({pool,env,...options,now,store:scopedStore,search,handoffs,onShare:share});
  const menu=/^(главное меню|мои услуги|мой профиль|профиль|корзина|бронирования|заявки|мои отзывы|обучение|поддержка|настройки|найти услугу)$/;
  const middleware=async(ctx,next)=>{
    const type=ctx.chat?.type;
    if(['group','supergroup'].includes(type)){
      if(!ctx.from||ctx.from.is_bot||ctx.message?.sender_chat)return;
      const data=String(ctx.callbackQuery?.data||'');
      if(ctx.callbackQuery){
        await ctx.answerCbQuery('Подбор теперь в личном чате с ботом.').catch(()=>{});
        if(data.startsWith('grp_ai:')&&await store.enabled(ctx.chat.id))return entryLink(ctx,'',true);
        return;
      }
      const command=String(ctx.message?.text||'').match(/^\/(travella_on|travella_off|travella_auto_on|travella_auto_off)(?:@[a-z0-9_]+)?(?:\s|$)/i);
      if(command&&addressed(ctx))return core(ctx,next);
      if(addressed(ctx)){
        if(!await store.enabled(ctx.chat.id))return ctx.reply('Помощник выключен. Администратор может включить его командой /travella_on.');
        const text=stripAssistantName(ctx.message?.text).replace(/^\/(ask|travella_help)(?:@[a-z0-9_]+)?\s*/i,'').replace(new RegExp(`@${username(ctx)}\\b`,'gi'),'').trim();
        return groupPreview&&text?preview(ctx,text):entryLink(ctx,text);
      }
      return core(ctx,next); // Only local auto detection; invitations are deep links.
    }
    if(type!=='private'||String(ctx.chat.id)!==String(ctx.from?.id))return next();
    const id=String(ctx.from.id),text=String(ctx.message?.text||''),data=String(ctx.callbackQuery?.data||'');
    for(const [key,value] of origins)if(value.expires<=now())origins.delete(key);
    const pick=text.match(/^\/start(?:@[a-z0-9_]+)?\s+pick_([a-f0-9]{48})\s*$/i);
    if(pick){
      try{
        const origin=await handoffs.get(pick[1],ctx.from.id);
        if(!origin||!await store.enabled(origin.groupId)||!await member(ctx,origin))return ctx.reply('Ссылка недоступна или предназначена автору запроса. Откройте новую кнопку подбора в группе.');
        if(origins.size>=1000&&!origins.has(id))return ctx.reply('Сейчас много запросов. Попробуйте позже.');
        const entry={origin,expires:now()+15*60000,revision:randomBytes(6).toString('hex')};origins.set(id,entry);
        ctx.__travellaAssistantPrivate={origin,isCurrent:()=>origins.get(id)===entry,onClose:()=>{if(origins.get(id)===entry)origins.delete(id);}};
        return await core.openPrivate(ctx,origin.question||'');
      }catch{return ctx.reply('Не удалось открыть подбор. Попробуйте ещё раз кнопкой из группы.');}
    }
    const normalized=text.replace(/[^\p{L}\p{N}\s]/gu,'').trim().toLowerCase();
    if((/^\/(?!ask(?:\s|@|$)|travella_help(?:\s|@|$))/.test(text))||menu.test(normalized)||(data&&!data.startsWith('grp_ai:'))||(!ctx.message?.text&&!data)){
      origins.delete(id);return next();
    }
    const entry=origins.get(id);
    if(!entry){
      if(data.startsWith('grp_ai:'))return ctx.answerCbQuery('Откройте подбор кнопкой из группы заново.').catch(()=>{});
      if(/^\/ask(?:\s|@|$)/i.test(text))return ctx.reply('Начните подбор кнопкой в группе — все дальнейшие шаги и результаты будут здесь.');
      return next();
    }
    entry.expires=now()+15*60000;
    ctx.__travellaAssistantPrivate={origin:entry.origin,isCurrent:()=>origins.get(id)===entry,onClose:()=>{if(origins.get(id)===entry)origins.delete(id);}};
    return core(ctx,next);
  };
  middleware.initialize=async()=>{await handoffs.initialize?.();await core.initialize();};
  return middleware;
}
module.exports={createPrivateGroupAssistant};
