const {randomBytes,createHash}=require('node:crypto');
const hash=files=>createHash('sha256').update(JSON.stringify(files)).digest('hex');
function createBookingProofSources({pool,resolveOwner,loadImage,onAttached,now=Date.now}){
 let ready;const busy=new Set();
 const initialize=()=>ready||(ready=pool.query(`CREATE TABLE IF NOT EXISTS telegram_booking_proof_sources (
 service_id BIGINT PRIMARY KEY,actor_id BIGINT NOT NULL,files JSONB NOT NULL,used BOOLEAN NOT NULL DEFAULT false,
 expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '30 days')`).catch(e=>{ready=null;throw e;}));
 async function owned(ctx,id,db=pool,lock=false){
  const providerId=await resolveOwner(ctx,id);
  const r=await db.query(`SELECT id,category,status,moderation_status,details FROM services WHERE id=$1 AND provider_id=$2 AND deleted_at IS NULL${lock?' FOR UPDATE':''}`,[id,providerId]);
  const row=r.rows[0];if(!row||row.status!=='draft'||row.moderation_status==='pending')throw Error('NOT_EDITABLE');return {row,providerId};
 }
 async function source(ctx,id,db=pool,lock=false){await initialize();const r=await db.query(`SELECT files,used FROM telegram_booking_proof_sources WHERE service_id=$1 AND actor_id=$2 AND expires_at>NOW()${lock?' FOR UPDATE':''}`,[id,ctx.from.id]);if(!r.rows[0])throw Error('SOURCE_UNAVAILABLE');return r.rows[0];}
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
   if(action==='preview'){
    const files=saved.files;
    for(let i=0;i<files.length;i++){
     const send=files[i].kind==='document'?ctx.replyWithDocument?.bind(ctx):ctx.replyWithPhoto?.bind(ctx);
     if(!send||!await send(files[i].id,{caption:`Скриншот ${i+1} из ${files.length}. Проверьте: ФИО, даты рождения, документы, QR-коды и данные оплаты должны быть скрыты.`}))throw Error('PREVIEW_UNAVAILABLE');
    }
    const reviewToken=randomBytes(8).toString('hex');ctx.session.bookingProofReview={serviceId:id,token:reviewToken,signature:hash(files),expires:now()+10*60000};
    return ctx.reply('🔒 Проверьте все изображения выше\n\nЕсли есть персональные данные, не прикрепляйте эти файлы: скройте их и загрузите безопасную версию обычной кнопкой подтверждений.\n\nПрикреплённые материалы увидят модераторы. В публичное фото карточки они не попадут.',{reply_markup:{inline_keyboard:[[{text:'✅ Данные скрыты — прикрепить',callback_data:`bookingproof:attach:${id}:${reviewToken}`}],[{text:'Не прикреплять',callback_data:`bookingproof:cancel:${id}:${reviewToken}`}]]}});
   }
   const review=ctx.session?.bookingProofReview;
   if(!review||review.serviceId!==id||review.token!==token||review.expires<=now()||review.signature!==hash(saved.files))return ctx.reply('Сначала откройте просмотр скриншотов и проверьте их заново.');
   if(action==='cancel'){delete ctx.session.bookingProofReview;return ctx.reply('Исходные скриншоты не прикреплены. Можно загрузить безопасное подтверждение отдельно.');}
   if(action!=='attach')return;
   const images=[];for(const f of saved.files){const image=await loadImage(f.id);if(typeof image!=='string'||!/^data:image\/(?:jpeg|png|webp);base64,/.test(image))throw Error('INVALID_IMAGE');images.push(image);}
   const db=await pool.connect();let count;
   try{
    await db.query('BEGIN');
    const currentSource=await source(ctx,id,db,true);
    if(currentSource.used){await db.query('ROLLBACK');return ctx.reply('Скриншоты уже прикреплены.');}
    if(hash(currentSource.files)!==review.signature)throw Error('SOURCE_CHANGED');
    const result=await db.query('SELECT details,status,moderation_status FROM services WHERE id=$1 AND provider_id=$2 AND deleted_at IS NULL FOR UPDATE',[id,providerId]);const current=result.rows[0];
    if(!current||current.status!=='draft'||current.moderation_status==='pending')throw Error('NOT_EDITABLE');
    const details=current.details||{},proof=[...new Set([...(Array.isArray(details.proofImages)?details.proofImages:[]),...images])];if(proof.length>20)throw Error('TOO_MANY_PROOFS');
    await db.query('UPDATE services SET details=$1::jsonb,updated_at=NOW() WHERE id=$2 AND provider_id=$3',[JSON.stringify({...details,proofImages:proof}),id,providerId]);
    await db.query('UPDATE telegram_booking_proof_sources SET used=true WHERE service_id=$1 AND actor_id=$2',[id,ctx.from.id]);
    await db.query('COMMIT');count=proof.length;
   }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
   delete ctx.session.bookingProofReview;
   if(onAttached){try{return await onAttached(ctx,id,count,row.category);}catch{return ctx.reply('✅ Подтверждения сохранены. Откройте карточку услуги, чтобы продолжить.');}}
   return ctx.reply(`✅ Подтверждения прикреплены: ${count}. Услуга ещё не отправлена на модерацию.`);
  }catch{return ctx.reply('Не удалось прикрепить исходные скриншоты. Проверьте статус услуги или загрузите подтверждение отдельно.');}finally{busy.delete(ctx.from.id);}
 };
 flow.prepare=async(ctx,id,files)=>{
  if(!Array.isArray(files)||!files.length)return;
  await owned(ctx,id);await initialize();
  const normalized=files.slice(0,5).map(f=>typeof f==='string'?{id:f,kind:'photo'}:{id:f.id,kind:f.kind==='document'?'document':'photo'}).filter(f=>typeof f.id==='string'&&f.id.length<1000);
  if(!normalized.length)return;
  await pool.query('DELETE FROM telegram_booking_proof_sources WHERE expires_at<NOW()');
  await pool.query(`INSERT INTO telegram_booking_proof_sources(service_id,actor_id,files) VALUES($1,$2,$3::jsonb) ON CONFLICT(service_id) DO NOTHING`,[id,ctx.from.id,JSON.stringify(normalized)]);
 };
 flow.prompt=async(ctx,id)=>{
  const s=await source(ctx,id);if(s.used)return;
  return ctx.reply(`📎 Можно использовать исходные скриншоты (${s.files.length}) как подтверждение. Сначала откройте их и проверьте, что персональные данные скрыты.`,{reply_markup:{inline_keyboard:[[{text:'👀 Проверить скриншоты',callback_data:`bookingproof:preview:${id}`}]]}});
 };
 return flow;
}
module.exports={createBookingProofSources};
