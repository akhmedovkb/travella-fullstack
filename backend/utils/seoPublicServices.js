const {isServiceActual}=require('../telegram/helpers/serviceActual');
const text=(v,max=160)=>String(v??'').replace(/[<>\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const parse=v=>{try{return typeof v==='string'?JSON.parse(v):v||{};}catch{return {};}};
function publicService(row){
 if(!row||row.deleted_at||!['published','active','approved'].includes(String(row.status).toLowerCase())||!['published','active','approved'].includes(String(row.moderation_status).toLowerCase()))return null;
 const d=parse(row.details);if(!isServiceActual(d,row))return null;
 const price=String(d.grossPrice??d.gross_price??d.clientPrice??'').trim().replace(',','.');
 const images=parse(row.images);const image=(Array.isArray(images)?images:[]).map(x=>typeof x==='string'?x:x?.url).find(x=>typeof x==='string'&&/^https:\/\//i.test(x)&&!/[\/]proof(?:[\/_.-]|$)/i.test(x));
 const date=v=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):null;
 return {id:Number(row.id),title:text(row.title),category:text(row.category,60),origin:text(d.directionFrom||d.fromCity,70),destination:text(d.directionTo||d.toCity||d.city,70),country:text(d.directionCountry||d.country,70),start:date(d.startDate||d.checkInDate||d.departureFlightDate),end:date(d.endDate||d.checkOutDate||d.returnFlightDate),hotel:text(d.hotel||d.hotelName),room:text(d.roomCategory||d.accommodationCategory,100),accommodation:text(d.accommodation,60),food:text(d.food||d.meal,60),price:/^\d+(?:\.\d{1,2})?$/.test(price)&&Number(price)>0?Number(price):null,currency:text(d.currency||row.currency||'USD',3).toUpperCase(),priceBasis:['person','total','room'].includes(d.priceBasis)?d.priceBasis:null,pricePeriod:['full','night'].includes(d.pricePeriod)?d.pricePeriod:null,image:image||null,updated:row.updated_at&&Number.isFinite(+new Date(row.updated_at))?new Date(row.updated_at).toISOString():null};
}
const eligible="deleted_at IS NULL AND LOWER(status) IN ('published','active','approved') AND LOWER(COALESCE(moderation_status,'')) IN ('published','active','approved')";
function createSeoPublicServices(pool){return {
 async one(id){if(!Number.isSafeInteger(id)||id<=0)return null;const r=await pool.query(`SELECT id,title,category,images,details,status,moderation_status,expiration_at,updated_at,currency FROM services WHERE id=$1 AND ${eligible}`,[id]);return publicService(r.rows[0]);},
 async list({after=0,before=2147483647,limit=500}={}){const size=Math.min(1000,Math.max(1,Number(limit)||500));const r=await pool.query(`SELECT id,title,category,images,details,status,moderation_status,expiration_at,updated_at,currency FROM services WHERE ${eligible} AND id>$1 AND id<$2 ORDER BY id LIMIT $3`,[after,before,size]);const max=await pool.query(`SELECT COALESCE(MAX(id),0) AS id FROM services WHERE ${eligible}`);return {items:r.rows.map(publicService).filter(Boolean),nextCursor:r.rows.length===size?Number(r.rows.at(-1).id):null,maxId:Number(max.rows[0]?.id||0)};}
};}
module.exports={publicService,createSeoPublicServices};
