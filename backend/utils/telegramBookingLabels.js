const {labels}=require('../ai/bookingImportReview');
const keys=['Дата','Вылет','Прилёт','Время','Рейс / авиакомпания',...Object.values(labels),'Цена для коллег','Цена для туристов','Для коллег','Для туристов','Единица цены','За что указана цена','Период цены','Период основной цены','Основная цена','Доплаты','Условия доплат','Итого','Итог','Срок','Срок актуальности','Актуально до','Состав','Взрослые','Дети','Младенцы','Сейчас','Выбрано','Добавлено скриншотов','Заполнено полей','Скриншотов распознано','Осталось заполнить','Различаются данные','Категория','Прикреплено','Подтверждений','Фото карточки','Скриншот','В очереди','Багаж','Ручная кладь','Номер','Размещение','Как отправить'];
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function bookingLabelOptions(text,extra={}){
 if(extra.parse_mode||extra.entities)return extra;
 const pattern=new RegExp('(^|\n| · )([^\\p{L}\\p{N}\n]*)(?:'+keys.map(escape).sort((a,b)=>b.length-a.length).join('|')+'):', 'gmu');
 const entities=[];
 for(const m of String(text).matchAll(pattern))entities.push({type:'bold',offset:m.index+m[1].length,length:m[0].length-m[1].length});
 return entities.length?{...extra,entities}:extra;
}
function bookingLabelHtml(text){
 const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 const entities=bookingLabelOptions(text).entities||[];let result='',offset=0;
 for(const e of entities){result+=escape(text.slice(offset,e.offset))+'<b>'+escape(text.slice(e.offset,e.offset+e.length))+'</b>';offset=e.offset+e.length;}
 return result+escape(text.slice(offset));
}
module.exports={bookingLabelOptions,bookingLabelHtml};
