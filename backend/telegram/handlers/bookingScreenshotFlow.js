const {saleExpired,expiryWarning}=require('../../ai/bookingPricing');
const {sourceIndexes}=require('../../ai/bookingPresentation');
const {randomBytes,createHash}=require('node:crypto');
const draftFingerprint=d=>createHash('sha256').update(JSON.stringify(d)).digest('hex');
const {bookingEditRows,editableBookingSteps}=require('../../ai/bookingScreenshotUi');
const {createBookingReader,stepFieldsFor}=require('../../ai/bookingScreenshot');
const {labels,fieldIcons,display,mergeRecognition,validateEdit,setField,reviewText}=require('../../ai/bookingImportReview');
const {compactFields,requiredMissing,validateCompact,previewText,pendingFields,progressText,priceSummary}=require('../../ai/bookingCompact');
const {priceBases,changes,rebuild,checks,checkSignature,readiness}=require('../../ai/bookingQuality');
const {checkpoint,undo,imageError}=require('../../ai/bookingRecovery');
const {expiryChoice,expiryLabel,calendarRows,localDay}=require('../../ai/bookingQuickChoices');
const {bookingGroups,splitGroups,groupSignature,groupText}=require('../../ai/bookingGroups');
const {duplicateSignature}=require('../../ai/bookingDuplicates');
const categoryLabels={refused_tour:'Отказной тур',refused_hotel:'Отказной отель',refused_flight:'Отказной авиабилет'};
async function updatePanel(ctx,text,extra){if(ctx.callbackQuery&&ctx.editMessageText){try{const m=await ctx.editMessageText(text,extra);if(m)return m;}catch{}}return ctx.reply(text,extra);}
async function downloadImage(ctx,id){
 const response=await fetch(await ctx.telegram.getFileLink(id),{signal:AbortSignal.timeout(20000)});
 if(!response.ok||Number(response.headers.get('content-length')||0)>6*1024*1024)throw Error('IMAGE_DOWNLOAD');
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>6*1024*1024)throw Error('IMAGE_SIZE');chunks.push(chunk);}return Buffer.concat(chunks);
}
function createBookingScreenshotFlow({authorize,onAccept,read=createBookingReader(),loadImage=downloadImage,findDuplicates=async()=>[],now=Date.now,compact=false,store,onUpdate,loadUpdate,inspectQuality}={}){
 const busy=new Set(),rates=new Map();
 const panel=require('./bookingPanel').createBookingPanel();
 const render=(ctx,s,text,extra)=>compact?panel(ctx,s,text,extra):ctx.reply(text,extra);
 const swap=(ctx,text,extra)=>compact?panel(ctx,ctx.session.bookingImport,text,extra):updatePanel(ctx,text,extra);
 const active=ctx=>ctx.session?.bookingImport;
 const keyboard=(token,rows)=>({reply_markup:{inline_keyboard:rows.map(row=>row.map(([text,action])=>({text,callback_data:`booking:${action}:${token}`})))}});
 const surchargeFlow=require('./bookingSurcharges').createBookingSurcharges({render,keyboard,onDone:(ctx,s)=>s.completing?accept(ctx,s):showReview(ctx,s)});
 const blocked=ctx=>ctx.session?.editingServiceId||ctx.session?.editWiz||ctx.session?.awaitingProofForServiceId||ctx.session?.correctionFlow||ctx.session?.companionFlow||ctx.session?.galaFlow||(ctx.session?.state&&ctx.session.state!=='svc_create_choose_category');
 const notice='📷 Создать услугу по скриншоту бронирования\n\n1️⃣ Выберите категорию.\n2️⃣ Пришлите до 5 скриншотов одной брони · до 6 МБ каждый.\n3️⃣ Нажмите «🔎 Распознать».\n\n🔒 Скройте ФИО, даты рождения, документы, QR-коды и контакты.\n🖼 Скриншоты не публикуются автоматически.';
 function session(ctx){const s={token:randomBytes(8).toString('hex'),expires:now()+(compact?30*86400000:15*60000),category:'refused_tour',files:[],stage:'upload',warnings:[],conflicts:[],manualFields:[]};ctx.session.bookingImport=s;return s;}
 function showUpload(ctx,s){s.stage=s.files.length?'consent':'upload';return render(ctx,s,(s.categoryConfirmed?'✅ Выбрано: '+categoryLabels[s.category]+'\n\n📷 Пришлите скриншот бронирования.\n📎 До 5 скриншотов одной брони · до 6 МБ каждый\n🔒 Скройте ФИО, даты рождения, документы, QR-коды и контакты.\n🖼 Скриншоты не публикуются.':notice)+`\n\n${s.categoryConfirmed?'':'🏷 Выбрано: '+categoryLabels[s.category]+'\n'}📎 Добавлено скриншотов: ${s.files.length} из 5\n${s.files.length?'✅ Скриншоты добавлены.\n👇 Нажмите «Распознать» или пришлите ещё.':s.categoryConfirmed?'📷 Жду скриншот в этом чате.':'👇 Выберите категорию и пришлите скриншот.'}`,keyboard(s.token,[[[s.categoryConfirmed&&s.category==='refused_tour'?'✅ Тур':'📍 Тур','cat_refused_tour'],[s.categoryConfirmed&&s.category==='refused_hotel'?'✅ Отель':'🏨 Отель','cat_refused_hotel'],[s.categoryConfirmed&&s.category==='refused_flight'?'✅ Авиабилет':'✈️ Авиабилет','cat_refused_flight']],...(s.files.length?[[['🔎 Распознать','read']]]:[]),...(compact&&s.files.length?[[['🖼 Скриншоты','files']]]:[]),...(compact&&s.undo?[[['↩️ Отменить последнюю правку','undo']]]:[]),[['❌ Отмена','cancel']]]));}
 async function publicPhoto(ctx,s,file){s.photoRetry=file;try{if((s.draft.images||[]).length>=5)return ctx.reply('🖼 Можно добавить до 5 фото карточки.');const bytes=await loadImage(ctx,file.id),image=await require('sharp')(bytes).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();checkpoint(s,'добавление фото карточки');s.draft.images.push('data:image/jpeg;base64,'+image.toString('base64'));delete s.photoRetry;delete s.previewConfirmed;s.stage='review';return showReview(ctx,s);}catch(e){return ctx.reply('🖼 Фото карточки не добавлено. '+imageError(e)+' Заполненные поля сохранены.',keyboard(s.token,[[['🔄 Повторить загрузку','retryphoto']],[['⬅️ К сводке','review']]]));}}
 function showReview(ctx,s,inPlace=false){
  const rows=[];
  if(compact&&saleExpired(s.draft,now()))rows.push([['⏳ Обновить срок продажи','extra_expiration']]);
  for(const w of s.warnings||[]){const entry=editableBookingSteps(s.draft).find(([,field])=>field===w.field);if(entry&&!rows.flat().some(([,a])=>a==='fix_'+entry[0]))rows.push([['⚠️ '+labels[w.field],'fix_'+entry[0]],...(sourceIndexes(s,w.field).length?[['🖼 Источник','fieldsource_'+w.field]]:[])]);}
  if(s.conflicts.length)rows.push([['⚠️ Разобрать различия','conflicts']]);
  if(s.warnings.some(w=>s.draft[w.field]!==undefined))rows.push([['✅ Проверил отмеченные данные','ackwarnings']]);
  rows.push([['✅ Подтвердить данные','accept']],[['✏️ Изменить название','fix_svc_create_title'],['✏️ Другие поля','edit']]);
  if(compact)rows.push([['💰 Цены','prices'],['➕ Доплаты','fees']],[['⚙️ Дополнительные условия','options']],[['🖼 Скриншоты','files']],[['💾 Сохранить и выйти','pause']]);
  if(s.files.length<5)rows.push([['➕ Ещё скриншот','add']]);
  if(s.files.some(f=>!f.processed))rows.push([['🔎 Повторить нераспознанные','read']]);
  if(compact&&s.undo)rows.push([['↩️ Отменить последнюю правку','undo']]);
  rows.push([['❌ Отмена','cancel']]);
  const text=(compact&&saleExpired(s.draft,now())?expiryWarning(s.draft,now())+'\n\n':'')+(s.changeLines?.length?'📝 Что изменилось\n'+s.changeLines.slice(0,10).join('\n')+'\n\n':'')+(compact?progressText(s.draft)+'\n\n':'')+reviewText(s,categoryLabels[s.category],!compact)+(compact?`\n\n💰 Цена для коллег: ${s.draft.price||'не указана'} USD\n💵 Цена для туристов: ${s.draft.grossPrice||'не указана'} USD\n👥 Единица цены: ${priceBases[s.draft.priceBasis]||'не выбрана'}\n⏳ Срок: ${Object.hasOwn(s.draft,'expiration')?expiryLabel(s.draft.expiration):'не указан'}\n\n${(s.draft.pricePeriod||s.draft.surchargesStatus)?require('../../ai/bookingPricing').pricingText(s.draft)+'\n\n':''}${checks(s.draft).map(c=>'⚠️ '+c.message).join('\n')}\n${readiness(s.draft)}`:'');return compact?panel(ctx,s,text.slice(0,4000),keyboard(s.token,rows)):inPlace?updatePanel(ctx,text,keyboard(s.token,rows)):ctx.reply(text,keyboard(s.token,rows));
 }
 function showConflicts(ctx,s){return render(ctx,s,'⚠️ На скриншотах разные значения\nВыберите поле и укажите правильный вариант. Ничего не заменяем автоматически.',keyboard(s.token,[...s.conflicts.map((c,i)=>[[labels[c.field],`conflict_${i}`]]),[['⬅️ К проверке','review']]]));}
 function showField(ctx,s,field,manual=false){
  if(compact&&field==='surcharges')return surchargeFlow.show(ctx,s);
  s.stage='field';s.field=field;
  let hint=compactFields[field]?.hint||'✍️ Напишите новое значение сообщением.';let rows=[];
  if(field.endsWith('Date'))hint='📅 Напишите дату в формате ДД.ММ.ГГГГ. Например: 15.12.2026.';
  if(compactFields[field]?.boolean||['transferIncluded','insuranceIncluded'].includes(field))rows=[[['✅ Включено','value_yes'],['➖ Не включено','value_no']],[['❔ Не знаю','value_unknown']]];
  if(field==='flightType')rows=[[['➡️ В одну сторону','value_one'],['🔁 Туда-обратно','value_round']]];
  if(['price','grossPrice'].includes(field)&&priceBases[s.draft.priceBasis])hint+='\nЦена '+priceBases[s.draft.priceBasis]+'.';
  if(field==='pricePeriod')rows=[[[(s.category==='refused_flight'?'✈️ Все указанные рейсы':'🗓 За весь срок'),'period_full']],...(s.category==='refused_flight'?[]:[[['🌙 За ночь','period_night']]])];
  if(field==='priceBasis')rows=[[['👥 За всех','basis_total'],['👤 За человека','basis_person']],...(s.category!=='refused_flight'?[[['🛏 За номер','basis_room']]]:[])];
  if(field==='expiration'&&compact&&!manual){hint='👇 Выберите срок. Точную дату и время покажем по Ташкенту.';rows=[[['🌙 До вечера','expiry_evening'],['⏱ 24 часа','expiry_24h']],[['📅 Выбрать дату','expirycalendar']],[['♾ Без срока','expiry_none'],['✍️ Ввести дату','manualexpiry']]];}
  if(field==='food'){hint='🍽 Выберите питание. Можно также написать код сообщением.';rows=[[['RO · Без питания','pick_RO'],['BB · Завтраки','pick_BB']],[['HB · Завтрак и ужин','pick_HB'],['FB · Три раза в день','pick_FB']],[['AI · Всё включено','pick_AI'],['UAI · Ультра всё включено','pick_UAI']]];}
  if(field==='accommodation'){hint='🛏 Выберите размещение в номере.';rows=[[['SGL · Одноместное','pick_SGL'],['DBL · Двухместное','pick_DBL']],[['TRPL · Трёхместное','pick_TRPL'],['QDRPL · Четырёхместное','pick_QDRPL']]];}
  if(field.endsWith('Date')&&compact&&!manual)rows.push([['📅 Выбрать в календаре','tripcalendar'],['✍️ Ввести дату','manualdate']]);
  if(compact&&sourceIndexes(s,field).length)rows.push([['🖼 Посмотреть источник','fieldsource_'+field]]);
  if(compact&&s.undo)rows.push([['↩️ Отменить последнюю правку','undo']]);
  rows.push([['⬅️ К сводке','review']],[['✖️ Отменить создание','cancel']]);
  const label=(labels[field]||compactFields[field]?.label||field).replace(/^[^А-Яа-яA-Za-z]+/u,'');
  const mode=s.pricing?'💰 Цены · '+({price:1,grossPrice:2,priceBasis:3,pricePeriod:4}[field]||4)+' из 4':s.completing?'📝 Заполнение':'✏️ Редактирование';
  if(['price','grossPrice'].includes(field))hint='✍️ Напишите сумму в USD сообщением.\n💬 Например: 1000'+(field==='price'?'\n🔒 Туристы эту цену не увидят.':'\n👀 Эту цену покажем туристам.')+(priceBases[s.draft.priceBasis]?'\n👥 '+priceBases[s.draft.priceBasis]+'.':'');
  if(field==='grossPrice'&&s.draft.price)hint+='\n💰 Цена для коллег: '+s.draft.price+' USD.';
  const text=mode+' → '+label+'\n\n📌 Сейчас: '+(field==='expiration'?expiryLabel(s.draft[field]):display(s.draft[field],field))+'\n\n'+hint+(s.pricing?'\n\n'+priceSummary(s.draft):'')+'\n\n'+(s.pricing?'➡️ Затем — следующий пункт цен.':compact&&field==='price'?'➡️ Затем — цена для туристов.':compact&&s.completing?'➡️ Затем — следующее поле.':'✅ После ввода вернёмся к сводке.');
  return render(ctx,s,(compact&&field==='expiration'&&saleExpired(s.draft,now())?expiryWarning(s.draft,now())+'\n\n':'')+text,keyboard(s.token,rows));
 }
 async function applyField(ctx,s,text){try{const editedField=s.field;const before={...s.draft};const value=compactFields[s.field]?validateCompact(s.field,text,s.draft):validateEdit(s.field,text,s.draft);if(compact)checkpoint(s,'изменение поля «'+(labels[s.field]||compactFields[s.field]?.label||s.field)+'»');setField(s,s.field,value);if(compact)s.changeLines=changes(before,s.draft);s.stage='review';delete s.previewConfirmed;delete s.field;if(compact&&s.pricing){const next={price:'grossPrice',grossPrice:'priceBasis',priceBasis:'pricePeriod',pricePeriod:'surcharges'}[s.pricing];if(next){s.pricing=next;return showField(ctx,s,next);}delete s.pricing;}if(compact&&editedField==='price')return showField(ctx,s,'grossPrice');if(compact&&s.completing)return accept(ctx,s);return showReview(ctx,s);}catch(e){return ctx.reply(e.message);}}
 function showParty(ctx,s){s.stage='party';return render(ctx,s,(s.category==='refused_flight'?'👥 Кто летит?':'👥 Кто едет?')+'\n\n👇 Выберите состав кнопками. Или напишите взрослые + дети + младенцы, например 2+1+0.',keyboard(s.token,[[['👤 1 взрослый','party_1'],['👥 2 взрослых','party_2']],[['👨‍👩‍👧 С детьми','party_children']],[['⬅️ К сводке','review']]]));}
 function childrenPanel(ctx,s){s.stage='partychildren';const p=s.partyChoice;return render(ctx,s,`👨‍👩‍👧 Состав семьи\nВзрослые: ${p.adt} · дети: ${p.chd} · младенцы: ${p.inf}\n\n👇 Выберите количество. Или напишите состав, например 2+1+0.`,keyboard(s.token,[Array.from({length:4},(_,i)=>[`${p.adt===i+1?'✓ ':''}${i+1} взр.`,`pc_adt_${i+1}`]),Array.from({length:5},(_,i)=>[`${p.chd===i?'✓ ':''}${i} дет.`,`pc_chd_${i}`]),Array.from({length:3},(_,i)=>[`${p.inf===i?'✓ ':''}${i} млад.`,`pc_inf_${i}`]),[['✅ Подтвердить состав','party_done']],[['⬅️ Назад','partyedit']]]));}
 async function setParty(ctx,s,p){if(p.adt<1||Object.values(p).some(n=>!Number.isInteger(n)||n<0)||p.adt+p.chd+p.inf>20)return ctx.reply('👥 Укажите от 1 до 20 туристов, включая хотя бы одного взрослого.');if(compact)checkpoint(s,'состав гостей');Object.assign(s.draft,p,{bookingPartyConfirmed:true});delete s.partyChoice;s.stage='review';return compact&&s.completing?accept(ctx,s):showReview(ctx,s);}
 function groupChoice(ctx,s){return render(ctx,s,groupText(bookingGroups(s)),keyboard(s.token,[[['🧩 Разделить на черновики','splitgroups']],[['🔗 Это одна бронь','onebooking']],[['🖼 Проверить скриншоты','files']]]));}
 function queuedPanel(ctx,s){return render(ctx,s,`✅ Текущий черновик сохранён. Осталось подготовить: ${s.queue.length}.\n📎 Завершите подтверждение текущей услуги, затем откройте следующую.`,keyboard(s.token,[[['➡️ Следующий черновик','nextbooking']],[['💾 Продолжить позже','pause']]]));}
 async function afterSave(ctx,s){if(!s.queue?.length){if(compact){const id=Number(ctx.session.awaitingProofForServiceId);const rows=Number.isSafeInteger(id)&&id>0?[[{text:'👀 Открыть черновик',url:`https://travella.uz/dashboard/services/marketplace?service_id=${id}&from=tg`}],[{text:'📎 Добавить подтверждение',callback_data:`proof:add_more:${id}`}],[{text:'➕ Создать ещё',callback_data:'booking:another'}]]:[];await render(ctx,s,`✅ Черновик${id>0?' #'+id:''} сохранён.\n\n${require('../../ai/bookingPricing').pricingText(s.draft)}\n\n📎 Осталось прикрепить подтверждение этой услуги.\n✅ Затем отправьте её на модерацию.`,{reply_markup:{inline_keyboard:rows}});}delete ctx.session.bookingImport;return;}const waiting={token:randomBytes(8).toString('hex'),expires:now()+30*86400000,category:s.category,files:[],warnings:[],conflicts:[],manualFields:[],stage:'queued',queue:s.queue,panelMessageId:s.panelMessageId};ctx.session.bookingImport=waiting;return queuedPanel(ctx,waiting);}
 async function accept(ctx,s){
  if(compact&&s.files.some(f=>!f.processed))return ctx.reply('🔎 Сначала распознайте добавленные скриншоты — данные уже сохранены.',keyboard(s.token,[[['🔎 Распознать','read']]]));
  if(compact&&bookingGroups(s).length>1&&s.singleBookingAck!==groupSignature(s.files))return groupChoice(ctx,s);
  if(s.conflicts.length)return showConflicts(ctx,s);
  if(s.warnings.some(w=>s.draft[w.field]!==undefined))return showReview(ctx,s);
  if(!s.draft.bookingPartyConfirmed){if(compact){s.completing=true;return showParty(ctx,s);}s.stage='party';return ctx.reply('👥 Сколько гостей едет?\nБез имён: взрослые + дети + младенцы. Например: 2+0+0.',keyboard(s.token,[[['⬅️ К проверке','review'],['❌ Отмена','cancel']]]));}
  if(compact&&saleExpired(s.draft,now())){s.completing=true;return showField(ctx,s,'expiration');}
  if(compact){const missing=pendingFields(s.draft).filter(k=>k!=='party');if(missing.length){s.completing=true;return showField(ctx,s,missing[0]);}delete s.completing;const issues=checks(s.draft);if(issues.length&&(issues.some(c=>c.hard)||s.checksAck!==checkSignature(s.draft))){s.stage='review';return ctx.reply('⚠️ Проверьте условия\n\n'+issues.map(c=>'• '+c.message).join('\n'),keyboard(s.token,[...(issues.some(c=>c.hard)?[]:[[['✅ Проверено, условия верны','ackchecks']]]),[['✏️ Исправить поля','edit']],[['⬅️ К сводке','review']]]));}if(s.previewConfirmed!==draftFingerprint(s.draft)){s.previewShown=draftFingerprint(s.draft);s.stage='review';if(s.draft.images?.length&&ctx.replyWithPhoto)await ctx.replyWithPhoto({source:Buffer.from(s.draft.images[0].split(',')[1],'base64')},{caption:'Фото публичной карточки'});return render(ctx,s,((s.changeLines||[]).filter(x=>x.startsWith('🧮 Итог:')).join('\n')+'\n\n'+previewText(s.draft)).trim().slice(0,4000),keyboard(s.token,[[['💾 Сохранить черновик','save']],[['✏️ Изменить','edit'],['⚙️ Условия','options']],[['📷 Фото карточки','publicphoto']],...(s.undo?[[['↩️ Отменить последнюю правку','undo']]]:[]),[['⬅️ К сводке','review']]]));}}
  let matches;try{matches=await findDuplicates(ctx,s.draft);}catch{return ctx.reply('🔄 Не удалось проверить похожие услуги. Данные сохранены — попробуйте подтвердить ещё раз чуть позже.');}
  const signature=duplicateSignature(s.draft,matches);
  if(matches.length&&s.duplicateAck!==signature){
   s.lastDuplicateSignature=signature;s.matches=matches;
   const extra=keyboard(s.token,[[['➕ Создать отдельный черновик','duplicate_continue']],[['⬅️ К проверке','review']]]);
   if(compact&&onUpdate)for(const m of matches.filter(m=>m.status==='draft'))extra.reply_markup.inline_keyboard.unshift([{text:`✏️ Обновить черновик #${m.id}`,callback_data:`booking:update_${m.id}:${s.token}`}]);
   for(const m of matches)extra.reply_markup.inline_keyboard.unshift([{text:`👀 Открыть #${m.id}`,url:`https://travella.uz/dashboard/services/marketplace?service_id=${m.id}&from=tg`}]);
   return ctx.reply('⚠️ Похожее предложение уже есть у вас\n\n'+matches.map(m=>`#${m.id} · ${String(m.title||'Без названия').slice(0,100)}`).join('\n')+'\n\n👇 Откройте найденную услугу, обновите черновик или создайте отдельный.',extra);
  }
  const fields=stepFieldsFor(s.category);
  const draft={...s.draft,bookingImportVersion:2,bookingDuplicateAcknowledged:signature,bookingSourceFiles:s.files.filter(f=>f.processed&&f.proofEligible!==false).map(f=>({id:f.id,kind:f.kind||'photo'})),bookingImportSkip:Object.entries(fields).filter(([,key])=>s.draft[key]!==undefined&&s.draft[key]!==null&&s.draft[key]!=='').map(([step])=>step)};
  if(compact)draft.bookingCompact=true;
  if(busy.has(ctx.from.id))return;busy.add(ctx.from.id);s.saving=true;try{await render(ctx,s,'💾 Сохраняю черновик…\n⏳ Дождитесь подтверждения.',{reply_markup:{inline_keyboard:[]}});await onAccept(ctx,draft,null);await afterSave(ctx,s);}finally{delete s.saving;busy.delete(ctx.from.id);}
 }
 function inputHint(s){
  if(s.stage==='field'){if(['price','grossPrice'].includes(s.field))return '💰 Сейчас нужна сумма. Напишите, например: 1000.';if(s.field?.endsWith('Date')||s.field==='expiration')return '📅 Введите дату: ДД.ММ.ГГГГ\n👇 Или выберите кнопкой.';if(s.field==='priceBasis'||s.field==='pricePeriod'||compactFields[s.field]?.boolean||s.field==='flightType')return '👇 Выберите ответ кнопкой под вопросом.';return '✍️ Сейчас нужно значение поля «'+(labels[s.field]||compactFields[s.field]?.label||'Данные')+'» — напишите его сообщением.';}
  if(['party','partychildren'].includes(s.stage))return '👥 Выберите состав кнопками.\n✍️ Или напишите: 2+0+0.';
  if(s.stage==='surcharges')return s.feeStep==='amount'?'💰 Напишите сумму доплаты. Например: 25.50.':s.feeStep==='name'?'✍️ Напишите название доплаты или выберите шаблон.':'👇 Выберите условие доплаты кнопкой.';
  if(s.stage==='calendar')return '📅 Выберите дату в календаре.\n✍️ Или введите: ДД.ММ.ГГГГ.';
  if(s.stage==='publicphoto')return '🖼 Пришлите фото отеля или направления.\n🔒 Без документов и личных данных.';
  if(s.stage==='reading')return '⏳ Обрабатываю скриншоты. Дождитесь результата.';
  if(['upload','consent','replacefile','quality'].includes(s.stage))return '📷 Пришлите скриншот бронирования.\n📎 Фото / JPG / PNG / WebP · до 6 МБ\n📄 PDF → скриншот страницы\n🔎 Затем нажмите «Распознать».';
  return '👇 Выберите действие в карточке.\n✏️ Исправить данные → «Другие поля».';
 }
 const handle=async(ctx,next)=>{
  if(ctx.chat?.type!=='private'||String(ctx.chat.id)!==String(ctx.from?.id))return next();
  const data=String(ctx.callbackQuery?.data||''),text=ctx.message?.text||'',command=/^\/frombooking(?:@\w+)?(?:\s|$)/i.test(text);
  const p=ctx.message?.photo?.at(-1),doc=ctx.message?.document;
  const file=p?{id:p.file_id,size:p.file_size,kind:'photo'}:doc&&['image/jpeg','image/png','image/webp'].includes(doc.mime_type)?{id:doc.file_id,size:doc.file_size,kind:'document'}:null;
  let s=active(ctx);
  if(s?.saving&&busy.has(ctx.from.id)){if(ctx.callbackQuery)await ctx.answerCbQuery('💾 Сохранение выполняется').catch(()=>{});return ctx.reply('💾 Сохраняю черновик. Дождитесь подтверждения.');}
  if(s&&/^\/(?!frombooking(?:@|\s|$))/.test(text)){if(compact)s.stage='paused';else delete ctx.session.bookingImport;return next();}
  const ownsInput=s&&s.stage!=='paused'&&!blocked(ctx);
  if(ownsInput&&/^(?:🏠 Главное меню|🧳 Мои услуги|👤 (?:Мой профиль|Профиль)|🆘 Поддержка)$/.test(text)){s.stage='paused';return next();}
  const unsupported=doc&&!file||['voice','audio','video','video_note','animation','sticker','contact','location','venue','poll'].some(key=>ctx.message?.[key]);
  if(ownsInput&&unsupported)return ctx.reply(inputHint(s)+'\n💾 Заполненные поля сохранены.');
  if(ownsInput&&file&&['field','party','partychildren','surcharges','calendar'].includes(s.stage))return ctx.reply(inputHint(s)+'\n📎 Новый скриншот → вернитесь к сводке.\n💾 Данные сохранены.');
  if(ownsInput&&text&&!command&&!['field','party','partychildren','surcharges','calendar'].includes(s.stage))return ctx.reply(inputHint(s)+'\n💾 Заполненные поля сохранены.');
  if(!data.startsWith('booking:')&&!command&&!file&&!(s&&['field','party','partychildren','surcharges','calendar'].includes(s.stage)&&text))return next();
  if(file&&blocked(ctx))return next();
  if(!await authorize(ctx))return file&&!s?next():ctx.reply('🔐 Создание по скриншоту доступно после подтверждения аккаунта поставщика.');
  s=active(ctx);
  if(data==='booking:another'){if(ctx.callbackQuery)await ctx.answerCbQuery().catch(()=>{});if(!s&&(!ctx.session.state||ctx.session.state==='svc_create_choose_category')&&!ctx.session.editingServiceId&&!ctx.session.editWiz&&!ctx.session.correctionFlow&&!ctx.session.companionFlow&&!ctx.session.galaFlow){ctx.session.awaitingProofForServiceId=null;ctx.session.awaitingProofForCategory=null;return showUpload(ctx,session(ctx));}return ctx.reply('💾 У вас уже есть незавершённое создание или редактирование. Завершите его либо откройте /frombooking.');}
  if(command||data==='booking:start'){if(compact&&s){if(s.stage==='queued')return queuedPanel(ctx,s);s.expires=now()+(compact?30*86400000:15*60000);s.token=randomBytes(8).toString('hex');s.resumeStage=s.stage;s.stage=s.draft?'review':'upload';return ctx.reply('💾 У вас есть сохранённое создание. Продолжить?'+(s.draft&&saleExpired(s.draft,now())?'\n\n'+expiryWarning(s.draft,now()):''),keyboard(s.token,[[['▶️ Продолжить','resume']],[['Начать заново','restart']]]));}if(ctx.callbackQuery)await ctx.answerCbQuery().catch(()=>{});if(blocked(ctx))return ctx.reply('✏️ Сначала завершите текущее редактирование. Ваш черновик сохранён.');return showUpload(ctx,session(ctx));}
  if(data.startsWith('booking:')){
   const token=data.split(':')[2];const clickedCategory=data.split(':')[1].startsWith('cat_')?data.split(':')[1].slice(4):null;const selected=s&&token===s.token&&s.expires>now()&&['upload','consent'].includes(s.stage)&&!blocked(ctx)&&categoryLabels[clickedCategory];await ctx.answerCbQuery(selected?'✅ '+selected:undefined).catch(()=>{});
   if(!s||token!==s.token||s.expires<=now())return ctx.reply('🔄 Эта кнопка устарела. Напишите /frombooking — откроем актуальное создание.');
   if(data.split(':')[1]==='cancel'){delete ctx.session.bookingImport;return ctx.reply('↩️ Распознавание отменено. Вернуться к созданию можно через «Мои услуги».');}
  }
  if(busy.has(ctx.from.id))return ctx.reply(s?.saving?'💾 Сохраняю черновик. Дождитесь подтверждения.':'⏳ Обрабатываю скриншоты. Дождитесь сводки.');
  if(file){
   if(file.size>6*1024*1024)return ctx.reply('📷 Изображение больше 6 МБ. Сожмите его или пришлите скриншот меньшего размера.');
   if(!s||s.expires<=now())s=session(ctx);
   if(compact&&s.stage==='replacefile'){const i=s.replaceIndex;if(!s.files[i])return ctx.reply('🖼 Этот скриншот уже убран. Откройте актуальный список.');checkpoint(s,'замена скриншота');s.sourceChangeBefore={...s.draft};s.files[i]=file;delete s.replaceIndex;rebuild(s);s.stage='consent';s.token=randomBytes(8).toString('hex');return showUpload(ctx,s);}
   if(compact&&s.stage==='publicphoto')return publicPhoto(ctx,s,file);
   if(s.files.some(f=>f.id===file.id))return ctx.reply('✅ Этот скриншот уже добавлен — повторно загружать не нужно.');
   if(s.files.length>=5)return ctx.reply('📎 Уже добавлено 5 скриншотов. Уберите лишний или замените его в разделе «Скриншоты».');
   if(compact)checkpoint(s,'добавление скриншота');s.files.push(file);delete s.previewShown;delete s.previewConfirmed;s.stage='consent';s.token=randomBytes(8).toString('hex');s.expires=now()+(compact?30*86400000:15*60000);return showUpload(ctx,s);
  }
  if(!s||s.expires<=now()){delete ctx.session.bookingImport;return ctx.reply('Начните заново: /frombooking');}
  if(data.startsWith('booking:pause:')&&s.stage==='queued')return ctx.reply('💾 Очередь черновиков сохранена. Напишите /frombooking, чтобы продолжить позже.');
  if(data.startsWith('booking:nextbooking:')&&s.stage==='queued'){if(blocked(ctx))return ctx.reply('Сначала завершите подтверждение текущей услуги или нажмите «Отменить отправку». Следующий черновик сохранён.');const [next,...rest]=s.queue;if(!next)return;const n={...next,token:randomBytes(8).toString('hex'),expires:now()+30*86400000,stage:'review',queue:rest,panelMessageId:s.panelMessageId};ctx.session.bookingImport=n;return showReview(ctx,n);}
  if(blocked(ctx))return ctx.reply('✏️ Сначала завершите текущее редактирование. Ваш черновик сохранён.');
  if(text&&s.stage==='surcharges')return surchargeFlow.handle(ctx,s,null,text);
  if(text&&s.stage==='calendar')return applyField(ctx,s,text);
  if(text&&s.stage==='field')return applyField(ctx,s,text);
  if(text&&['party','partychildren'].includes(s.stage)){const m=text.trim().match(/^(\d{1,2})\s*\+\s*(\d{1,2})\s*\+\s*(\d{1,2})$/);if(!m)return ctx.reply('👥 Выберите состав кнопками или напишите, например 2+1+0.');return setParty(ctx,s,{adt:+m[1],chd:+m[2],inf:+m[3]});}

  if(!data.startsWith('booking:'))return next();
  let action=data.split(':')[1];
  if(action==='noop')return;
  if(compact&&(action==='fees'||action.startsWith('fee_'))&&s.draft){if(action==='fees'){delete s.completing;delete s.pricing;return surchargeFlow.show(ctx,s);}return surchargeFlow.handle(ctx,s,action);}
  if(action.startsWith('period_')&&s.stage==='field'&&s.field==='pricePeriod')return applyField(ctx,s,action.slice(7));
  if(action.startsWith('fieldsource_')&&compact){const field=action.slice(12),indexes=sourceIndexes(s,field);if(!indexes.length)return ctx.reply('🖼 Для этого поля нет скриншота-источника.');for(const i of indexes){const f=s.files[i],caption='🖼 '+labels[field]+' · скриншот '+(i+1)+'\n🔎 Сверьте значение с карточкой.\n🔒 Просмотр — в личном чате.';if(f.kind==='document')await ctx.replyWithDocument(f.id,{caption});else await ctx.replyWithPhoto(f.id,{caption});}return;}
  if(action==='edit'||action==='partyedit'||action.startsWith('fix_')||action.startsWith('extra_'))delete s.pricing;
  if(action==='prices'&&compact&&s.draft){delete s.completing;s.pricing='price';return showField(ctx,s,'price');}
  if(action==='pick_RO'||action.startsWith('pick_')){const value=action.slice(5),allowed=s.field==='food'?['RO','BB','HB','FB','AI','UAI']:s.field==='accommodation'?['SGL','DBL','TRPL','QDRPL']:[];if(s.stage==='field'&&allowed.includes(value))return applyField(ctx,s,value);return;}
  if((action==='tripcalendar'||action.startsWith('tripmonth_'))&&s.field?.endsWith('Date')){s.stage='calendar';const month=action==='tripcalendar'?(s.draft[s.field]||localDay(now())).slice(0,7):action.slice(10);return render(ctx,s,'📅 '+labels[s.field]+'\nВыберите дату. Недоступные дни отмечены «—».',keyboard(s.token,calendarRows(month,s.draft,now(),s.field)));}
  if(action.startsWith('tripday_')&&s.stage==='calendar'&&s.field?.endsWith('Date'))return applyField(ctx,s,action.slice(8));
  if(action==='manualdate'&&s.field?.endsWith('Date'))return showField(ctx,s,s.field,true);
  if(action==='partyedit'){delete s.completing;return showParty(ctx,s);}
  if(action==='party_children'&&s.stage==='party'){s.partyChoice={adt:2,chd:1,inf:0};return childrenPanel(ctx,s);}
  if(/^party_[12]$/.test(action)&&s.stage==='party')return setParty(ctx,s,{adt:Number(action.slice(6)),chd:0,inf:0});
  if(action.startsWith('pc_')&&s.stage==='partychildren'){const [,key,n]=action.split('_');if(!['adt','chd','inf'].includes(key)||!/^\d$/.test(n)||key==='adt'&&+n<1)return;s.partyChoice[key]=+n;return childrenPanel(ctx,s);}
  if(action==='party_done'&&s.stage==='partychildren')return setParty(ctx,s,s.partyChoice);
  if(action.startsWith('expiry_')&&s.field==='expiration'){try{const value=action==='expiry_none'?null:expiryChoice(action.slice(7),s.draft,now());checkpoint(s,'срок актуальности');setField(s,'expiration',value);s.changeLines=['⏳ Актуально до: '+expiryLabel(value)];delete s.field;delete s.previewConfirmed;s.stage='review';return s.completing?accept(ctx,s):showReview(ctx,s);}catch(e){return ctx.reply(e.message);}}
  if((action==='expirycalendar'||action.startsWith('calmonth_'))&&s.field==='expiration'){s.stage='calendar';const month=action==='expirycalendar'?localDay(now()).slice(0,7):action.slice(9);return render(ctx,s,'📅 Выберите последний день продажи\nДо 23:59 по Ташкенту. Даты после начала поездки недоступны.',keyboard(s.token,calendarRows(month,s.draft,now())));}
  if(action.startsWith('expday_')&&s.field==='expiration')return applyField(ctx,s,action.slice(7));
  if(action==='manualexpiry'&&s.field==='expiration')return showField(ctx,s,'expiration',true);
  if(action==='onebooking'){for(const f of s.files)for(const d of f.recognition?.bookingOffers||[])mergeRecognition(s,d,s.files.indexOf(f)+1);s.singleBookingAck=groupSignature(s.files);s.stage='review';return showReview(ctx,s);}
  if(action==='splitgroups'){const groups=splitGroups(s);if(groups.length<2)return showReview(ctx,s);checkpoint(s,'разделение броней');const keepUndo=s.undo;const [first,...rest]=groups;Object.assign(s,first,{queue:[...rest,...(s.queue||[])],stage:'review',undo:keepUndo,token:randomBytes(8).toString('hex')});delete s.previewConfirmed;delete s.previewShown;delete s.singleBookingAck;delete s.sourceChangeBefore;delete s.updatePending;s.changeLines=['🧩 Отдельный черновик: проверьте цену, состав и срок.'];return showReview(ctx,s);}
  if(action==='undo' &&compact){if(!undo(s))return ctx.reply('↩️ Пока нет правки, которую можно отменить.');s.token=randomBytes(8).toString('hex');return s.draft?showReview(ctx,s):showUpload(ctx,s);}
  if(action==='retryphoto'&&compact&&s.photoRetry)return publicPhoto(ctx,s,s.photoRetry);
  if(action.startsWith('retry_')){const f=s.files[Number(action.slice(6))];if(!f?.error)return;delete f.error;s.stage='consent';rates.delete(ctx.from.id);action='read';}
  if(action.startsWith('qualitygo_')){const f=s.files[Number(action.slice(10))];if(!f?.quality?.issues?.length)return;f.qualityAck=true;s.stage='consent';rates.delete(ctx.from.id);action='read';}
  if(action==='upload'){s.stage='consent';return showUpload(ctx,s);}
  if(action==='restart')return showUpload(ctx,session(ctx));
  if(action==='resume'){if(s.resumeStage==='surcharges'){delete s.resumeStage;s.stage='surcharges';return s.feeDraft?surchargeFlow.step(ctx,s):surchargeFlow.show(ctx,s);}if(s.resumeStage==='queued'||s.stage==='queued')return queuedPanel(ctx,s);if(s.resumeStage==='replacefile'&&s.files[s.replaceIndex]){s.stage='replacefile';return ctx.reply('🔄 Пришлите новый скриншот — он заменит выбранный. Остальные данные сохранятся.',keyboard(s.token,[[['⬅️ К сводке','review']]]));}if(s.resumeStage==='field'&&s.field){delete s.resumeStage;return showField(ctx,s,s.field);}if(s.resumeStage==='party'){delete s.resumeStage;return accept(ctx,s);}delete s.resumeStage;return s.draft?showReview(ctx,s):showUpload(ctx,s);}
  if(action==='pause')return ctx.reply('💾 Прогресс сохранён. Чтобы продолжить с этого места, нажмите кнопку или отправьте /frombooking.',keyboard(s.token,[[['▶️ Продолжить','resume']]]));
  if(action.startsWith('cat_')&&['upload','consent'].includes(s.stage)){
   const cat=action.slice(4);if(!categoryLabels[cat])return;s.categoryConfirmed=true;
   if(s.category!==cat){if(compact)checkpoint(s,'смена категории');s.category=cat;s.files.forEach(f=>{delete f.processed;delete f.recognition;});delete s.draft;s.warnings=[];s.conflicts=[];s.manualFields=[];delete s.duplicateAck;}
   s.token=randomBytes(8).toString('hex');return showUpload(ctx,s);
  }
  if(action==='read'&&['upload','consent','review'].includes(s.stage)){
   const last=rates.get(ctx.from.id);if(last&&now()-last<30000)return ctx.reply('⏳ Повторить распознавание можно через 30 секунд. Данные сохранены.');
   rates.set(ctx.from.id,now());if(rates.size>2000)for(const [id,t]of rates)if(now()-t>60000)rates.delete(id);
   const before={...(s.sourceChangeBefore||s.draft)};const pending=s.files.filter(f=>!f.processed);if(!pending.length)return s.draft?showReview(ctx,s):showUpload(ctx,s);
   busy.add(ctx.from.id);s.stage='reading';let readCheckpoint=false;
   try{
    for(const f of pending){if(active(ctx)!==s)return;const i=s.files.indexOf(f);await render(ctx,s,`🔎 Проверяю скриншот ${i+1} из ${s.files.length}…`);try{
     const bytes=await loadImage(ctx,f.id);
     if(inspectQuality&&!f.quality){try{f.quality=await inspectQuality(bytes);}catch{f.quality={issues:['🔎 Не удалось оценить читаемость. Проверьте, что текст крупный и чёткий.']};}}
     if(f.quality?.issues?.length&&!f.qualityAck){s.stage='quality';return render(ctx,s,`⚠️ Скриншот ${i+1}: проверьте качество\n\n`+f.quality.issues.join('\n')+'\n\n🔄 Лучше прислать более чёткое изображение. Или продолжите с текущим.',keyboard(s.token,[[['🔄 Заменить',`replace_${i}`]],[['🔎 Распознать текущий',`qualitygo_${i}`]],[['🖼 Все скриншоты','files']],[['❌ Отмена','cancel']]]));}
     await render(ctx,s,`🔎 Распознаю скриншот ${i+1} из ${s.files.length}…`);const d=await read(bytes,s.category);if(active(ctx)!==s)return;if(compact&&!readCheckpoint){checkpoint(s,'распознавание скриншотов');readCheckpoint=true;}mergeRecognition(s,d,i+1);f.recognition=d;f.processed=true;delete f.error;
    }catch(e){f.error=imageError(e);await ctx.reply(`⚠️ Скриншот ${i+1}: ${f.error} Остальные поля сохранены.`,keyboard(s.token,[[['🔄 Повторить',`retry_${i}`],['Заменить',`replace_${i}`]],[['🖼 Все скриншоты','files']]]));}}

    if(active(ctx)!==s)return;
    if(!s.draft){s.stage='consent';return ctx.reply('📷 Пришлите более чёткий скриншот или нажмите «🔄 Повторить» у нужного изображения.');}
    if(compact&&bookingGroups(s).length>1&&s.singleBookingAck!==groupSignature(s.files)){s.stage='review';s.token=randomBytes(8).toString('hex');return groupChoice(ctx,s);}
    s.changeLines=changes(before,s.draft,s.conflicts);if(s.files.every(f=>f.processed))delete s.sourceChangeBefore;s.stage='review';s.token=randomBytes(8).toString('hex');return showReview(ctx,s);
   }finally{busy.delete(ctx.from.id);}
  }
  if(action==='review'&&s.draft){delete s.feeDraft;delete s.feeStep;delete s.pricing;delete s.completing;delete s.previewConfirmed;s.stage='review';delete s.previewConfirmed;delete s.field;return showReview(ctx,s,true);}
  if(action.startsWith('basis_')&&s.stage==='field'&&s.field==='priceBasis')return applyField(ctx,s,action.slice(6));
  if(compact&&action==='files')return ctx.reply('🖼 Скриншоты брони\n👇 Выберите файл: посмотреть, заменить или убрать.\n💾 Правки и цены сохранятся.',keyboard(s.token,[...s.files.map((f,i)=>[[`${i+1}. ${f.error?'Ошибка обработки':f.processed?'Распознан':'Ожидает распознавания'}`,`file_${i}`]]),[['⬅️ Назад',s.draft?'review':'upload']]]));
  if(compact&&action.startsWith('file_')){const i=Number(action.slice(5));if(!s.files[i])return;return ctx.reply(`🖼 Скриншот ${i+1}`,keyboard(s.token,[...(s.files[i].error?[[['🔄 Повторить обработку',`retry_${i}`]]]:[]),[['👁 Посмотреть',`sourceview_${i}`]],[['🔄 Заменить',`replace_${i}`],['🗑 Убрать',`remove_${i}`]],[['⬅️ Скриншоты','files']]]));}
  if(compact&&action.startsWith('sourceview_')){const f=s.files[Number(action.slice(11))];if(!f)return;return f.kind==='document'?ctx.replyWithDocument(f.id):ctx.replyWithPhoto(f.id);}
  if(compact&&action.startsWith('replace_')){const i=Number(action.slice(8));if(!s.files[i])return;s.replaceIndex=i;s.stage='replacefile';return ctx.reply('🔄 Пришлите новый скриншот — он заменит выбранный. Остальные данные сохранятся.',keyboard(s.token,[[['⬅️ К сводке','review']]]));}
  if(compact&&action.startsWith('remove_')){const i=Number(action.slice(7));if(!s.files[i])return;return ctx.reply(`🗑 Убрать скриншот ${i+1}? 📝 Данные только с этого изображения уберём из сводки. Ручные правки сохранятся.`,keyboard(s.token,[[['🗑 Да, убрать',`drop_${i}`]],[['Отмена','files']]]));}
  if(compact&&action.startsWith('drop_')){const i=Number(action.slice(5));if(!s.files[i])return;checkpoint(s,'удаление скриншота');s.files.splice(i,1);rebuild(s);s.token=randomBytes(8).toString('hex');s.stage=s.files.some(f=>!f.processed)?'consent':'review';return s.stage==='consent'||!s.files.length?showUpload(ctx,s):showReview(ctx,s);}
  if(action.startsWith('value_')&&s.stage==='field')return applyField(ctx,s,({value_yes:'да',value_no:'нет',value_one:'в одну сторону',value_round:'туда-обратно',value_unknown:'не знаю'})[action]||'');
  if(compact&&action==='accept'&&s.stage==='consent')return ctx.reply('🔎 Сначала распознайте добавленные скриншоты — данные уже сохранены.',keyboard(s.token,[[['🔎 Распознать','read']]]));
  if(s.stage!=='review')return;
  if(action==='publicphoto'&&compact){s.stage='publicphoto';return ctx.reply('🖼 Пришлите фото отеля или направления.\n🔒 Без документов и личных данных.',keyboard(s.token,[[['⬅️ К сводке','review']]]));}
  if(action==='ackchecks'&&compact){if(checks(s.draft).some(c=>c.hard))return showReview(ctx,s);s.checksAck=checkSignature(s.draft);return accept(ctx,s);}
  if(action==='save'&&compact){if(s.previewShown!==draftFingerprint(s.draft))return showReview(ctx,s);s.previewConfirmed=s.previewShown;return accept(ctx,s);}
  if(action==='options'&&compact){delete s.completing;return swap(ctx,'⚙️ Дополнительные условия\n👇 Укажите только известные условия. Если сомневаетесь, выберите «Не знаю».\n🎉 Гала-ужин и поиск попутчика доступны после сохранения.',keyboard(s.token,[...Object.entries(compactFields).filter(([,v])=>v.optional&&(s.category!=='refused_flight'||v.flight)).map(([k,v])=>[v.label,'extra_'+k]).reduce((rows,button,i)=>{if(i%2===0)rows.push([]);rows.at(-1).push(button);return rows;},[]),[['⬅️ К сводке','review']]]));}
  if(action.startsWith('extra_')&&compact){const field=action.slice(6);if(compactFields[field])return showField(ctx,s,field);return;}
  if((action.startsWith('update_')||action.startsWith('commitupdate_'))&&compact&&onUpdate){
   if(s.previewConfirmed!==draftFingerprint(s.draft)||requiredMissing(s.draft).length||checks(s.draft).some(c=>c.hard))return showReview(ctx,s);
   const id=Number(action.split('_')[1]),matches=await findDuplicates(ctx,s.draft);if(!matches.some(m=>Number(m.id)===id&&m.status==='draft'))return ctx.reply('🔄 Этот черновик больше нельзя обновить. Вернитесь к сводке и проверьте актуальную карточку.');
   if(loadUpdate){const current=await loadUpdate(ctx,id,s.draft),p=s.updatePending;if(!action.startsWith('commitupdate_')||!p||p.id!==id||p.version!==current.version||p.draftHash!==draftFingerprint(s.draft)){s.updatePending={id,version:current.version,draftHash:draftFingerprint(s.draft)};return ctx.reply(current.text+(action.startsWith('commitupdate_')?'\n🔄 Карточка изменилась после просмотра. Сравните значения ещё раз.':''),keyboard(s.token,[[['✅ Подтвердить обновление',`commitupdate_${id}`]],[['⬅️ К сводке','review']]]));}}
   if(busy.has(ctx.from.id))return;busy.add(ctx.from.id);s.saving=true;try{await render(ctx,s,'💾 Обновляю черновик…\n⏳ Дождитесь подтверждения.',{reply_markup:{inline_keyboard:[]}});await onUpdate(ctx,id,s.draft,s.files.filter(f=>f.processed&&f.proofEligible!==false),s.updatePending?.version);await afterSave(ctx,s);}finally{delete s.saving;busy.delete(ctx.from.id);}return;
  }

  if(action==='add')return ctx.reply('📎 Пришлите следующий скриншот этой брони. Уже распознанные данные сохранятся.');
  if(action==='ackwarnings'){s.warnings=s.warnings.filter(w=>s.draft[w.field]===undefined);return showReview(ctx,s,true);}
  if(action==='conflicts')return showConflicts(ctx,s);
  if(action.startsWith('conflict_')){
   const i=Number(action.slice(9)),c=s.conflicts[i];if(!c)return;
   const fieldStep=editableBookingSteps(s.draft).find(([,key])=>key===c.field)?.[0];
   return ctx.reply(`⚠️ ${labels[c.field]}\n\n`+c.values.map((v,n)=>`${n+1}. ${display(v.value,c.field).slice(0,200)} (скриншот ${v.source})`).join('\n'),keyboard(s.token,[...c.values.map((v,n)=>[[`${n+1}. Выбрать вариант`,`choose_${i}_${n}`],['👁 Посмотреть',`view_${i}_${n}`]]),...(fieldStep?[[['✏️ Ввести вручную','fix_'+fieldStep]]]:[]),[['⬅️ К проверке','review']]]));
  }
  if(action.startsWith('view_')){const [,i,n]=action.split('_'),c=s.conflicts[Number(i)],v=c?.values[Number(n)];if(v)return ctx.reply(`${labels[c.field]} · вариант ${Number(n)+1}\nСкриншот ${v.source}\n\n${display(v.value,c.field).slice(0,3600)}`);return;}
  if(action.startsWith('choose_')){const [,i,n]=action.split('_'),c=s.conflicts[Number(i)],v=c?.values[Number(n)];if(!v)return;try{const checked=validateEdit(c.field,typeof v.value==='boolean'?(v.value?'да':'нет'):String(v.value),s.draft);const before={...s.draft};if(compact)checkpoint(s,'выбор значения «'+labels[c.field]+'»');setField(s,c.field,checked);if(compact)s.changeLines=changes(before,s.draft);return showReview(ctx,s);}catch(e){return ctx.reply(e.message);}}
  if(action.startsWith('fix_')){delete s.completing;delete s.previewConfirmed;const step=action.slice(4);const entry=editableBookingSteps(s.draft).find(([st])=>st===step);if(!entry)return;return showField(ctx,s,entry[1]);}
  if(action==='edit'){delete s.completing;delete s.previewConfirmed;return swap(ctx,'✏️ Исправить данные\n\n👇 Выберите поле, которое нужно изменить. После ввода покажем обновлённую сводку.',keyboard(s.token,[...bookingEditRows(s.draft).slice(0,-2),...(compact?[[['💰 Цена для коллег','extra_price'],['💵 Цена для туристов','extra_grossPrice']],[['⏳ Срок актуальности','extra_expiration'],['💵 За что цена','extra_priceBasis']],[['⏱ Период цены','extra_pricePeriod'],['➕ Доплаты','fees']],[['👥 Состав гостей','partyedit']]]:[]),...bookingEditRows(s.draft).slice(-2)]));}
  if(action==='duplicate_continue'){s.duplicateAck=s.lastDuplicateSignature;return accept(ctx,s);}
  if(action==='accept')return accept(ctx,s);
 };
 return async(ctx,next)=>{
  if(!compact||!store||ctx.chat?.type!=='private'||String(ctx.chat.id)!==String(ctx.from?.id))return handle(ctx,next);
  const relevant=String(ctx.callbackQuery?.data||'').startsWith('booking:')||/^\/frombooking(?:@|\s|$)/i.test(ctx.message?.text||'')||ctx.session?.bookingImport;
  if(!relevant)return handle(ctx,next);
  try{if(!await authorize(ctx))return handle(ctx,next);if(!ctx.session.bookingImport){const saved=await store.load(ctx.from.id);if(saved){delete saved.saving;if(saved.stage==='reading')saved.stage=saved.draft?'review':'consent';ctx.session.bookingImport=saved;}}try{await handle(ctx,next);}finally{await store.save(ctx.from.id,ctx.session.bookingImport||null);}}catch(e){const s=active(ctx);await ctx.reply(e?.message==='DRAFT_CHANGED'?'Карточка изменилась. Сравните изменения перед обновлением ещё раз.':'🔄 Не удалось завершить действие.\n💾 Заполненные поля сохранены — откройте сводку и попробуйте ещё раз.',s?keyboard(s.token,[[['⬅️ Открыть сводку','review']]]):undefined);}
 };
}
module.exports={createBookingScreenshotFlow};
