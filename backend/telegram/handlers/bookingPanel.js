// One actor-scoped bot message survives field changes and process restarts.
function createBookingPanel(){const pending=new Map();return async(ctx,s,text,extra)=>{
 if(!ctx.telegram?.editMessageText){if(ctx.callbackQuery&&ctx.editMessageText){try{const m=await ctx.editMessageText(text,extra);if(m)return m;}catch{}}return ctx.reply(text,extra);}
 const key=String(ctx.from.id);const work=async()=>{if(s.panelMessageId){try{return await ctx.telegram.editMessageText(ctx.chat.id,s.panelMessageId,undefined,text,extra);}catch(e){if(/message is not modified/i.test(e?.description||e?.message||''))return;}}
 const m=await ctx.reply(text,extra);if(Number.isSafeInteger(m?.message_id))s.panelMessageId=m.message_id;return m;};
 const job=(pending.get(key)||Promise.resolve()).catch(()=>{}).then(work);pending.set(key,job);try{return await job;}finally{if(pending.get(key)===job)pending.delete(key);}
};}
module.exports={createBookingPanel};
