const {createHash,randomBytes}=require('node:crypto');
const {resolveProviderByTelegramActorId}=require('../utils/providerTelegramResolver');
const norm=v=>String(v||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function bookingIdentity(d){return {category:d.category,from:norm(d.fromCity),to:norm(d.toCity),hotel:norm(d.hotel),start:d.category==='refused_flight'?d.departureFlightDate:d.startDate,end:d.category==='refused_flight'?d.returnFlightDate:d.endDate};}
function duplicateSignature(d,matches){return createHash('sha256').update(JSON.stringify({identity:bookingIdentity(d),ids:matches.map(m=>String(m.id)).sort()})).digest('hex');}
function createBookingDuplicateFinder(pool,resolveProvider=resolveProviderByTelegramActorId){return async(ctx,draft)=>{
 const identity=bookingIdentity(draft);if(!identity.start||!identity.to)return [];
 const owner=await resolveProvider(pool,ctx.from.id,{action:'booking_duplicate_check'});if(!owner?.id)throw Error('PROVIDER_REQUIRED');
 const result=await pool.query(`SELECT id,title,status,details FROM services WHERE provider_id=$1 AND category=$2 AND deleted_at IS NULL
 AND COALESCE(status,'') NOT IN ('archived','deleted','trash','cancelled')
 AND COALESCE(NULLIF(details->>'startDate',''),details->>'departureFlightDate')=$3
 AND ($4::text IS NULL OR COALESCE(NULLIF(details->>'endDate',''),details->>'returnFlightDate')=$4)
 ORDER BY updated_at DESC,id DESC LIMIT 100`,[owner.id,draft.category,identity.start,identity.end||null]);
 return result.rows.filter(row=>{const d=row.details||{};const to=norm(d.directionTo||d.toCity);if(to!==identity.to)return false;if(draft.category!=='refused_flight'&&identity.hotel&&norm(d.hotel||d.hotelName)!==identity.hotel)return false;if(draft.category!=='refused_hotel'&&identity.from&&norm(d.directionFrom||d.fromCity)!==identity.from)return false;return true;}).slice(0,3).map(row=>({id:row.id,title:row.title,status:row.status}));
};}
function createBookingDuplicateGuard({find,onContinue,now=Date.now}){
 const busy=new Set();
 const guard=async(ctx,next)=>{
  const data=String(ctx.callbackQuery?.data||'');if(!data.startsWith('bookingdup:'))return next();
  if(ctx.chat?.type!=='private'||String(ctx.chat.id)!==String(ctx.from?.id))return;
  await ctx.answerCbQuery().catch(()=>{});const pending=ctx.session?.bookingDuplicatePending;
  if(!pending||pending.token!==data.split(':')[2]||pending.expires<=now()||!ctx.session?.serviceDraft?.bookingImportVersion)return ctx.reply('Подтверждение устарело. Повторите сохранение черновика.');
  if(data.split(':')[1]!=='confirm')return;
  if(busy.has(ctx.from.id))return;busy.add(ctx.from.id);
  try{const draft=ctx.session.serviceDraft,matches=await find(ctx,draft),signature=duplicateSignature(draft,matches);
   if(signature!==pending.signature){delete ctx.session.bookingDuplicatePending;if(await guard.check(ctx,draft))await onContinue(ctx);return;}
   draft.bookingDuplicateAcknowledged=signature;delete ctx.session.bookingDuplicatePending;await onContinue(ctx);
  }catch{return ctx.reply('Не удалось подтвердить сохранение. Проверьте свои услуги перед повторной попыткой.');}finally{busy.delete(ctx.from.id);}
 };
 guard.check=async(ctx,draft)=>{
  if(!draft.bookingImportVersion)return true;
  let matches;try{matches=await find(ctx,draft);}catch{await ctx.reply('Не удалось проверить похожие услуги. Черновик сохранён, повторите попытку позже.');return false;}
  const signature=duplicateSignature(draft,matches);if(!matches.length||draft.bookingDuplicateAcknowledged===signature)return true;
  const token=randomBytes(8).toString('hex');ctx.session.bookingDuplicatePending={token,signature,expires:now()+10*60000};
  await ctx.reply('⚠️ Перед созданием найдены похожие предложения у вас:\n'+matches.map(m=>`#${m.id} · ${String(m.title||'Без названия').slice(0,100)}`).join('\n')+'\n\nПродолжить создание отдельной услуги?',{reply_markup:{inline_keyboard:[...matches.map(m=>[{text:`Открыть #${m.id}`,url:`https://travella.uz/dashboard/services/marketplace?service_id=${m.id}&from=tg`}]),[{text:'Создать отдельную услугу',callback_data:`bookingdup:confirm:${token}`}]]}});return false;
 };
 return guard;
}
module.exports={bookingIdentity,duplicateSignature,createBookingDuplicateFinder,createBookingDuplicateGuard};
