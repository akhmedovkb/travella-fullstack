const {waitingInfo,correctionHistory}=require('../../utils/correctionTracking');
const {resolveProviderByTelegramActorId}=require('../../utils/providerTelegramResolver');
const {ensureServiceModerationEvents}=require('../../utils/serviceModerationEvents');
const {getCorrection,listCorrections,mutateCorrection}=require('../../utils/telegramCorrectionService');
const {submitProviderService}=require('../../utils/providerCorrections');
const {getAllowedProviderServiceCategories}=require('../../utils/providerServiceCatalog');
const {REFUSED_CATEGORIES}=require('../../utils/serviceCategories');
const categories=async(pool,pid)=>{const result=await pool.query('SELECT type FROM providers WHERE id=$1',[pid]);const type=result.rows[0]?.type;return [...new Set([...(type==='agent'?[...REFUSED_CATEGORIES,'author_tour']:type==='hotel'?['refused_hotel']:[]),...getAllowedProviderServiceCategories(type)])];};
const LABELS={NO_PROOF:'Добавить proof',BAD_PROOF:'Исправить proof',NO_DATES:'Проверить даты',BAD_PRICE:'Уточнить цену',HOTEL_DETAILS:'Уточнить отель',NO_PHOTO:'Добавить фото',MISSING_DETAILS:'Дополнить данные',WRONG_CATEGORY:'Исправить категорию',DUPLICATE:'Устранить дубль / объяснить отличие',OTHER:'Исправить замечание'};
const FIELDS={net:'Netto',gross:'Gross',dates:'Даты',hotel:'Отель',roomCategory:'Категория номера',accommodation:'Размещение',title:'Название',description:'Описание / пояснение',category:'Категория услуги',directionCountry:'Страна',directionFrom:'Вылет из',directionTo:'Направление',food:'Питание',flightDetails:'Детали рейса'};
const button=(text,data)=>({text,callback_data:data});
function keyboard(state){const id=state.service.id,t=state.token;return {inline_keyboard:[
 [button('💵 Netto',`corr:field:${id}:net:${t}`),button('💵 Gross',`corr:field:${id}:gross:${t}`)],
 [button('📅 Даты',`corr:field:${id}:dates:${t}`),button('🏨 Отель',`corr:field:${id}:hotel:${t}`)],
 [button('📎 Proof',`corr:media:${id}:proof:${t}`),button('🖼 Фото карточки',`corr:media:${id}:photos:${t}`)],
 [button('✏️ Другие поля',`corr:fields:${id}`)],
 ...state.correction.reasonCodes.map(code=>[button(`${state.checkedCodes.includes(code)?'✅':'⬜'} ${LABELS[code]||code}`,`corr:check:${id}:${code}:${state.checkedCodes.includes(code)?0:1}:${t}`)]),
 [button('📤 Отправить на повторную проверку',`corr:submit:${id}:${t}`)],
 [button('История возвратов',`corr:history:${id}`)],
 [button('🔄 Обновить',`corr:open:${id}`),button('⬅️ К списку','corr:list:0')],
 [button('Закрыть исправления','corr:exit')]
 ]};}
function chunks(text){const result=[];for(let i=0;i<text.length;){let end=Math.min(i+3800,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;result.push(text.slice(i,end));i=end;}return result;}
function createCorrectionFlow({pool,loadImage,notifyModerationNew,resolve=resolveProviderByTelegramActorId}){
 const running=new Map();
 const serial=(id,work)=>{const previous=running.get(id)||Promise.resolve();const next=previous.catch(()=>{}).then(work);running.set(id,next);return next.finally(()=>{if(running.get(id)===next)running.delete(id);});};
 const reply=async(ctx,text,kb)=>{const parts=chunks(text);for(let i=0;i<parts.length;i++)await ctx.reply(parts[i],{parse_mode:undefined,...(i===parts.length-1&&kb?{reply_markup:kb}:{})});};
 async function owned(ctx){if(ctx.chat?.type!=='private'||String(ctx.chat.id)!==String(ctx.from?.id))throw new Error('Откройте исправления в личном чате с ботом.');const p=await resolve(pool,ctx.from.id,{action:'telegram_corrections',ctxFromId:ctx.from.id,ctxChatId:ctx.chat.id,includeWebChatId:true});if(!p?.id)throw new Error('Привяжите Telegram к кабинету поставщика.');return p.id;}
 async function show(ctx,pid,id){const s=await getCorrection(pool,pid,id);ctx.session.correctionFlow={serviceId:id,mode:'none'};const d=s.service.details||{};const wait=waitingInfo({...s.service,correction_requested_at:s.correction.requestedAt});
  const summary=`↩️ Исправления услуги #${id}\n${String(s.service.title||'').slice(0,200)}\n\nNetto: ${d.netPrice??s.service.net_price??'—'} · Gross: ${d.grossPrice??s.service.price??'—'}\nДаты: ${d.startDate||d.eventDate||'—'} → ${d.endDate||'—'}\nОтель: ${d.hotel||'—'}\nProof: ${(d.proofImages||[]).length} · Фото: ${(s.service.images||[]).length}\n\n${wait.phase==='returned'?'Ждёт повторной проверки':'Ждём ваших исправлений'}: ${wait.days===null?'срок неизвестен':`${wait.days} дн.`}\n\nЗамечания модератора:\n${s.correction.reason}\n\n${s.correction.pending?'Услуга уже на модерации. Дождитесь решения.':`Исправляйте поля кнопками ниже. Каждая правка сразу сохраняется в эту услугу и сбрасывает отметки чеклиста.\nОтмечено: ${s.checkedCodes.length} из ${s.correction.reasonCodes.length}.`}`;
  await reply(ctx,summary,s.correction.pending?{inline_keyboard:[[button('История возвратов',`corr:history:${id}`)],[button('Вернулись на проверку','corr:returned:0')],[button('Ждём исправлений','corr:list:0')]]}:keyboard(s));return s;}
 async function list(ctx,pid,page,lane='waiting'){ctx.session.correctionFlow=null;const result=await listCorrections(pool,pid,page,lane);const prefix=lane==='returned'?'corr:returned':'corr:list';const rows=result.items.map(s=>{const wait=waitingInfo(s);return [button(`#${s.id} · ${String(s.title||s.category).slice(0,35)} · ${wait.days===null?'?':wait.days} дн.`,`corr:open:${s.id}`)];});if(page>0||result.more){const nav=[];if(page>0)nav.push(button('← Назад',`${prefix}:${page-1}`));if(result.more)nav.push(button('Далее →',`${prefix}:${page+1}`));rows.push(nav);}rows.push([button('Ждём исправлений','corr:list:0'),button('Вернулись на проверку','corr:returned:0')]);rows.push([button('⬅️ Мои услуги','prov_services:list')]);await reply(ctx,result.items.length?(lane==='returned'?'📨 Отправлены на повторную проверку:':'↩️ Ждём ваших исправлений:'):'В этом разделе услуг пока нет.',{inline_keyboard:rows});}
 async function handle(ctx){const pid=await owned(ctx);await ensureServiceModerationEvents(pool);const data=String(ctx.callbackQuery?.data||'');const start=String(ctx.message?.text||'').match(/^\/start(?:@\w+)? correction_(\d+)$/);
  if(start)return show(ctx,pid,Number(start[1]));
  if(!data){const flow=ctx.session.correctionFlow;if(!flow)return list(ctx,pid,0);
   if(flow.mode==='text'&&ctx.message?.text){await mutateCorrection(pool,{providerId:pid,serviceId:flow.serviceId,expectedToken:flow.token,action:'field',field:flow.field,value:ctx.message.text,updateId:ctx.update?.update_id});await reply(ctx,'✅ Изменение сохранено. Проверьте чеклист заново.');return show(ctx,pid,flow.serviceId);}
   if(flow.mode==='upload'){
    const photo=ctx.message?.photo?.at(-1),document=ctx.message?.document,file=photo||document;
    if(!file||document&&!/^image\/(jpeg|png|webp|gif)$/.test(document.mime_type||''))throw new Error('Отправьте фото или документ PNG/JPEG/WebP/GIF до 6 МБ. PDF пока не поддерживается.');
    if(Number(file.file_size||0)>6*1024*1024)throw new Error('Изображение должно быть не больше 6 МБ.');
    const before=await getCorrection(pool,pid,flow.serviceId);const image=await loadImage(file.file_id);if(!image)throw new Error('Не удалось обработать изображение. Попробуйте ещё раз.');
    await mutateCorrection(pool,{providerId:pid,serviceId:flow.serviceId,expectedToken:before.token,action:'add',field:flow.field,value:image,updateId:ctx.update?.update_id});await reply(ctx,'✅ Изображение сохранено. Можно отправить ещё или нажать «Готово».',{inline_keyboard:[[button('Готово',`corr:open:${flow.serviceId}`)]]});return;
   }
   return reply(ctx,'Выберите действие кнопками в карточке замечаний.',{inline_keyboard:[[button('Открыть замечания',`corr:open:${flow.serviceId}`)]]});
  }
  const parts=data.split(':'),action=parts[1],id=Number(parts[2]);
  if(action==='exit'){ctx.session.correctionFlow=null;return reply(ctx,'Исправления закрыты. Сохранённые правки остаются в услуге.',{inline_keyboard:[[button('Мои услуги','prov_services:list')]]});}
  if(action==='list'||action==='returned')return list(ctx,pid,Math.max(0,Number(parts[2])||0),action==='returned'?'returned':'waiting');
  if(!Number.isSafeInteger(id)||id<=0)throw new Error('Некорректная услуга.');
  if(action==='open')return show(ctx,pid,id);
  if(action==='history'){
   const ownedService=await pool.query(`SELECT * FROM services WHERE id=$1 AND provider_id=$2 AND deleted_at IS NULL`,[id,pid]);if(!ownedService.rows[0])throw new Error('Услуга не найдена.');const history=await correctionHistory(pool,ownedService.rows[0],parts[3],3);const labels={correction_resubmitted:'Отправлено повторно',correction_reviewed:'Проверено модератором',correction_reminded:'Напоминание отправлено',correction_reminder_requested:'Запрошено напоминание',correction_reminder_failed:'Доставка напоминания не подтверждена'};
   const text=history.items.map(item=>`Возврат от ${item.requestedAt?new Date(item.requestedAt).toLocaleString('ru-RU'):'дата неизвестна'}\n${String(item.reason||'').slice(0,500)}\n${item.events.map(e=>`${labels[e.action]||e.action}: ${new Date(e.at).toLocaleString('ru-RU')}`).join('\n')}${item.approvedAt?`\nОпубликовано: ${new Date(item.approvedAt).toLocaleString('ru-RU')}`:''}`).join('\n\n');const rows=[];if(history.nextCursor)rows.push([button('Более ранние возвраты',`corr:history:${id}:${history.nextCursor}`)]);rows.push([button('К списку','corr:list:0')]);return reply(ctx,text||'История возвратов пока пуста.',{inline_keyboard:rows});
  }
  const state=await getCorrection(pool,pid,id);
  if(state.correction.pending)throw new Error('Услуга уже отправлена на модерацию.');
  if(action==='fields'){const rows=Object.entries(FIELDS).map(([key,label])=>[button(label,`corr:field:${id}:${key}:${state.token}`)]);rows.push([button('К замечаниям',`corr:open:${id}`)]);return reply(ctx,'Какое поле исправить?',{inline_keyboard:rows});}
  if(action==='cat'){
   if(parts[4]!==state.token)throw new Error('Кнопка устарела.');const allowed=await categories(pool,pid);const category=allowed[Number(parts[3])];if(!category)throw new Error('Категория недоступна.');await mutateCorrection(pool,{providerId:pid,serviceId:id,expectedToken:state.token,updateId:ctx.update?.update_id,action:'field',field:'category',value:category});return show(ctx,pid,id);
  }
  if(action==='field'){
   if(parts[4]!==state.token||!FIELDS[parts[3]])throw new Error('Кнопка устарела. Обновите замечания.');
   if(parts[3]==='category'){const allowed=await categories(pool,pid);return reply(ctx,'Выберите категорию услуги. После изменения проверьте обязательные поля.',{inline_keyboard:[...allowed.map((category,index)=>[button(category.replaceAll('_',' '),`corr:cat:${id}:${index}:${state.token}`)]),[button('К замечаниям',`corr:open:${id}`)]]});}
   ctx.session.correctionFlow={serviceId:id,mode:'text',field:parts[3],token:state.token};
   const hint=parts[3]==='dates'?(['refused_ticket','refused_event_ticket'].includes(state.service.category)?'YYYY-MM-DD':'YYYY-MM-DD YYYY-MM-DD'):parts[3]==='category'?'код категории, например refused_tour, refused_hotel, refused_flight, refused_event_ticket':parts[3]==='net'||parts[3]==='gross'?'положительное число, например 4700,50':'текст';
   return reply(ctx,`✏️ ${FIELDS[parts[3]]}\nОтправьте новое значение: ${hint}.\n\n${state.correction.reason}\n\nПравка сразу сохранится в услугу #${id}.`,{inline_keyboard:[[button('Отменить ввод',`corr:open:${id}`)]]});
  }
  if(action==='check'){await mutateCorrection(pool,{providerId:pid,serviceId:id,expectedToken:parts[5],action:'check',code:parts[3],checked:parts[4]==='1',updateId:ctx.update?.update_id});return show(ctx,pid,id);}
  if(action==='submit'){
   if(parts[3]!==state.token)throw new Error('Кнопка устарела. Обновите замечания.');
   await submitProviderService(pool,{providerId:pid,serviceId:id,correction:{requestId:state.correction.requestId,expected_edit_version:state.correction.editVersion,fingerprint:state.correction.fingerprint,checkedCodes:state.checkedCodes}});
   ctx.session.correctionFlow=null;try{await notifyModerationNew({service:id,resubmitted:true});}catch{console.warn('[telegram corrections] moderation notification unavailable');}return reply(ctx,`✅ Услуга #${id} отправлена на повторную проверку. Дождитесь решения модератора.`,{inline_keyboard:[[button('Мои услуги','prov_services:list')]]});
  }
  const field=parts[3];if(!['proof','photos'].includes(field))throw new Error('Неизвестный раздел.');
  if(action==='media'){
   if(parts[4]!==state.token)throw new Error('Кнопка устарела. Обновите замечания.');const images=field==='proof'?state.service.details?.proofImages||[]:state.service.images||[];
   const rows=[[button('➕ Добавить изображение',`corr:upload:${id}:${field}:${state.token}`)]];
   images.forEach((_,index)=>rows.push([button(`Открыть ${index+1}`,`corr:view:${id}:${field}:${index}:${state.token}`),button(`Удалить ${index+1}`,`corr:del:${id}:${field}:${index}:${state.token}`)]));rows.push([button('К замечаниям',`corr:open:${id}`)]);
   return reply(ctx,field==='proof'?`📎 Proof: ${images.length} изображений. Это внутренние подтверждения, клиенты их не видят.`:`🖼 Фото карточки: ${images.length}. Эти изображения видят клиенты. Не загружайте сюда брони с личными данными.`,{inline_keyboard:rows});
  }
  if(action==='upload'){if(parts[4]!==state.token)throw new Error('Кнопка устарела.');ctx.session.correctionFlow={serviceId:id,mode:'upload',field};return reply(ctx,'Отправьте фото или изображение файлом до 6 МБ. Каждое изображение сохранится сразу.',{inline_keyboard:[[button('Готово',`corr:open:${id}`)]]});}
  if(action==='del'||action==='view'){
   if(parts[5]!==state.token)throw new Error('Состав изображений изменился. Обновите замечания.');const index=Number(parts[4]);
   if(action==='del'){await mutateCorrection(pool,{providerId:pid,serviceId:id,expectedToken:parts[5],action:'remove',field,value:index,updateId:ctx.update?.update_id});return show(ctx,pid,id);}
   const images=field==='proof'?state.service.details?.proofImages||[]:state.service.images||[];const src=images[index];if(!src)throw new Error('Изображение не найдено.');return ctx.replyWithPhoto(/^data:image\//.test(src)?{source:Buffer.from(src.split(',')[1],'base64')}:src,{caption:`${field==='proof'?'Proof':'Фото'} ${index+1} · #${id}`});
  }
  throw new Error('Неизвестная кнопка. Откройте замечания заново.');
 }
 return async(ctx,next)=>{
  const data=String(ctx.callbackQuery?.data||''),text=String(ctx.message?.text||'');ctx.session=ctx.session||{};
  if(data&&!data.startsWith('corr:')){ctx.session.correctionFlow=null;return next();}
  if(/^\/(cancel|menu|start)(?:@\w+)?\s*$/.test(text)){ctx.session.correctionFlow=null;return next();}
  if(!data.startsWith('corr:')&&!ctx.session.correctionFlow&&!/^\/corrections(?:@\w+)?$/.test(text)&&!/^\/start(?:@\w+)? correction_\d+$/.test(text))return next();
  if(ctx.callbackQuery)await ctx.answerCbQuery().catch(()=>{});
  return serial(String(ctx.from?.id),async()=>{try{await handle(ctx);}catch(error){const labels=error.blockerDetails?.map(b=>b.label).filter(Boolean);const message=labels?.length?`Перед отправкой исправьте: ${labels.join('; ')}`:error.status===500||/^[0-9A-Z]{5}$/.test(error.code||'')?'Не удалось сохранить изменения. Попробуйте ещё раз.':error.message;await reply(ctx,`⚠️ ${message}`,{inline_keyboard:[[button('Обновить замечания',ctx.session.correctionFlow?.serviceId?`corr:open:${ctx.session.correctionFlow.serviceId}`:'corr:list:0')]]});}});
 };
}
module.exports={createCorrectionFlow,keyboard,chunks,FIELDS};
