const {randomBytes}=require('node:crypto');
const {bookingEditRows,editableBookingSteps}=require('../../ai/bookingScreenshotUi');
const {createBookingReader,stepFieldsFor}=require('../../ai/bookingScreenshot');
const {labels,display,mergeRecognition,validateEdit,setField,reviewText}=require('../../ai/bookingImportReview');
const {compactFields,requiredMissing,validateCompact,previewText}=require('../../ai/bookingCompact');
const {duplicateSignature}=require('../../ai/bookingDuplicates');
const categoryLabels={refused_tour:'Отказной тур',refused_hotel:'Отказной отель',refused_flight:'Отказной авиабилет'};
async function updatePanel(ctx,text,extra){if(ctx.callbackQuery&&ctx.editMessageText){try{const m=await ctx.editMessageText(text,extra);if(m)return m;}catch{}}return ctx.reply(text,extra);}
async function downloadImage(ctx,id){
 const response=await fetch(await ctx.telegram.getFileLink(id),{signal:AbortSignal.timeout(20000)});
 if(!response.ok||Number(response.headers.get('content-length')||0)>6*1024*1024)throw Error('IMAGE_DOWNLOAD');
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>6*1024*1024)throw Error('IMAGE_SIZE');chunks.push(chunk);}return Buffer.concat(chunks);
}
function createBookingScreenshotFlow({authorize,onAccept,read=createBookingReader(),loadImage=downloadImage,findDuplicates=async()=>[],now=Date.now,compact=false,store,onUpdate}={}){
 const busy=new Set(),rates=new Map();
 const active=ctx=>ctx.session?.bookingImport;
 const keyboard=(token,rows)=>({reply_markup:{inline_keyboard:rows.map(row=>row.map(([text,action])=>({text,callback_data:`booking:${action}:${token}`})))}});
 const blocked=ctx=>ctx.session?.editingServiceId||ctx.session?.editWiz||ctx.session?.awaitingProofForServiceId||ctx.session?.correctionFlow||ctx.session?.companionFlow||ctx.session?.galaFlow||(ctx.session?.state&&ctx.session.state!=='svc_create_choose_category');
 const notice='📷 Создать услугу по скриншоту бронирования\n\nПришлите до 5 скриншотов одной брони — каждый до 6 МБ. Перед отправкой закройте ФИО, даты рождения, паспорта, QR-коды и контакты туристов.\n\nНажмите «Распознать», когда все изображения добавлены. Сравним данные и покажем, что проверить или дополнить. Скриншоты не публикуются автоматически.';
 function session(ctx){const s={token:randomBytes(8).toString('hex'),expires:now()+(compact?30*86400000:15*60000),category:'refused_tour',files:[],stage:'upload',warnings:[],conflicts:[],manualFields:[]};ctx.session.bookingImport=s;return s;}
 function showUpload(ctx,s){return ctx.reply(notice+`\n\nВыбрано: ${categoryLabels[s.category]}\nДобавлено скриншотов: ${s.files.length} из 5`,keyboard(s.token,[[['📍 Тур','cat_refused_tour'],['🏨 Отель','cat_refused_hotel'],['✈️ Авиабилет','cat_refused_flight']],...(s.files.length?[[['🔎 Распознать','read']]]:[]),[['❌ Отмена','cancel']]]));}
 function showReview(ctx,s,inPlace=false){
  const rows=[];
  if(s.conflicts.length)rows.push([['⚠️ Разобрать различия','conflicts']]);
  if(s.warnings.some(w=>s.draft[w.field]!==undefined))rows.push([['✅ Проверил отмеченные данные','ackwarnings']]);
  rows.push([['✅ Подтвердить данные','accept']],[['✏️ Изменить название','fix_svc_create_title'],['✏️ Другие поля','edit']]);
  if(compact)rows.push([['⚙️ Дополнительные условия','options']],[['💾 Сохранить и выйти','pause']]);
  if(s.files.length<5)rows.push([['➕ Ещё скриншот','add']]);
  if(s.files.some(f=>!f.processed))rows.push([['🔎 Повторить нераспознанные','read']]);
  rows.push([['❌ Отмена','cancel']]);
  const text=reviewText(s,categoryLabels[s.category])+(compact?`\n\nЦена поставщика: ${s.draft.price||'не указана'} USD\nЦена клиента: ${s.draft.grossPrice||'не указана'} USD\nСрок: ${Object.hasOwn(s.draft,'expiration')?(s.draft.expiration?new Date(s.draft.expiration).toLocaleDateString('ru-RU',{timeZone:'Asia/Tashkent'}):'без срока'):'не указан'}`:'');return inPlace?updatePanel(ctx,text,keyboard(s.token,rows)):ctx.reply(text,keyboard(s.token,rows));
 }
 function showConflicts(ctx,s){return ctx.reply('⚠️ На скриншотах разные значения\nВыберите поле и укажите правильный вариант. Ничего не заменяем автоматически.',keyboard(s.token,[...s.conflicts.map((c,i)=>[[labels[c.field],`conflict_${i}`]]),[['⬅️ К проверке','review']]]));}
 function showField(ctx,s,field){
  s.stage='field';s.field=field;
  let hint=compactFields[field]?.hint||'Отправьте правильное значение.';let rows=[];
  if(field.endsWith('Date'))hint='Введите дату: ДД.ММ.ГГГГ.';
  if(compactFields[field]?.boolean||['transferIncluded','insuranceIncluded'].includes(field))rows=[[['✅ Включено','value_yes'],['Не включено','value_no']],[['Не знаю','value_unknown']]];
  if(field==='flightType')rows=[[['➡️ В одну сторону','value_one'],['🔁 Туда-обратно','value_round']]];
  if(field==='food')hint='Укажите RO, BB, HB, FB, AI или UAI.';
  if(field==='accommodation')hint='Укажите SGL, DBL, TRPL или QDRPL.';
  rows.push([['⬅️ К проверке','review'],['✖️ Отменить','cancel']]);
  return ctx.reply(`✏️ ${labels[field]||compactFields[field]?.label}\n\nСейчас: ${display(s.draft[field],field)}\n\n${hint}\n${compact&&s.completing?'Затем перейдём к следующему недостающему полю.':'После изменения вернёмся к сводке.'}`,keyboard(s.token,rows));
 }
 async function applyField(ctx,s,text){try{const value=compactFields[s.field]?validateCompact(s.field,text,s.draft):validateEdit(s.field,text,s.draft);setField(s,s.field,value);s.stage='review';delete s.previewConfirmed;delete s.field;if(compact&&s.completing)return accept(ctx,s);return showReview(ctx,s);}catch(e){return ctx.reply(e.message);}}
 async function accept(ctx,s){
  if(compact&&s.files.some(f=>!f.processed))return ctx.reply('Сначала распознайте добавленные скриншоты.',keyboard(s.token,[[['🔎 Распознать','read']]]));
  if(s.conflicts.length)return showConflicts(ctx,s);
  if(s.warnings.some(w=>s.draft[w.field]!==undefined))return showReview(ctx,s);
  if(!s.draft.bookingPartyConfirmed){if(compact)s.completing=true;s.stage='party';return ctx.reply((s.category==='refused_flight'?'👥 Сколько пассажиров летит?':'👥 Сколько гостей едет?')+'\n\nБез имён: взрослые + дети + младенцы.\nНапример: 2+0+0.',keyboard(s.token,[[['⬅️ К проверке','review'],['❌ Отмена','cancel']]]));}
  if(compact){const missing=requiredMissing(s.draft);if(!s.draft.price)missing.push('price');if(!s.draft.grossPrice)missing.push('grossPrice');if(!Object.hasOwn(s.draft,'expiration'))missing.push('expiration');if(missing.length){s.completing=true;return showField(ctx,s,missing[0]);}delete s.completing;if(s.previewConfirmed!==JSON.stringify(s.draft)){s.previewShown=JSON.stringify(s.draft);s.stage='review';if(s.draft.images?.length&&ctx.replyWithPhoto)await ctx.replyWithPhoto({source:Buffer.from(s.draft.images[0].split(',')[1],'base64')},{caption:'Фото публичной карточки'});return ctx.reply(previewText(s.draft),keyboard(s.token,[[['💾 Сохранить черновик','save']],[['✏️ Изменить','edit'],['⚙️ Условия','options']],[['📷 Фото карточки','publicphoto']],[['⬅️ К сводке','review']]]));}}
  let matches;try{matches=await findDuplicates(ctx,s.draft);}catch{return ctx.reply('Не удалось проверить похожие услуги. Данные сохранены в сводке — нажмите подтверждение ещё раз позже.');}
  const signature=duplicateSignature(s.draft,matches);
  if(matches.length&&s.duplicateAck!==signature){
   s.lastDuplicateSignature=signature;s.matches=matches;
   const extra=keyboard(s.token,[[['Создать отдельный черновик','duplicate_continue']],[['⬅️ К проверке','review']]]);
   if(compact&&onUpdate)for(const m of matches.filter(m=>m.status==='draft'))extra.reply_markup.inline_keyboard.unshift([{text:`Обновить черновик #${m.id}`,callback_data:`booking:update_${m.id}:${s.token}`}]);
   for(const m of matches)extra.reply_markup.inline_keyboard.unshift([{text:`Открыть #${m.id}`,url:`https://travella.uz/dashboard/services/marketplace?service_id=${m.id}&from=tg`}]);
   return ctx.reply('⚠️ Похожее предложение уже есть у вас\n\n'+matches.map(m=>`#${m.id} · ${String(m.title||'Без названия').slice(0,100)}`).join('\n')+'\n\nОткройте его или явно подтвердите создание отдельного черновика.',extra);
  }
  const fields=stepFieldsFor(s.category);
  const draft={...s.draft,bookingImportVersion:2,bookingDuplicateAcknowledged:signature,bookingSourceFiles:s.files.filter(f=>f.processed).map(f=>({id:f.id,kind:f.kind||'photo'})),bookingImportSkip:Object.entries(fields).filter(([,key])=>s.draft[key]!==undefined&&s.draft[key]!==null&&s.draft[key]!=='').map(([step])=>step)};
  if(compact)draft.bookingCompact=true;
  if(busy.has(ctx.from.id))return;busy.add(ctx.from.id);try{await onAccept(ctx,draft,null);delete ctx.session.bookingImport;}finally{busy.delete(ctx.from.id);}
 }
 const handle=async(ctx,next)=>{
  if(ctx.chat?.type!=='private'||String(ctx.chat.id)!==String(ctx.from?.id))return next();
  const data=String(ctx.callbackQuery?.data||''),text=ctx.message?.text||'',command=/^\/frombooking(?:@\w+)?(?:\s|$)/i.test(text);
  const p=ctx.message?.photo?.at(-1),doc=ctx.message?.document;
  const file=p?{id:p.file_id,size:p.file_size,kind:'photo'}:doc&&['image/jpeg','image/png','image/webp'].includes(doc.mime_type)?{id:doc.file_id,size:doc.file_size,kind:'document'}:null;
  let s=active(ctx);
  if(s&&/^\/(?!frombooking(?:@|\s|$))/.test(text)){if(compact)s.stage='paused';else delete ctx.session.bookingImport;return next();}
  if(!data.startsWith('booking:')&&!command&&!file&&!(s&&['field','party'].includes(s.stage)&&text))return next();
  if(file&&blocked(ctx))return next();
  if(!await authorize(ctx))return file&&!s?next():ctx.reply('Создание по скриншоту доступно подтверждённым поставщикам.');
  s=active(ctx);
  if(command||data==='booking:start'){if(compact&&s){s.expires=now()+(compact?30*86400000:15*60000);s.token=randomBytes(8).toString('hex');s.resumeStage=s.stage;s.stage=s.draft?'review':'upload';return ctx.reply('💾 У вас есть сохранённое создание. Продолжить?',keyboard(s.token,[[['▶️ Продолжить','resume']],[['Начать заново','restart']]]));}if(ctx.callbackQuery)await ctx.answerCbQuery().catch(()=>{});if(blocked(ctx))return ctx.reply('Сначала завершите текущее редактирование. Черновик не заменён.');return showUpload(ctx,session(ctx));}
  if(data.startsWith('booking:')){
   await ctx.answerCbQuery().catch(()=>{});const token=data.split(':')[2];
   if(!s||token!==s.token||s.expires<=now())return ctx.reply('Эта кнопка устарела. Начните заново: /frombooking');
   if(data.split(':')[1]==='cancel'){delete ctx.session.bookingImport;return ctx.reply('Распознавание отменено.');}
  }
  if(busy.has(ctx.from.id))return ctx.reply('Уже распознаю изображения. Дождитесь сводки.');
  if(file){
   if(file.size>6*1024*1024)return ctx.reply('Пришлите изображение до 6 МБ.');
   if(!s||s.expires<=now())s=session(ctx);
   if(compact&&s.stage==='publicphoto'){if((s.draft.images||[]).length>=5)return ctx.reply('Можно до 5 фото карточки.');const bytes=await loadImage(ctx,file.id);const image=await require('sharp')(bytes).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();s.draft.images.push('data:image/jpeg;base64,'+image.toString('base64'));delete s.previewConfirmed;s.stage='review';return showReview(ctx,s);}
   if(s.files.some(f=>f.id===file.id))return ctx.reply('Этот скриншот уже добавлен.');
   if(s.files.length>=5)return ctx.reply('Можно до 5 скриншотов одной брони. Начните отдельное создание для другой брони.');
   s.files.push(file);delete s.previewShown;delete s.previewConfirmed;s.stage='consent';s.token=randomBytes(8).toString('hex');s.expires=now()+(compact?30*86400000:15*60000);return showUpload(ctx,s);
  }
  if(!s||s.expires<=now()){delete ctx.session.bookingImport;return ctx.reply('Начните заново: /frombooking');}
  if(blocked(ctx))return ctx.reply('Сначала завершите текущее редактирование. Черновик не заменён.');
  if(text&&s.stage==='field')return applyField(ctx,s,text);
  if(text&&s.stage==='party'){
   const m=text.trim().match(/^(\d{1,2})\s*\+\s*(\d{1,2})\s*\+\s*(\d{1,2})$/);
   if(!m||+m[1]<1||m.slice(1).reduce((n,v)=>n+Number(v),0)>20)return ctx.reply('Введите состав без имён: взрослые + дети + младенцы. Например: 2+0+0.');
   Object.assign(s.draft,{adt:+m[1],chd:+m[2],inf:+m[3],bookingPartyConfirmed:true});s.stage='review';if(compact)return accept(ctx,s);return showReview(ctx,s);
  }
  if(!data.startsWith('booking:'))return next();
  const action=data.split(':')[1];
  if(action==='restart')return showUpload(ctx,session(ctx));
  if(action==='resume'){if(s.resumeStage==='field'&&s.field){delete s.resumeStage;return showField(ctx,s,s.field);}if(s.resumeStage==='party'){delete s.resumeStage;return accept(ctx,s);}delete s.resumeStage;return s.draft?showReview(ctx,s):showUpload(ctx,s);}
  if(action==='pause')return ctx.reply('💾 Прогресс сохранён. Чтобы продолжить с этого места, нажмите кнопку или отправьте /frombooking.',keyboard(s.token,[[['▶️ Продолжить','resume']]]));
  if(action.startsWith('cat_')&&['upload','consent'].includes(s.stage)){
   const cat=action.slice(4);if(!categoryLabels[cat])return;
   if(s.category!==cat){s.category=cat;s.files.forEach(f=>delete f.processed);delete s.draft;s.warnings=[];s.conflicts=[];s.manualFields=[];delete s.duplicateAck;}
   s.token=randomBytes(8).toString('hex');return showUpload(ctx,s);
  }
  if(action==='read'&&['consent','review'].includes(s.stage)){
   const last=rates.get(ctx.from.id);if(last&&now()-last<30000)return ctx.reply('Подождите полминуты перед новым распознаванием.');
   rates.set(ctx.from.id,now());if(rates.size>2000)for(const [id,t]of rates)if(now()-t>60000)rates.delete(id);
   const pending=s.files.filter(f=>!f.processed);if(!pending.length)return showReview(ctx,s);
   busy.add(ctx.from.id);s.stage='reading';
   try{
    for(const f of pending){if(active(ctx)!==s)return;await ctx.reply(`🔎 Распознаю скриншот ${s.files.indexOf(f)+1} из ${s.files.length}…`);try{const d=await read(await loadImage(ctx,f.id),s.category);if(active(ctx)!==s)return;mergeRecognition(s,d,s.files.indexOf(f)+1);f.processed=true;}catch{await ctx.reply(`Не удалось разобрать скриншот ${s.files.indexOf(f)+1}. Остальные данные сохранятся.`);}}
    if(active(ctx)!==s)return;
    if(!s.draft){s.stage='consent';return ctx.reply('Пришлите более чёткие скриншоты или повторите распознавание.');}
    s.stage='review';s.token=randomBytes(8).toString('hex');return showReview(ctx,s);
   }finally{busy.delete(ctx.from.id);}
  }
  if(action==='review'&&s.draft){delete s.completing;delete s.previewConfirmed;s.stage='review';delete s.previewConfirmed;delete s.field;return showReview(ctx,s,true);}
  if(action.startsWith('value_')&&s.stage==='field')return applyField(ctx,s,({value_yes:'да',value_no:'нет',value_one:'в одну сторону',value_round:'туда-обратно',value_unknown:'не знаю'})[action]||'');
  if(compact&&action==='accept'&&s.stage==='consent')return ctx.reply('Сначала распознайте добавленные скриншоты.',keyboard(s.token,[[['🔎 Распознать','read']]]));
  if(s.stage!=='review')return;
  if(action==='publicphoto'&&compact){s.stage='publicphoto';return ctx.reply('Пришлите одно фото для публичной карточки: отель или направление, без документов и персональных данных.',keyboard(s.token,[[['⬅️ К сводке','review']]]));}
  if(action==='save'&&compact){if(s.previewShown!==JSON.stringify(s.draft))return showReview(ctx,s);s.previewConfirmed=s.previewShown;return accept(ctx,s);}
  if(action==='options'&&compact){delete s.completing;return updatePanel(ctx,'⚙️ Дополнительные условия\nЗаполняйте только известное. Неизвестное не означает «не включено». Фото карточки можно добавить после сохранения. Поиск попутчика и гала-ужин доступны там же.',keyboard(s.token,[...Object.entries(compactFields).filter(([,v])=>v.optional&&(s.category!=='refused_flight'||v.flight)).map(([k,v])=>[[v.label,'extra_'+k]]),[['⬅️ К сводке','review']]]));}
  if(action.startsWith('extra_')&&compact){const field=action.slice(6);if(compactFields[field])return showField(ctx,s,field);return;}
  if(action.startsWith('update_')&&compact&&onUpdate){if(s.previewConfirmed!==JSON.stringify(s.draft)||requiredMissing(s.draft).length)return showReview(ctx,s);const id=Number(action.slice(7));const matches=await findDuplicates(ctx,s.draft);if(!matches.some(m=>Number(m.id)===id&&m.status==='draft'))return ctx.reply('Этот черновик больше нельзя обновить. Вернитесь к сводке.');if(busy.has(ctx.from.id))return;busy.add(ctx.from.id);try{await onUpdate(ctx,id,s.draft,s.files.filter(f=>f.processed));delete ctx.session.bookingImport;}finally{busy.delete(ctx.from.id);}return;}
  if(action==='add')return ctx.reply('Отправьте следующий скриншот этой же брони. Уже распознанные данные сохранятся.');
  if(action==='ackwarnings'){s.warnings=s.warnings.filter(w=>s.draft[w.field]===undefined);return showReview(ctx,s,true);}
  if(action==='conflicts')return showConflicts(ctx,s);
  if(action.startsWith('conflict_')){
   const i=Number(action.slice(9)),c=s.conflicts[i];if(!c)return;
   const fieldStep=editableBookingSteps(s.draft).find(([,key])=>key===c.field)?.[0];
   return ctx.reply(`⚠️ ${labels[c.field]}\n\n`+c.values.map((v,n)=>`${n+1}. ${display(v.value,c.field).slice(0,200)} (скриншот ${v.source})`).join('\n'),keyboard(s.token,[...c.values.map((v,n)=>[[`${n+1}. Выбрать вариант`,`choose_${i}_${n}`],['👁 Посмотреть',`view_${i}_${n}`]]),...(fieldStep?[[['✏️ Ввести вручную','fix_'+fieldStep]]]:[]),[['⬅️ К проверке','review']]]));
  }
  if(action.startsWith('view_')){const [,i,n]=action.split('_'),c=s.conflicts[Number(i)],v=c?.values[Number(n)];if(v)return ctx.reply(`${labels[c.field]} · вариант ${Number(n)+1}\nСкриншот ${v.source}\n\n${display(v.value,c.field).slice(0,3600)}`);return;}
  if(action.startsWith('choose_')){const [,i,n]=action.split('_'),c=s.conflicts[Number(i)],v=c?.values[Number(n)];if(!v)return;try{const checked=validateEdit(c.field,typeof v.value==='boolean'?(v.value?'да':'нет'):String(v.value),s.draft);setField(s,c.field,checked);return showReview(ctx,s);}catch(e){return ctx.reply(e.message);}}
  if(action.startsWith('fix_')){delete s.completing;delete s.previewConfirmed;const step=action.slice(4);const entry=editableBookingSteps(s.draft).find(([st])=>st===step);if(!entry)return;return showField(ctx,s,entry[1]);}
  if(action==='edit'){delete s.completing;delete s.previewConfirmed;return updatePanel(ctx,'✏️ Исправить данные\n\nВыберите поле. После ввода вернёмся к обновлённой сводке.',keyboard(s.token,[...bookingEditRows(s.draft).slice(0,-2),...(compact?[[['💰 Цена поставщика','extra_price'],['💵 Цена клиента','extra_grossPrice']],[['⏳ Срок актуальности','extra_expiration']]]:[]),...bookingEditRows(s.draft).slice(-2)]));}
  if(action==='duplicate_continue'){s.duplicateAck=s.lastDuplicateSignature;return accept(ctx,s);}
  if(action==='accept')return accept(ctx,s);
 };
 return async(ctx,next)=>{
  if(!compact||!store||ctx.chat?.type!=='private'||String(ctx.chat.id)!==String(ctx.from?.id))return handle(ctx,next);
  const relevant=String(ctx.callbackQuery?.data||'').startsWith('booking:')||/^\/frombooking(?:@|\s|$)/i.test(ctx.message?.text||'')||ctx.session?.bookingImport;
  if(!relevant)return handle(ctx,next);
  try{if(!await authorize(ctx))return handle(ctx,next);if(!ctx.session.bookingImport){const saved=await store.load(ctx.from.id);if(saved){if(saved.stage==='reading')saved.stage=saved.draft?'review':'consent';ctx.session.bookingImport=saved;}}try{await handle(ctx,next);}finally{await store.save(ctx.from.id,ctx.session.bookingImport||null);}}catch(e){await ctx.reply('Не удалось завершить действие. Прогресс оставлен в сводке; попробуйте ещё раз.');}
 };
}
module.exports={createBookingScreenshotFlow};
