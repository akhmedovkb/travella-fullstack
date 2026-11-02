function activityPrompt(draft={}) {
 return `✅ Актуальность услуги\n\nУслуга ещё доступна для бронирования?\n• Да — предложение актуально, можно принимать заявки.\n• Нет — предложение больше недоступно (например, продано или мест нет).\n\nТекущее: ${draft.isActive ? 'актуальна' : 'недоступна'}.\nВыберите вариант кнопкой ниже. Это не публикует услугу — изменения применятся после сохранения.`;
}
function activityKeyboard(draft={}) {
 const id=Number(draft.id||0);
 return {reply_markup:{inline_keyboard:[[{text:'✅ Да, услуга актуальна',callback_data:`svc_edit:activity:${id}:yes`}],[{text:'⛔ Нет, больше недоступна',callback_data:`svc_edit:activity:${id}:no`}],[{text:'➡️ Оставить как сейчас',callback_data:`svc_edit:activity:${id}:keep`}],[{text:'⬅️ Назад',callback_data:'svc_edit:back'},{text:'❌ Отмена',callback_data:'svc_edit:cancel'}]]}};
}
module.exports={activityPrompt,activityKeyboard};
