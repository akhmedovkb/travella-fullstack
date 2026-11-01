const {createHash}=require('node:crypto');
const {WAITING_SQL,RETURNED_SQL}=require('./correctionTracking');
const {ensureServiceModerationEvents}=require('./serviceModerationEvents');
const {resolveProviderByTelegramActorId}=require('./providerTelegramResolver');
const version=s=>createHash('sha256').update([s.id,s.status,s.moderation_status,s.edit_version||s.updated_at||''].join(':')).digest('hex').slice(0,12);
const phase=s=>s.deleted_at||s.status==='deleted'?'deleted':s.status==='archived'?'archived':s.correction_phase==='waiting'?'waiting':s.status==='pending'||s.moderation_status==='pending'?'pending':s.status==='published'||s.status==='active'?'published':'draft';
const labels={deleted:'В корзине',archived:'В архиве',waiting:'На исправлении',pending:'На модерации',published:'Опубликована',draft:'Черновик'};
function currentKeyboard(s){const state=phase(s),id=s.id;const rows=[];
 if(state==='archived')rows.push([{text:'♻️ Восстановить услугу',callback_data:`svc_restore_archive:${id}:${version(s)}`}]);
 else if(state==='waiting'||s.correction_phase==='returned')rows.push([{text:'Открыть замечания и историю',callback_data:`corr:open:${id}`}]);
 else if(state==='draft')rows.push([{text:'Продолжить черновик',callback_data:`draft:continue:${id}`}]);
 else if(state==='published')rows.push([{text:'Открыть мои услуги',callback_data:'prov_services:list'}]);
 rows.push([{text:'Мои услуги',callback_data:'prov_services:list'}]);return {inline_keyboard:rows};}
function createServiceActionGuard({pool,resolve=resolveProviderByTelegramActorId}){
 const running=new Map();
 return async(ctx,next)=>{
  const data=String(ctx.callbackQuery?.data||'');
  const match=data.match(/^(svc_current|svc_archive|svc_archive_confirm|svc_restore_archive|svc_edit_start|draft:item|draft:continue|proof:card|proof:view|proof:edit|proof:add_more|proof:submit):([0-9]+)(?::(.*))?$/);
  if(!match&&!['proof:submit','proof:add_more'].includes(data))return next();
  const actor=String(ctx.from?.id||'');const previous=running.get(actor)||Promise.resolve();
  const work=previous.catch(()=>{}).then(async()=>{
   if(ctx.chat?.type!=='private'||String(ctx.chat.id)!==actor){await ctx.answerCbQuery().catch(()=>{});return ctx.reply('Откройте личный чат с ботом.');}
   if(!match){await ctx.answerCbQuery().catch(()=>{});return ctx.reply('Кнопка из старого сообщения. Откройте услугу заново в «Мои услуги».',{reply_markup:{inline_keyboard:[[{text:'Мои услуги',callback_data:'prov_services:list'}]]}});}
   const [,action,rawId,token]=match,id=Number(rawId);
   try{
    const provider=await resolve(pool,ctx.from.id,{action:'service_button_guard'});if(!provider?.id)throw Error('not_owned');await ensureServiceModerationEvents(pool);
    const q=await pool.query(`SELECT s.*,to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edit_version,CASE WHEN (${WAITING_SQL}) THEN 'waiting' WHEN (${RETURNED_SQL}) THEN 'returned' END AS correction_phase FROM services s WHERE s.id=$1 AND s.provider_id=$2`,[id,provider.id]);const s=q.rows[0];if(!s)throw Error('not_owned');const state=phase(s);
    const invalid=action==='svc_archive'?['archived','deleted','pending'].includes(state):action==='svc_archive_confirm'?['archived','deleted','pending'].includes(state)||token!==version(s):action==='svc_restore_archive'?state!=='archived'||token!==version(s):['svc_edit_start','draft:item','draft:continue','proof:edit','proof:add_more','proof:submit'].includes(action)?['pending','archived','deleted','waiting'].includes(state):state==='deleted';
    if(action==='svc_current'||invalid){await ctx.answerCbQuery().catch(()=>{});ctx.session=ctx.session||{};ctx.session.correctionFlow=null;return ctx.reply(`${invalid?'Эта кнопка больше не подходит к текущему состоянию услуги.\n\n':''}Услуга #${id}\nСтатус: ${s.correction_phase==='returned'?'На повторной проверке':labels[state]}`,{reply_markup:invalid?{inline_keyboard:[[{text:"Открыть актуальную карточку",callback_data:`svc_current:${id}`}],...currentKeyboard(s).inline_keyboard]}:currentKeyboard(s)});}
    ctx.state=ctx.state||{};ctx.state.serviceActionVersion=s.edit_version;ctx.state.currentService=s;return await next();
   }catch(error){await ctx.answerCbQuery().catch(()=>{});await ctx.reply('Не удалось открыть услугу. Обновите список в «Мои услуги».',{reply_markup:{inline_keyboard:[[{text:'Мои услуги',callback_data:'prov_services:list'}]]}});}
  });running.set(actor,work);try{return await work;}finally{if(running.get(actor)===work)running.delete(actor);}
 };
}
module.exports={createServiceActionGuard,serviceButtonVersion:version,currentKeyboard,phase};
