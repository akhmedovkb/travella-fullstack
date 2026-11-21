const {randomBytes}=require('node:crypto');
const {createBookingReader,stepFieldsFor}=require('../../ai/bookingScreenshot');
const categoryLabels={refused_tour:'Отказной тур',refused_hotel:'Отказной отель',refused_flight:'Отказной авиабилет'};
const labels={departureFlightDate:'Дата вылета',returnFlightDate:'Дата обратного рейса',flightType:'Тип перелёта',country:'Страна',fromCity:'Город вылета',toCity:'Город прибытия',startDate:'Начало',endDate:'Окончание',hotel:'Отель',accommodation:'Размещение',roomCategory:'Номер',food:'Питание',transferIncluded:'Трансфер',insuranceIncluded:'Страховка',flightDetails:'Перелёты'};
async function downloadImage(ctx,id){
 const link=await ctx.telegram.getFileLink(id);const response=await fetch(link,{signal:AbortSignal.timeout(20000)});
 if(!response.ok||Number(response.headers.get('content-length')||0)>6*1024*1024)throw new Error('IMAGE_DOWNLOAD');
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>6*1024*1024)throw new Error('IMAGE_SIZE');chunks.push(chunk);}return Buffer.concat(chunks);
}
function createBookingScreenshotFlow({authorize,onAccept,read=createBookingReader(),loadImage=downloadImage,now=Date.now}={}){
 const busy=new Set(),rates=new Map();
 const keyboard=(token,rows)=>({reply_markup:{inline_keyboard:rows.map(row=>row.map(([text,action])=>({text,callback_data:`booking:${action}:${token}`})))}});
 const notice='📷 Создать услугу по скриншоту бронирования\n\nПришлите один скриншот или изображение файлом до 6 МБ. Перед отправкой закройте ФИО, даты рождения, паспорта и контакты туристов.\n\nПо кнопке «Распознать» изображение будет обработано ИИ OpenAI. Оно не станет публичным фото или подтверждением автоматически.\n\nБот покажет данные для проверки и спросит недостающее. Выберите категорию: тур, отель или авиабилет.';
 const active=ctx=>ctx.session?.bookingImport;
 const blocked=ctx=>ctx.session?.editingServiceId||ctx.session?.editWiz||ctx.session?.awaitingProofForServiceId||ctx.session?.correctionFlow||ctx.session?.companionFlow||ctx.session?.galaFlow||(ctx.session?.state&&ctx.session.state!=='svc_create_choose_category');
 async function offer(ctx,file,category=active(ctx)?.category||'refused_tour'){
  const s={token:randomBytes(8).toString('hex'),expires:now()+15*60000,file,category,stage:file?'consent':'upload'};ctx.session.bookingImport=s;
  return ctx.reply(notice+'\n\nВыбрано: '+categoryLabels[category],keyboard(s.token,[[['📍 Тур','cat_refused_tour'],['🏨 Отель','cat_refused_hotel'],['✈️ Авиабилет','cat_refused_flight']],[...(file?[['🔎 Распознать','read']]:[])],[['❌ Отмена','cancel']]].filter(r=>r.length)));
 }
 return async(ctx,next)=>{
  if(ctx.chat?.type!=='private'||ctx.chat.id!==ctx.from?.id)return next();
  const data=String(ctx.callbackQuery?.data||''),command=/^\/frombooking(?:@\w+)?(?:\s|$)/i.test(ctx.message?.text||'');
  const photo=ctx.message?.photo?.at(-1),doc=ctx.message?.document;
  const file=photo?{id:photo.file_id,size:photo.file_size}:doc&&['image/jpeg','image/png','image/webp'].includes(doc.mime_type)?{id:doc.file_id,size:doc.file_size}:null;
  const s=active(ctx);
  if(s&&/^\/(?!frombooking(?:@|\s|$))/.test(ctx.message?.text||'')){delete ctx.session.bookingImport;return next();}
  if(!data.startsWith('booking:')&&!command&&!file&&!(s?.stage==='party'&&ctx.message?.text))return next();
  if(file&&blocked(ctx))return next();
  if(!await authorize(ctx))return file&&!s?next():ctx.reply('Создание по скриншоту доступно подтверждённым поставщикам.');
  if(command||data==='booking:start'){
   if(ctx.callbackQuery)await ctx.answerCbQuery().catch(()=>{});
   if(blocked(ctx))return ctx.reply('Сначала завершите или отмените текущее редактирование. Сохранённый черновик не будет заменён.');
   return offer(ctx);
  }
  if(busy.has(ctx.from.id)){if(ctx.callbackQuery)await ctx.answerCbQuery('Уже распознаю изображение.').catch(()=>{});return;}
  if(file){
   if(file.size>6*1024*1024)return ctx.reply('Изображение слишком большое. Пришлите файл до 6 МБ.');
   return offer(ctx,file);
  }
  if(s?.stage==='party'&&ctx.message?.text){
   if(s.expires<=now()){delete ctx.session.bookingImport;return ctx.reply('Начните заново: /frombooking');}
   const m=ctx.message.text.trim().match(/^(\d{1,2})\s*\+\s*(\d{1,2})\s*\+\s*(\d{1,2})$/);
   if(!m||Number(m[1])<1||m.slice(1).reduce((n,v)=>n+Number(v),0)>20)return ctx.reply('Введите состав без имён: взрослые + дети + младенцы. Например: 2+0+0.');
   Object.assign(s.draft,{adt:Number(m[1]),chd:Number(m[2]),inf:Number(m[3]),bookingPartyConfirmed:true});
   s.stage='review';return ctx.reply(`Состав подтверждён: ${m[1]} взрослых, ${m[2]} детей, ${m[3]} младенцев.`,keyboard(s.token,[[['✅ Продолжить','accept']],[['❌ Отмена','cancel']]]));
  }
  if(!data.startsWith('booking:'))return next();
  await ctx.answerCbQuery().catch(()=>{});
  const [,action,token]=data.split(':');
  if(!s||s.token!==token||s.expires<=now())return ctx.reply('Эта кнопка устарела. Начните заново: /frombooking');
  if(action.startsWith('cat_')&&['upload','consent'].includes(s.stage)){const cat=action.slice(4);if(!categoryLabels[cat])return;return offer(ctx,s.file,cat);}
  if(action==='cancel'){delete ctx.session.bookingImport;return ctx.reply('Распознавание отменено.');}
  if(blocked(ctx))return ctx.reply('Сначала завершите текущее редактирование. Черновик не заменён.');
  if(action==='read'&&s.stage==='consent'){
   const last=rates.get(ctx.from.id);if(last&&now()-last<30000)return ctx.reply('Подождите полминуты перед новым распознаванием.');
   rates.set(ctx.from.id,now());if(rates.size>2000)for(const [id,t]of rates)if(now()-t>60000)rates.delete(id);
   busy.add(ctx.from.id);s.stage='reading';
   try{
    await ctx.reply('🔎 Распознаю бронирование…');
    const draft=await read(await loadImage(ctx,s.file.id),s.category);
    if(active(ctx)!==s)return;
    s.draft=draft;s.stage='review';delete s.file;
    const lines=Object.entries(labels).filter(([k])=>draft[k]!==undefined).map(([k,l])=>`${l}: ${k==='flightType'?({one_way:'В одну сторону',round_trip:'Туда-обратно'}[draft[k]]):typeof draft[k]==='boolean'?(draft[k]?'Да':'Нет'):(['startDate','endDate','departureFlightDate','returnFlightDate'].includes(k)?draft[k].split('-').reverse().join('.'):draft[k])}`);
    return ctx.reply('Проверьте распознанные данные\nКатегория: '+categoryLabels[s.category]+'\n\n'+lines.join('\n')+'\n\nЭто ещё не опубликованная услуга. '+(s.category==='refused_flight'?'Состав пассажиров, цены и условия нужно подтвердить отдельно.':'Состав туристов, цены, условия и гала-ужин нужно подтвердить отдельно.')+' Неуказанное бот спросит дальше.',keyboard(token,[[['✅ Всё верно','accept']],[['✏️ Исправить','edit']],[['❌ Отмена','cancel']]]));
   }catch{s.stage='consent';return ctx.reply('Не удалось распознать бронирование. Пришлите более чёткое изображение или создайте услугу вручную.');}
   finally{busy.delete(ctx.from.id);}
  }
  if(s.stage!=='review')return;
  const stepFields=stepFieldsFor(s.category);
  if(action==='edit')return ctx.reply('Какое поле исправить?',keyboard(token,[...Object.entries(stepFields).filter(([,k])=>labels[k]).map(([step,k])=>[[labels[k],'fix_'+step]]),[['✅ Всё верно','accept']],[['❌ Отмена','cancel']]]));
  if(action==='accept'||action.startsWith('fix_')){
   const step=action.startsWith('fix_')?action.slice(4):s.editStep||null;
   if(step&&!stepFields[step])return;
   if(!s.draft.bookingPartyConfirmed){s.editStep=step;s.stage='party';return ctx.reply('Сколько туристов едет? Количество билетов и DBL не определяют состав группы.\n\nВведите без имён: взрослые + дети + младенцы.\nНапример: 2+0+0 — двое взрослых без детей.',keyboard(token,[[['❌ Отмена','cancel']]]));}
   const draft={...s.draft,...(step?{bookingImportEditingStep:step}:{}),bookingImportSkip:Object.entries(stepFields).filter(([st,k])=>st!==step&&s.draft[k]!==undefined).map(([st])=>st)};
   delete ctx.session.bookingImport;
   return onAccept(ctx,draft,step);
  }
 };
}
module.exports={createBookingScreenshotFlow};
