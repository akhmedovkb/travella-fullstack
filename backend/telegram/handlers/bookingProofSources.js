const {randomBytes,createHash}=require('node:crypto');
const {combine,reportText,fingerprint}=require('../../ai/proofMatch');
const hash=files=>createHash('sha256').update(JSON.stringify(files)).digest('hex');
function createBookingProofSources({pool,resolveOwner,loadImage,onAttached,inspectImage,redact=require('../../ai/proofPrivacy').redactImages,now=Date.now}){
 let ready;const busy=new Set();
 const initialize=()=>ready||(ready=pool.query(`CREATE TABLE IF NOT EXISTS telegram_booking_proof_sources (
 service_id BIGINT PRIMARY KEY,actor_id BIGINT NOT NULL,files JSONB NOT NULL,used BOOLEAN NOT NULL DEFAULT false,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '30 days')`).catch(e=>{ready=null;throw e;}));
 async function owned(ctx,id,db=pool,lock=false){
  const providerId=await resolveOwner(ctx,id);
  const r=await db.query(`SELECT id,category,status,moderation_status,details,title FROM services WHERE id=$1 AND provider_id=$2 AND deleted_at IS NULL${lock?' FOR UPDATE':''}`,[id,providerId]);
  const row=r.rows[0];if(!row||row.status!=='draft'||row.moderation_status==='pending')throw Error('NOT_EDITABLE');return {row,providerId};
 }
 async function source(ctx,id,db=pool,lock=false){await initialize();const r=await db.query(`SELECT files,used FROM telegram_booking_proof_sources WHERE service_id=$1 AND actor_id=$2 AND expires_at>NOW()${lock?' FOR UPDATE':''}`,[id,ctx.from.id]);if(!r.rows[0])throw Error('SOURCE_UNAVAILABLE');return r.rows[0];}
 function matchPrompt(ctx,id,review){return ctx.reply(reportText(review.matchReport)+'\n\nЕсли документ относится к другой услуге, не прикрепляйте его: исправьте карточку или загрузите другое подтверждение.',{reply_markup:{inline_keyboard:[[{text:'Открыть карточку',url:`https://travella.uz/dashboard/services/marketplace?service_id=${id}&from=tg`}],[{text:'Условия вручную проверены',callback_data:`bookingproof:matchack:${id}:${review.token}`}],[{text:'Не прикреплять',callback_data:`bookingproof:cancel:${id}:${review.token}`}]]}});}
 const flow=async(ctx,next)=>{
  const data=String(ctx.callbackQuery?.data||'');if(!data.startsWith('bookingproof:'))return next();
  if(ctx.chat?.type!=='private'||String(ctx.chat.id)!==String(ctx.from?.id))return;
  await ctx.answerCbQuery().catch(()=>{});const [,action,idText,token]=data.split(':');const id=Number(idText);
  if(!Number.isSafeInteger(id)||id<=0)return;
  if(ctx.session?.serviceDraft&&/^(svc_create_|svc_hotel_|svc_author_)/.test(ctx.session.state||''))return ctx.reply('Сначала завершите или сохраните текущее создание услуги. Исходные подтверждения останутся доступны.');
  if(busy.has(ctx.from.id))return;busy.add(ctx.from.id);
  try{
   const {row,providerId}=await owned(ctx,id);const saved=await source(ctx,id);
   if(saved.used)return ctx.reply('Эти скриншоты уже прикреплены. Повторно не добавляю.');
   if(action==='preview'){delete ctx.session.bookingProofReview;
    const files=saved.files;
    for(let i=0;i<files.length;i++){
     const send=files[i].kind==='document'?ctx.replyWithDocument?.bind(ctx):ctx.replyWithPhoto?.bind(ctx);
     if(!send||!await send(files[i].id,{caption:`Скриншот ${i+1} из ${files.length}. Проверьте: ФИО, даты рождения, документы, QR-коды и данные оплаты должны быть скрыты.`}))throw Error('PREVIEW_UNAVAILABLE');
    }
    const privacy=[];const images=[];
    if(inspectImage){for(let i=0;i<files.length;i++){await ctx.reply(`🔎 Проверяю возможные личные данные: ${i+1} из ${files.length}…`);let image;try{image=await loadImage(files[i].id);const result=await inspectImage(image,row);privacy.push(result);images.push(image);}catch{privacy.push({status:'unavailable',boxes:[]});images.push(null);}}}
    const flagged=privacy.some(r=>r.status==='detected'||r.status==='uncertain'),canRedact=flagged&&privacy.every(r=>['clear','detected'].includes(r.status))&&images.every(Boolean);
    const reviewToken=randomBytes(8).toString('hex');ctx.session.bookingProofReview={serviceId:id,token:reviewToken,signature:hash(files),expires:now()+10*60000,cardFingerprint:fingerprint(row),matchReport:inspectImage?combine(privacy,row):null,privacy,images:canRedact?images:undefined,flagged};
    if(flagged)return ctx.reply('⚠️ Возможно, на скриншотах есть личные данные. Исходные изображения пока не прикреплены.\n'+[...new Set(privacy.flatMap(r=>r.boxes||[]).map(b=>require('../../ai/proofPrivacy').kindLabels[b.kind]).filter(Boolean))].join(', ')+ '\n\n'+(canRedact?'Можно скрыть найденные области и проверить результат.':'Скройте данные на изображении и загрузите безопасную версию отдельно.'),{reply_markup:{inline_keyboard:[...(canRedact?[[{text:'🔒 Скрыть найденное',callback_data:`bookingproof:redact:${id}:${reviewToken}`}]]:[]),[{text:'Не прикреплять',callback_data:`bookingproof:cancel:${id}:${reviewToken}`}]]}});
    const review=ctx.session.bookingProofReview;if(review.matchReport?.fields.length&&review.matchReport.status==='match')await ctx.reply(reportText(review.matchReport));
    if(privacy.length)await ctx.reply(privacy.some(r=>r.status==='unavailable')?'⚠️ Проверка личных данных недоступна. Проверьте все изображения вручную перед прикреплением.':'🔎 Возможные личные данные не найдены. Проверка может ошибаться — осмотрите изображения вручную.');
    if(review.matchReport?.fields.length&&review.matchReport.status!=='match')return matchPrompt(ctx,id,review);
    return ctx.reply('🔒 Проверьте все изображения выше\n\nЕсли есть персональные данные, не прикрепляйте эти файлы: скройте их и загрузите безопасную версию обычной кнопкой подтверждений.\n\nПрикреплённые материалы увидят модераторы. В публичное фото карточки они не попадут.',{reply_markup:{inline_keyboard:[[{text:'✅ Данные скрыты — прикрепить',callback_data:`bookingproof:attach:${id}:${reviewToken}`}],[{text:'Не прикреплять',callback_data:`bookingproof:cancel:${id}:${reviewToken}`}]]}});
   }
   const review=ctx.session?.bookingProofReview;
   if(!review||review.serviceId!==id||review.token!==token||review.expires<=now()||review.signature!==hash(saved.files))return ctx.reply('Сначала откройте просмотр скриншотов и проверьте их заново.');
   if(review.cardFingerprint&&review.cardFingerprint!==fingerprint(row)){delete ctx.session.bookingProofReview;return ctx.reply('Карточка услуги изменилась. Откройте скриншоты и сверьте условия заново.',{reply_markup:{inline_keyboard:[[{text:'🔄 Проверить заново',callback_data:`bookingproof:preview:${id}`}]]}});}
   if(action==='cancel'){delete ctx.session.bookingProofReview;return ctx.reply('Исходные скриншоты не прикреплены. Можно загрузить безопасное подтверждение отдельно.');}
   if(action==='redact'){
    if(!review.flagged||!review.images||!review.privacy.every(r=>['clear','detected'].includes(r.status)))return ctx.reply('Загрузите безопасную версию отдельно.');
    const images=await redact(review.images,review.privacy);
    for(let i=0;i<images.length;i++)await ctx.replyWithPhoto({source:Buffer.from(images[i].split(',')[1],'base64')},{caption:`Скрытые области · ${i+1} из ${images.length}. Проверьте, что все личные данные закрыты и сведения об услуге читаются.`});
    review.redactedImages=images;review.flagged=false;review.token=randomBytes(8).toString('hex');review.expires=now()+10*60000;delete review.images;
    if(review.matchReport?.fields.length&&review.matchReport.status!=='match')return matchPrompt(ctx,id,review);
    return ctx.reply('🔒 Проверьте обработанные изображения выше. Скрытие может быть неполным. Прикрепляем только после вашей проверки.',{reply_markup:{inline_keyboard:[[{text:'✅ Проверено — прикрепить',callback_data:`bookingproof:attach:${id}:${review.token}`}],[{text:'Не прикреплять',callback_data:`bookingproof:cancel:${id}:${review.token}`}]]}});
   }
   if(action==='matchack'){if(review.flagged)return ctx.reply('Сначала скройте личные данные и проверьте результат.');review.matchAck=true;review.token=randomBytes(8).toString('hex');return ctx.reply('Вы подтвердили условия вручную. Проверьте также, что личные данные скрыты, затем прикрепите подтверждение.',{reply_markup:{inline_keyboard:[[{text:'✅ Проверено — прикрепить',callback_data:`bookingproof:attach:${id}:${review.token}`}],[{text:'Не прикреплять',callback_data:`bookingproof:cancel:${id}:${review.token}`}]]}});}
   if(action!=='attach')return;
   if(review.matchReport?.fields.length&&review.matchReport.status!=='match'&&!review.matchAck)return matchPrompt(ctx,id,review);
   if(review.flagged)return ctx.reply('Сначала скройте личные данные и проверьте безопасные изображения.');
   const images=review.redactedImages?[...review.redactedImages]:[];if(!review.redactedImages)for(const f of saved.files){const image=await loadImage(f.id);if(typeof image!=='string'||!/^data:image\/(?:jpeg|png|webp);base64,/.test(image))throw Error('INVALID_IMAGE');images.push(image);}
   const db=await pool.connect();let count;
   try{
    await db.query('BEGIN');
    const currentSource=await source(ctx,id,db,true);
    if(currentSource.used){await db.query('ROLLBACK');return ctx.reply('Скриншоты уже прикреплены.');}
    if(hash(currentSource.files)!==review.signature)throw Error('SOURCE_CHANGED');
    const result=await db.query('SELECT details,status,moderation_status,title,category FROM services WHERE id=$1 AND provider_id=$2 AND deleted_at IS NULL FOR UPDATE',[id,providerId]);const current=result.rows[0];
    if(!current||current.status!=='draft'||current.moderation_status==='pending')throw Error('NOT_EDITABLE');if(review.cardFingerprint&&review.cardFingerprint!==fingerprint(current))throw Error('CARD_CHANGED');
    const details=current.details||{},proof=[...new Set([...(Array.isArray(details.proofImages)?details.proofImages:[]),...images])];if(proof.length>20)throw Error('TOO_MANY_PROOFS');
    await db.query('UPDATE services SET details=$1::jsonb,updated_at=NOW() WHERE id=$2 AND provider_id=$3',[JSON.stringify({...details,proofImages:proof}),id,providerId]);
    await db.query('UPDATE telegram_booking_proof_sources SET used=true WHERE service_id=$1 AND actor_id=$2',[id,ctx.from.id]);
    await db.query('COMMIT');count=proof.length;
   }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
   delete ctx.session.bookingProofReview;
   if(onAttached){try{return await onAttached(ctx,id,count,row.category);}catch{return ctx.reply('✅ Подтверждения сохранены. Откройте карточку услуги, чтобы продолжить.');}}
   return ctx.reply(`✅ Подтверждения прикреплены: ${count}. Услуга ещё не отправлена на модерацию.`);
  }catch(e){const review=ctx.session?.bookingProofReview;const retry=action==='redact'&&review?`bookingproof:redact:${id}:${review.token}`:action==='attach'&&review&&e?.message!=='CARD_CHANGED'?`bookingproof:attach:${id}:${review.token}`:`bookingproof:preview:${id}`;return ctx.reply(e?.message==='CARD_CHANGED'?'Карточка изменилась. Подтверждения не добавлены — проверьте соответствие ещё раз.':'Не удалось '+(action==='redact'?'обработать изображения':action==='attach'?'прикрепить подтверждение':'открыть и проверить скриншоты')+'. Данные услуги сохранены. Повторите попытку или загрузите другое подтверждение.',{reply_markup:{inline_keyboard:[[{text:'🔄 Повторить',callback_data:retry}]]}});}finally{busy.delete(ctx.from.id);}
 };
 flow.prepare=async(ctx,id,files)=>{
  if(!Array.isArray(files)||!files.length)return;
  await owned(ctx,id);await initialize();
  const normalized=files.slice(0,5).map(f=>typeof f==='string'?{id:f,kind:'photo'}:{id:f.id,kind:f.kind==='document'?'document':'photo'}).filter(f=>typeof f.id==='string'&&f.id.length<1000);
  if(!normalized.length)return;
  await pool.query('DELETE FROM telegram_booking_proof_sources WHERE expires_at<NOW()');
  await pool.query(`INSERT INTO telegram_booking_proof_sources(service_id,actor_id,files) VALUES($1,$2,$3::jsonb) ON CONFLICT(service_id) DO UPDATE SET files=EXCLUDED.files,used=false,expires_at=EXCLUDED.expires_at WHERE telegram_booking_proof_sources.actor_id=EXCLUDED.actor_id AND telegram_booking_proof_sources.files IS DISTINCT FROM EXCLUDED.files`,[id,ctx.from.id,JSON.stringify(normalized)]);
 };
 flow.prompt=async(ctx,id)=>{
  const s=await source(ctx,id);if(s.used)return;
  return ctx.reply(`📎 Можно использовать исходные скриншоты (${s.files.length}) как подтверждение. По кнопке проверим возможные личные данные на сервере Travella и покажем изображения. Перед прикреплением потребуется ваша проверка.`,{reply_markup:{inline_keyboard:[[{text:'👀 Проверить скриншоты',callback_data:`bookingproof:preview:${id}`}]]}});
 };
 return flow;
}
module.exports={createBookingProofSources};
