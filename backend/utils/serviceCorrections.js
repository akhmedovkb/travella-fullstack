const { createHash } = require("node:crypto");
const REASON_GROUPS = { NO_PROOF: "proof", BAD_PROOF: "proof", NO_DATES: "dates", BAD_PRICE: "price", HOTEL_DETAILS: "hotel", NO_PHOTO: "photos", MISSING_DETAILS: "details", WRONG_CATEGORY: "details", DUPLICATE: "details", OTHER: "details" };
const first = (...values) => values.find(v => v !== undefined && v !== null && String(v).trim() !== "") ?? "";
const object = v => { if (typeof v === "string") { try { v = JSON.parse(v); } catch { return {}; } } return v && typeof v === "object" && !Array.isArray(v) ? v : {}; };
const images = value => {
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { value = [value]; } }
  return (Array.isArray(value) ? value : []).map(v => typeof v === "string" ? v : v?.url || v?.src || "").filter(Boolean).sort();
};
const hash = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function normalizeReasonCodes(codes, fallback = "OTHER") {
  if (codes !== undefined && !Array.isArray(codes)) throw Object.assign(new Error("Причины должны быть списком"),{status:400});
  const input = Array.isArray(codes) ? codes : [fallback];
  if (!input.length || input.length > 10 || input.some(c => !Object.hasOwn(REASON_GROUPS, c))) throw Object.assign(new Error("Выберите корректные причины исправления"), { status: 400 });
  return [...new Set(input)];
}
function correctionSnapshot(service) {
  const d = object(service.details);
  const result = {};
  const add = (key, group, label, value) => { result[key] = { group, label, value: String(value ?? "").slice(0, 2000), signature: hash(String(value ?? "")) }; };
  const file = (key, group, label, value) => { const list = images(value); result[key] = { group, label, value: hash(list), display: `${list.length} шт.` }; };
  add("start", "dates", "Дата начала", first(d.startDate,d.departureDate,d.departureFlightDate,d.checkInDate,d.eventDate));
  add("end", "dates", "Дата окончания", first(d.endDate,d.returnFlightDate,d.returnDate,d.checkOutDate));
  add("net", "price", "Netto", first(d.netPrice,d.net_price,service.net_price));
  add("gross", "price", "Gross", first(d.grossPrice,d.gross_price,d.price,service.gross_price,service.price));
  add("currency", "price", "Валюта", service.currency);
  add("perPerson", "price", "За человека / пакет", first(d.pricePerPerson,d.priceFor));
  add("hotel", "hotel", "Отель / объект", first(d.hotel,d.hotelName,d.eventName));
  add("room", "hotel", "Категория номера", first(d.roomCategory,d.accommodationCategory,d.roomType,d.room));
  add("guests", "hotel", "Размещение", first(d.accommodation,d.placement));
  file("proof", "proof", "Подтверждения", d.proofImages);
  file("photos", "photos", "Фото карточки", [...new Set([...images(service.images), ...images(d.images), ...images(d.photos), ...images(d.photoUrls), ...images(d.galleryImages), ...[d.image,d.imageUrl,d.cover,d.coverImage,d.photo,d.photoUrl].filter(Boolean)])]);
  for (const [key,label] of [["title","Название"],["category","Категория"],["description","Описание"],["country","Страна"],["city","Город"],["location","Маршрут"]]) add(key,"details",label,service[key]);
  for (const [key,label] of [["directionCountry","Страна предложения"],["directionTo","Направление"],["directionFrom","Вылет из"],["meal","Питание"],["flightDetails","Рейс"]]) add(`detail_${key}`,"details",label,d[key]);
  add("food","details","Питание",first(d.food,d.meal,d.mealPlan));
  add("flight","details","Рейс",first(d.flightDetails,d.flight_details,d.flight_info));
  add("nights","dates","Ночей",d.nights);
  for (const key of ["persons","peopleCount","priceFor","priceForChild","priceForInfant"]) add(`price_${key}`,"price",key,d[key]);
  for (const key of ["includesFlight","transferIncluded","insuranceIncluded","visaIncluded","description","eventLocation","eventTime","ticketType","ticketCategory"]) add(`extra_${key}`,"details",key,d[key]);
  return result;
}
function buildCorrectionReview(request, service, review) {
  if (!request) return null;
  const saved = object(request.meta?.correction);
  const baseline = object(saved.snapshot);
  const current = correctionSnapshot(service);
  const businessDetails = object(service.details);
  const ignored = new Set(["meta","telegramPhotoFileId","proofReviewedAt","proofReviewedBy","proofReviewStatus"]);
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==="object" ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
  const fingerprint = hash({current,details:canonical(Object.fromEntries(Object.entries(businessDetails).filter(([key])=>!ignored.has(key))))});
  const codes = Array.isArray(saved.reasonCodes) ? saved.reasonCodes.filter(c => Object.hasOwn(REASON_GROUPS,c)) : [Object.hasOwn(REASON_GROUPS,request.reason_code) ? request.reason_code : "OTHER"];
  const hasBaseline = Object.keys(baseline).length > 0;
  const changes = Object.entries(current).filter(([key,v]) => baseline[key] && (baseline[key].signature || baseline[key].value) !== (v.signature || v.value)).map(([key,v]) => ({field:key,group:v.group,label:v.label,before:baseline[key].display || baseline[key].value || "—",after:v.display || v.value || "—"}));
  const validReview = String(review?.meta?.requestId) === String(request.id) && review?.meta?.fingerprint === fingerprint;
  return { requestId:request.id, requestedAt:request.created_at, reason:request.reason, reasonCodes:codes, hasBaseline, changes, checkedCodes:validReview ? (review.meta.checkedCodes || []).filter(c=>codes.includes(c)) : [], reviewStale:!!review && !validReview, editVersion:service.edit_version, fingerprint };
}
async function readCorrectionReview(db, service) {
  const requests = await db.query(`SELECT * FROM service_moderation_events WHERE service_id=$1 AND action IN ('rejected','correction_requested') ORDER BY created_at DESC,id DESC LIMIT 1`,[service.id]);
  const request = requests.rows[0] || (service.rejected_reason ? {id:`legacy:${service.id}`,created_at:service.rejected_at || service.updated_at,reason:service.rejected_reason,reason_code:object(object(service.details).meta).moderation_rejection_code,meta:{}} : null);
  if (!request) return null;
  const reviews = await db.query(`SELECT * FROM service_moderation_events WHERE service_id=$1 AND action='correction_reviewed' AND meta->>'requestId'=$2 ORDER BY created_at DESC,id DESC LIMIT 1`,[service.id,String(request.id)]);
  return buildCorrectionReview(request,service,reviews.rows[0]);
}
function correctionNotificationParts(title,reason) {
  const text=`↩️ Нужны исправления услуги\n\n📌 ${String(title || "").slice(0,200)}\n\nЗамечания:\n${reason}\n\nИсправьте замечания в разделе «Мои услуги» и отправьте услугу на модерацию повторно.`;
  const parts=[];
  for(let offset=0;offset<text.length;){let end=Math.min(offset+3900,text.length);if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1])) end--;parts.push(text.slice(offset,end));offset=end;}
  return parts;
}
module.exports = { correctionNotificationParts, REASON_GROUPS, normalizeReasonCodes, correctionSnapshot, buildCorrectionReview, readCorrectionReview };
