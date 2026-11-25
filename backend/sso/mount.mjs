import {createTravellaIssuer} from './travella-issuer.mjs';
import {postgresOidcAdapter} from './postgres-adapter.mjs';
import {resolveLegacyIdentity,loadLegacyIdentity} from './legacy-identity.mjs';
/** Mount only after approval. Disabled unless explicitly configured; performs no migration. */
export function createTravellaSso(pool,env=process.env){
 if(env.TRAVELLA_SSO_ENABLED!=='1')return false;
 const issuer=env.TRAVELLA_SSO_ISSUER;if(issuer!=='https://travella.uz/api/sso')throw Error('Unapproved SSO issuer');
 const cityCallback=env.TRAVELLA_SSO_CITY_CALLBACK;if(cityCallback!=='https://city.travella.uz/api/auth/callback/travella')throw Error('Unapproved CITY callback');
 const cookieKeys=JSON.parse(env.TRAVELLA_SSO_COOKIE_KEYS||'[]');const jwks=JSON.parse(env.TRAVELLA_SSO_SIGNING_JWKS||'null');
 if(!env.JWT_SECRET||!env.TRAVELLA_SSO_CLIENT_SECRET||cookieKeys.some(k=>typeof k!=='string'||k.length<32))throw Error('SSO credentials required');
 const service=createTravellaIssuer({issuer,cityCallback,clientId:'travella-city',clientSecret:env.TRAVELLA_SSO_CLIENT_SECRET,cookieKeys,jwks,adapter:postgresOidcAdapter(pool),findIdentity:async sub=>{try{return await loadLegacyIdentity({sub,pool})}catch{return undefined}},authenticateLegacy:args=>resolveLegacyIdentity({...args,pool,jwtSecret:env.JWT_SECRET})});
 service.provider.proxy=true;
 return (req,res,next)=>{
  // Railway terminates TLS and may replace forwarded host. Pin OIDC URLs to the approved public issuer.
  req.headers.host='travella.uz';
  req.headers['x-forwarded-host']='travella.uz';
  req.headers['x-forwarded-proto']='https';
  return service.router(req,res,next);
 };
}
