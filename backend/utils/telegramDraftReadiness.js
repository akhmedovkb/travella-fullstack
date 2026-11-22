const {getServiceFieldChecks,normalizeDetails,getProofImages,getImages}=require('./serviceFieldMatrix');
const labels={'Цена нетто':'цена для коллег','Цена для клиента':'цена для туристов','Цена для клиента не ниже нетто':'цена для туристов не ниже цены для коллег'};
function draftReadiness(service){
 const d=normalizeDetails(service.details),checks=getServiceFieldChecks(service);
 for(const c of checks)if(c.key==='grossPrice')c.ok=Number(d.grossPrice??d.clientPrice)>0;
 const missing=checks.filter(c=>c.required&&!c.ok&&!['photo','proof'].includes(c.key));
 const lines=[missing.length?'📝 Осталось заполнить: '+missing.map(c=>labels[c.label]||c.label.toLowerCase()).join(', ')+'.':'✅ Основные данные заполнены.'];
 const photo=checks.find(c=>c.key==='photo');
 if(!getImages(service.images).length)lines.push(photo?.required?'🖼 Добавьте фото карточки.':'🖼 Фото карточки можно добавить по желанию.');
 if(checks.some(c=>c.key==='proof')&&!getProofImages(d).length)lines.push('📎 Для модерации добавьте подтверждение.');
 else if(!missing.length&&!checks.some(c=>c.key==='photo'&&c.required&&!c.ok))lines.push('📤 Данные можно отправить на модерацию.');
 if(d.expiration&&Number.isFinite(+new Date(d.expiration))&&+new Date(d.expiration)<=Date.now())lines.push('⏰ Срок продажи истёк — обновите его.');
 return lines.join('\n');
}
module.exports={draftReadiness};
