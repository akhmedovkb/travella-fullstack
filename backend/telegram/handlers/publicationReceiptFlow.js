const {resolveProviderByTelegramActorId}=require('../../utils/providerTelegramResolver');
const {ensureProviderSupportSchema}=require('../../controllers/providerSupportController');
function createReceiptStore(pool){
 let ready;
 const initialize=()=>ready||(ready=ensureProviderSupportSchema(pool).then(()=>pool.query(`CREATE TABLE IF NOT EXISTS telegram_publication_receipts(
 id BIGSERIAL PRIMARY KEY,actor_id BIGINT NOT NULL,provider_id BIGINT NOT NULL,service_id BIGINT NOT NULL,
 message_id BIGINT NOT NULL,file_id TEXT NOT NULL,file_kind TEXT NOT NULL,amount_sum INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',reviewer_id BIGINT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),reviewed_at TIMESTAMPTZ,
 UNIQUE(actor_id,message_id))`)).catch(e=>{ready=null;throw e;}));
 return {initialize,
 async save(value){await initialize();const r=await pool.query(`INSERT INTO telegram_publication_receipts(actor_id,provider_id,service_id,message_id,file_id,file_kind,amount_sum)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(actor_id,message_id) DO NOTHING RETURNING *`,value);return r.rows[0];},
 async review(id,actor,status){await initialize();const db=await pool.connect();try{await db.query('BEGIN');
 const r=await db.query("UPDATE telegram_publication_receipts SET status=$3,reviewer_id=$2,reviewed_at=NOW() WHERE id=$1 AND status='pending' RETURNING *",[id,actor,status]);
 const row=r.rows[0];if(row&&status==='approved')await db.query(`INSERT INTO provider_support_donations(provider_id,telegram_chat_id,service_id,amount_tiyin,status,source,note,paid_at)
 VALUES($1,$2,$3,$4,'paid','telegram_publication_receipt',$5,NOW())`,[row.provider_id,row.actor_id,row.service_id,Number(row.amount_sum)*100,'Receipt #'+row.id+' manually confirmed']);
 await db.query('COMMIT');return row;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 };
}
function createPublicationReceiptFlow({pool,resolve=resolveProviderByTelegramActorId,store=createReceiptStore(pool),isAdmin,recipients,amount=25000}){
 const waiting=new Map(),busy=new Set();
 const reply=(ctx,text,rows=[])=>ctx.reply(text,{parse_mode:undefined,reply_markup:{inline_keyboard:rows}});
 const cancel=[{text:'✕ Отменить загрузку чека',callback_data:'pub_receipt:cancel'}];
 return async(ctx,next)=>{
 const data=String(ctx.callbackQuery?.data||'');
 const hint=/^support_project:receipt_hint(?::(\d+))?$/.exec(data);
 const action=/^pub_receipt:(choose|approve|reject):(\d+)$/.exec(data);
 const id=String(ctx.from?.id||'');
 if(ctx.chat?.type!=='private'||String(ctx.chat.id)!==id)return (hint||action||data==='pub_receipt:cancel')?ctx.answerCbQuery('Откройте личный чат с ботом.'):next();
 if(action&&['approve','reject'].includes(action[1])){
  if(!isAdmin(ctx.from.id))return ctx.answerCbQuery('Доступ только администратору.');
  await ctx.answerCbQuery();
  const row=await store.review(Number(action[2]),ctx.from.id,action[1]==='approve'?'approved':'rejected');
  if(!row)return reply(ctx,'ℹ️ Этот чек уже проверен.');
  await ctx.editMessageReplyMarkup({inline_keyboard:[]}).catch(()=>{});
  const approved=row.status==='approved';
  await reply(ctx,approved?'✅ Оплата публикации подтверждена.':'❌ Чек отклонён.');
  try{await ctx.telegram.sendMessage(row.actor_id,(approved?'✅ Оплата публикации подтверждена.':'❌ Чек не подтверждён. Проверьте перевод и отправьте новый чек.')+'\n📌 Услуга #'+row.service_id,{reply_markup:{inline_keyboard:approved?[]:[[{text:'📎 Отправить новый чек',callback_data:'support_project:receipt_hint:'+row.service_id}]]}});}catch{await reply(ctx,'⚠️ Решение сохранено, но сообщение поставщику не доставлено.');}
  return;
 }
 if(data==='pub_receipt:cancel'){waiting.delete(id);await ctx.answerCbQuery();return reply(ctx,'👌 Загрузка чека отменена.');}
 if(hint||action?.[1]==='choose'){
  await ctx.answerCbQuery();
  const provider=await resolve(pool,ctx.from.id);const providerId=Number(provider?.id||provider?.providerId);
  if(!providerId)return reply(ctx,'⚠️ Аккаунт поставщика не найден. Откройте профиль в боте.');
  const serviceId=Number(hint?.[1]||action?.[2]||0);
  if(!serviceId){const r=await pool.query('SELECT id,title FROM services WHERE provider_id=$1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 15',[providerId]);
   return reply(ctx,'📌 За публикацию какой услуги отправляете чек?',r.rows.map(s=>[{text:'#'+s.id+' · '+String(s.title||'Услуга').slice(0,42),callback_data:'pub_receipt:choose:'+s.id}]).concat([cancel]));}
  const r=await pool.query('SELECT id,title FROM services WHERE id=$1 AND provider_id=$2 AND deleted_at IS NULL',[serviceId,providerId]);
  if(!r.rows[0])return reply(ctx,'⚠️ Услуга недоступна. Выберите свою услугу заново.');
  if(!recipients().length)return reply(ctx,'⚠️ Приём чеков временно недоступен. Обратитесь в поддержку.');
  for(const [key,value]of waiting)if(value.expires<Date.now())waiting.delete(key);
  waiting.set(id,{providerId,serviceId,title:r.rows[0].title,expires:Date.now()+30*60000});
  return reply(ctx,'📎 Пришлите фото или файл чека за публикацию.\n📌 Услуга #'+serviceId+' · '+String(r.rows[0].title||'').slice(0,80)+'\n💰 К оплате: '+Number(amount).toLocaleString('ru-RU')+' сум\n\n⏳ Оплату подтвердит администратор после проверки.',[cancel]);
 }
 const state=waiting.get(id);if(!state)return next();
 if(Date.now()>state.expires){waiting.delete(id);return next();}
 if(data||/^\//.test(ctx.message?.text||'')){waiting.delete(id);return next();}
 const photo=ctx.message?.photo?.at(-1),document=ctx.message?.document;
 const file=photo||document;
 if(!file||(!photo&&!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(document.mime_type||'')))return reply(ctx,'📎 Нужен чек: фото, JPG, PNG или PDF до 6 МБ.',[cancel]);
 if(Number(file.file_size)>6*1024*1024)return reply(ctx,'📎 Файл больше 6 МБ. Пришлите уменьшенное фото или PDF.',[cancel]);
 if(busy.has(id))return;busy.add(id);
 try{
  const owned=await pool.query('SELECT id FROM services WHERE id=$1 AND provider_id=$2 AND deleted_at IS NULL',[state.serviceId,state.providerId]);
  if(!owned.rows[0]){waiting.delete(id);return reply(ctx,'⚠️ Услуга больше недоступна. Выберите услугу заново.');}
  const row=await store.save([ctx.from.id,state.providerId,state.serviceId,ctx.message.message_id,file.file_id,photo?'photo':'document',amount]);
  if(!row){waiting.delete(id);return reply(ctx,'✅ Этот чек уже отправлен на проверку.');}
  let delivered=0;
  const caption='🧾 Оплата публикации — на проверке\n👤 Поставщик: '+String(ctx.from.first_name||'')+' '+String(ctx.from.last_name||'')+(ctx.from.username?' (@'+ctx.from.username+')':'')+'\n📌 #'+state.serviceId+' · '+String(state.title||'').slice(0,100)+'\n💰 К оплате: '+Number(amount).toLocaleString('ru-RU')+' сум\n🔎 Чек #'+row.id+' · Сверьте поступление денег перед подтверждением.';
  for(const target of recipients())try{
   const extra={caption,parse_mode:undefined,reply_markup:{inline_keyboard:[[{text:'✅ Подтвердить',callback_data:'pub_receipt:approve:'+row.id},{text:'❌ Отклонить',callback_data:'pub_receipt:reject:'+row.id}],[{text:'🌐 Открыть услугу',url:'https://travella.uz/marketplace?opened='+state.serviceId}]]}};
   if(photo)await ctx.telegram.sendPhoto(target,file.file_id,extra);else await ctx.telegram.sendDocument(target,file.file_id,extra);delivered++;
  }catch{}
  waiting.delete(id);
  return reply(ctx,delivered?'✅ Чек получен и отправлен администратору.\n⏳ После проверки пришлём результат.':'⚠️ Чек сохранён, но уведомление не доставлено. Обратитесь в поддержку: чек #'+row.id+'.');
 }finally{busy.delete(id);}
 };
}
module.exports={createPublicationReceiptFlow,createReceiptStore};
