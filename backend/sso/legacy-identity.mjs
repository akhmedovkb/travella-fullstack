import {jwtVerify} from 'jose';
const types=new Set(['guide','transport','agent','hotel']);
export async function loadLegacyIdentity({sub,pool}){
 const match=/^(provider|client):([1-9]\d*)$/.exec(sub||'');if(!match||!Number.isSafeInteger(Number(match[2])))throw Error('Invalid account identity');const kind=match[1];
 const common="'id',p.id,'name',p.name,'email',p.email,'phone',p.phone,'email_verified',to_jsonb(p)->'email_verified','emailVerified',to_jsonb(p)->'emailVerified','status',to_jsonb(p)->'status','deleted_at',to_jsonb(p)->'deleted_at','is_active',to_jsonb(p)->'is_active','is_blocked',to_jsonb(p)->'is_blocked'";
 const sql=kind==='provider'?`SELECT jsonb_build_object(${common},'type',p.type,'location',p.location,'social',p.social) AS identity FROM providers p WHERE p.id=$1`:`SELECT jsonb_build_object(${common},'telegram',p.telegram) AS identity FROM clients p WHERE p.id=$1`;
 const {rows}=await pool.query(sql,[Number(match[2])]);const row=rows[0]?.identity;if(!row||row.deleted_at||row.is_blocked===true||row.is_active===false||['blocked','suspended','disabled','rejected'].includes(String(row.status).toLowerCase()))throw Error('Account unavailable');
 if(kind==='provider'&&!types.has(row.type))throw Error('Unsupported supplier type');if(!row.email||!row.name)throw Error('Complete the TRAVELLA profile first');
 return {sub:`${kind}:${Number(row.id)}`,name:row.name,email:String(row.email).toLowerCase(),email_verified:row.email_verified===true||row.emailVerified===true,account_type:kind,provider_type:kind==='provider'?row.type:'',phone_number:row.phone||'',location:Array.isArray(row.location)?row.location.join(', '):row.location||'',telegram:row.social||row.telegram||'',active:true};
}
/** Proposed TRAVELLA adapter. Reads only allowlisted identity fields, never passwords. */
export async function resolveLegacyIdentity({token,kind,pool,jwtSecret}){
 if(!['provider','client'].includes(kind)||typeof token!=='string'||!jwtSecret)throw Error('Authentication required');
 const {payload}=await jwtVerify(token,new TextEncoder().encode(jwtSecret),{algorithms:['HS256'],requiredClaims:['exp','iat']});
 if(payload.role!==kind||!Number.isSafeInteger(Number(payload.id))||Number(payload.id)<1)throw Error('Account namespace mismatch');
 return loadLegacyIdentity({sub:`${kind}:${Number(payload.id)}`,pool});
}
