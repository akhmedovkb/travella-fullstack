const { ensureServiceModerationEvents } = require("./serviceModerationEvents");
const { readCorrectionReview } = require("./serviceCorrections");
const { applyServiceLifecycleAction } = require("./serviceLifecycle");
const fail = (message,code,status=409) => Object.assign(new Error(message),{code,status});
async function readProviderCorrection(db,service) {
  if (["published","approved","active","archived","deleted"].includes(String(service.status)) || service.deleted_at) return null;
  const review=await readCorrectionReview(db,service);
  if(!review) return null;
  const approved=await db.query(`SELECT id FROM service_moderation_events WHERE service_id=$1 AND action IN ('approved','approved_clean','approved_with_warnings') AND created_at>$2 LIMIT 1`,[service.id,review.requestedAt]);
  if(approved.rows.length) return null;
  return {requestId:review.requestId,requestedAt:review.requestedAt,reason:review.reason,reasonCodes:review.reasonCodes,reasonItems:review.reasonItems,editVersion:service.edit_version,fingerprint:review.fingerprint,submittedAt:service.submitted_at||null,pending:service.status==='pending' || service.moderation_status==='pending',providerSubmission:review.providerSubmission};
}
function assertCorrectionAcknowledged(current,input) {
  if(!current) return;
  if (!input || String(input.requestId)!==String(current.requestId) || input.expected_edit_version!==current.editVersion || input.fingerprint!==current.fingerprint) throw fail("Замечания или данные услуги изменились. Обновите чеклист перед отправкой.","CORRECTION_STALE");
  const codes=input.checkedCodes;
  if(!Array.isArray(codes) || codes.length>10 || codes.some(c=>!current.reasonCodes.includes(c)) || current.reasonCodes.some(c=>!codes.includes(c))) throw fail("Подтвердите исправление каждого замечания модератора.","CORRECTION_CHECKLIST_REQUIRED",400);
}
async function submitProviderService(pool,{providerId,serviceId,correction}) {
  if(!Number.isSafeInteger(Number(serviceId)) || Number(serviceId)<=0 || !Number.isSafeInteger(Number(providerId)) || Number(providerId)<=0) throw fail("Некорректная услуга","BAD_SERVICE_OR_PROVIDER_ID",400);
  await ensureServiceModerationEvents(pool);
  const db=await pool.connect();let open=false;
  try {
    await db.query("BEGIN");open=true;
    const current=await db.query(`SELECT s.*, to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS edit_version FROM services s WHERE id=$1 AND provider_id=$2 AND deleted_at IS NULL FOR UPDATE`,[serviceId,providerId]);
    const service=current.rows[0];
    if(!service) throw fail("Услуга не найдена","SERVICE_NOT_FOUND",404);
    if(service.status==='pending' || service.moderation_status==='pending') throw fail("Услуга уже отправлена на модерацию","SERVICE_ALREADY_PENDING");
    const currentCorrection=await readProviderCorrection(db,service);
    assertCorrectionAcknowledged(currentCorrection,correction);
    const applied=await applyServiceLifecycleAction(db,{providerId,serviceId,action:"submit"});
    if(currentCorrection) await db.query(`INSERT INTO service_moderation_events (service_id,actor_id,actor_role,action,from_status,to_status,meta) VALUES ($1,$2,'provider','correction_resubmitted',$3,'pending',$4::jsonb)`,[serviceId,providerId,service.status,JSON.stringify({requestId:currentCorrection.requestId,checkedCodes:[...new Set(correction.checkedCodes)],fingerprint:currentCorrection.fingerprint})]);
    await db.query("COMMIT");open=false;
    return {...applied,resubmitted:Boolean(currentCorrection)};
  } finally {if(open) await db.query("ROLLBACK");db.release();}
}
function moderationServiceUrl(base,id,resubmitted=false) {
  const root=String(base || "").replace(/\/+$/,"");
  if(!root || !/^\d+$/.test(String(id))) return root ? `${root}/admin/operations?tab=moderation` : "";
  const query=new URLSearchParams({tab:"moderation",m_status:"pending",m_q:`#${id}`,m_focus:String(id),m_open:"1"});
  if(resubmitted) query.set("m_section","correction");
  return `${root}/admin/operations?${query}`;
}
module.exports={readProviderCorrection,assertCorrectionAcknowledged,submitProviderService,moderationServiceUrl};
