const formatter=new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Tashkent',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function formatTelegramExpiration(value){
 if(!value)return 'не указано';
 const text=String(value).trim();
 if(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)||value instanceof Date){const date=new Date(value);return Number.isNaN(date.getTime())?'дата не распознана':`${formatter.format(date)} (Ташкент)`;}
 const match=text.match(/^(\d{4})[-.](\d{2})[-.](\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/);
 if(!match)return 'дата не распознана';
 const [,y,m,d,h,min]=match;const date=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
 if(date.getUTCFullYear()!==Number(y)||date.getUTCMonth()!==Number(m)-1||date.getUTCDate()!==Number(d)||Number(h||0)>23||Number(min||0)>59)return 'дата не распознана';
 const label=new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(date);
 return h===undefined?label:`${label}, ${h}:${min}`;
}
module.exports={formatTelegramExpiration};
