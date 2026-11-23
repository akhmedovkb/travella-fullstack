const clean=(v,n)=>String(v||'').replace(/[<>\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
function contactLines(contact,language='ru',index){
 const label={ru:'Контакты',uz:'Kontaktlar',en:'Contacts'}[language]||'Контакты';
 if(!contact)return ['📞 '+label+': '+(index?'«📞 '+index+'»':'👇')];
 const lines=[];
 if(contact.name)lines.push('🤝 '+clean(contact.name,60));
 if(/^[A-Za-z0-9_]{3,64}$/.test(contact.telegram||''))lines.push('📲 https://t.me/'+contact.telegram);
 for(const [key,icon]of [['phone','☎️'],['whatsapp','🟢']])if(/^\+?[0-9][0-9 ()-]{5,30}$/.test(contact[key]||'')&&(key!=='whatsapp'||contact[key]!==contact.phone))lines.push(icon+' '+contact[key]);
 return lines.length?lines:['📞 '+label+': '+(index?'«📞 '+index+'»':'👇')];
}
function createAssistantContactResolver({resolveAudience,loadService,pickContacts,normalizeTelegram}){
 return async(ctx,id)=>{
  if(ctx.chat?.type!=='private'||String(ctx.chat.id)!==String(ctx.from?.id))return null;
  const audience=await resolveAudience(ctx);
  const data=await loadService(id,audience?.privileged?audience.role:'client',ctx.from.id);
  const service=data?.service;
  if(data?.unlocked!==true||Number(service?.id)!==Number(id)||service.deleted_at||!['published','active','approved'].includes(String(service.status).toLowerCase())||!['published','active','approved'].includes(String(service.moderation_status).toLowerCase()))return null;
  const c=pickContacts(service);
  return {name:clean(c.name,60),telegram:normalizeTelegram(c.telegram),phone:clean(c.phone,32),whatsapp:clean(c.whatsapp,32)};
 };
}
module.exports={contactLines,createAssistantContactResolver};
