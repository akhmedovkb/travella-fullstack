import fs from 'node:fs';
import path from 'node:path';
import {SITE,LANGUAGES,copy,staticPages,publicShell,languagePath,localized,servicePath,metadata,headTags,structuredData,renderBody,esc,json} from '../shared/seo.js';
import spaRoutes from '../shared/spaRoutes.json' with {type:'json'};
let template;
function htmlTemplate(){if(template)return template;for(const file of ['frontend/dist/index.html','dist/index.html']){try{template=fs.readFileSync(path.join(process.cwd(),file),'utf8');return template;}catch{}}throw Error('SEO_TEMPLATE_MISSING');}
const backend=()=>String(process.env.BACKEND_URL||process.env.VITE_API_BASE_URL||'https://travella-fullstack-production.up.railway.app').replace(/\/+$/,'').replace(/\/api$/,'');
async function data(resource){const response=await fetch(backend()+'/api/seo/'+resource,{signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});if(response.status===404)return null;if(!response.ok)throw Error('SEO_UPSTREAM_'+response.status);return response.json();}
const knownSpa=p=>spaRoutes.some(pattern=>new RegExp('^'+pattern.split('/').map(part=>part.startsWith(':')?'[^/]+':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')+'/?$').test(p));
const xml=value=>esc(value);
const alternate=(p,langs)=>langs.map(l=>`<xhtml:link rel="alternate" hreflang="${l}" href="${xml(SITE+localized(p,l))}"/>`).join('')+`<xhtml:link rel="alternate" hreflang="x-default" href="${xml(SITE+localized(p,'ru'))}"/>`;
const urlset=urls=>'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'+urls.join('')+'</urlset>';
const redirect=(res,to)=>res.status(308).setHeader('Location',to).end();
function sendHtml(res,{status=200,lang='ru',page='/',item=null,items=[],indexable=true,error=null,canonical=null}){
 const meta=metadata(page,lang,item);meta.indexable=indexable&&meta.indexable;if(canonical)meta.url=canonical;if(!meta.indexable)meta.languages=[];
 if(error){meta.title=copy[lang][error]+' | Travella';meta.description=copy[lang][error==='notFound'?'notFoundHint':'retry'];meta.languages=[];}
 let source=htmlTemplate().replace(/<html\s+lang="[^"]*"/,'<html lang="'+lang+'"').replace(/<title>[\s\S]*?<\/title>/,'');
 const head=headTags(meta,lang,item?servicePath(item):page)+`<script type="application/ld+json">${json(structuredData(meta,lang,item))}</script><script type="application/json" id="travella-seo-data">${json({service:item,meta,language:lang,path:page})}</script>`;
 const body=error?`<main style="max-width:800px;margin:60px auto;padding:24px;font-family:system-ui"><h1>${esc(copy[lang][error])}</h1><p>${esc(meta.description)}</p><a href="${localized('/',lang)}">${esc(copy[lang].back)}</a></main>`:renderBody(meta,lang,item?servicePath(item):page,item,items);
 source=source.replace('</head>',head+'</head>').replace('<div id="root"></div>','<div id="root">'+body+'</div>');
 res.status(status).setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Language',lang);res.setHeader('X-Robots-Tag',meta.indexable?'index, follow':'noindex, follow');res.setHeader('Cache-Control',status===200?'public, max-age=0, s-maxage=60, stale-while-revalidate=120':'no-store');if(status===503)res.setHeader('Retry-After','60');res.send(source);
}
export default async function handler(req,res){
 let requested=String(req.query.path||new URL(req.url,SITE).pathname||'/');if(!requested.startsWith('/'))requested='/'+requested;
 if(requested.includes('..')||requested.length>2048)return sendHtml(res,{status:404,indexable:false,error:'notFound'});
 const params=new URLSearchParams();for(const[k,v]of Object.entries(req.query||{}))if(k!=='path')for(const value of Array.isArray(v)?v:[v])params.append(k,String(value));
 const suffix=params.size?'?'+params.toString():'';
 if(String(req.headers.host||'').split(':')[0]==='www.travella.uz')return redirect(res,SITE+requested+suffix);
 if(requested.endsWith('/')&&requested!=='/')return redirect(res,requested.slice(0,-1)+suffix);
 try{
  if(requested==='/robots.txt'){
   const rules=['User-agent: *',...['admin','dashboard','client','login','register','donas-dosas'].flatMap(section=>['','/ru','/uz','/en'].map(prefix=>'Disallow: '+prefix+'/'+section)), 'Disallow: /api/admin/','Disallow: /api/telegram/','', 'Sitemap: '+SITE+'/sitemap.xml'];
   return res.status(200).setHeader('Content-Type','text/plain; charset=utf-8').setHeader('Cache-Control','public, max-age=300').send(rules.join('\n')+'\n');
  }
  if(requested==='/sitemap.xml'){
   const first=await data('services?limit=1');const partitions=Math.ceil((first?.maxId||0)/1000);const files=['/sitemaps/pages.xml',...Array.from({length:partitions},(_,i)=>'/sitemaps/services-'+i+'.xml')];
   return res.status(200).setHeader('Content-Type','application/xml; charset=utf-8').setHeader('Cache-Control','public, max-age=300').send('<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+files.map(p=>'<sitemap><loc>'+SITE+p+'</loc></sitemap>').join('')+'</sitemapindex>');
  }
  if(requested==='/sitemaps/pages.xml'){
   const urls=staticPages.flatMap(p=>{const langs=p==='/community'?['ru']:LANGUAGES;return langs.map(l=>'<url><loc>'+SITE+localized(p,l)+'</loc>'+alternate(p,langs)+'</url>');});
   return res.status(200).setHeader('Content-Type','application/xml; charset=utf-8').setHeader('Cache-Control','public, max-age=300').send(urlset(urls));
  }
  const sitemap=requested.match(/^\/sitemaps\/services-(\d+)\.xml$/);
  if(sitemap){const n=Number(sitemap[1]);if(n>10000)return res.status(404).end();let cursor=n*1000,items=[];while(cursor<(n+1)*1000){const list=await data('services?limit=500&after='+cursor+'&before='+((n+1)*1000+1));items.push(...list.items);if(!list.nextCursor)break;cursor=list.nextCursor;}const unique=[...new Map(items.map(s=>[s.id,s])).values()];
   const urls=unique.flatMap(item=>LANGUAGES.map(l=>'<url><loc>'+SITE+localized(servicePath(item),l)+'</loc>'+(item.updated?'<lastmod>'+item.updated+'</lastmod>':'')+alternate(servicePath(item),LANGUAGES)+'</url>'));
   return res.status(200).setHeader('Content-Type','application/xml; charset=utf-8').setHeader('Cache-Control','public, max-age=120').send(urlset(urls));
  }
  const parsed=languagePath(requested),lang=parsed.language;let page=parsed.path;
  const legacy=Number(params.get('opened')||params.get('service'));
  if(legacy>0&&!params.has('unlock')&&params.get('view')!=='details'&&['/','/marketplace'].includes(page)){const found=await data('services/'+legacy);if(!found?.item)return sendHtml(res,{status:404,lang,indexable:false,error:'notFound'});return redirect(res,localized(servicePath(found.item),lang));}
  if(page==='/marketplace')return redirect(res,localized('/',lang)+suffix);
  if(page==='/india')return redirect(res,localized('/india/inside',lang)+suffix);
  const service=page.match(/^\/services\/(\d+)(?:-[a-z0-9-]+)?$/);
  if(service){const found=await data('services/'+service[1]);if(!found?.item)return sendHtml(res,{status:404,lang,indexable:false,error:'notFound'});const target=localized(servicePath(found.item),lang);if(requested!==target)return redirect(res,target);return sendHtml(res,{lang,page:servicePath(found.item),item:found.item});}
  if(staticPages.includes(page)){
   if(!parsed.prefix)return redirect(res,localized(page,lang)+suffix);
   const list=['/','/hotels'].includes(page)?await data('services?limit=500'):null;
   const items=(list?.items||[]).filter(s=>page!=='/hotels'||s.category==='refused_hotel');
   return sendHtml(res,{lang,page,items,indexable:![...params.keys()].some(k=>!/^utm_|^(gclid|fbclid)$/.test(k))});
  }
  if(publicShell(page)){if(!parsed.prefix)return redirect(res,localized(page,lang)+suffix);return sendHtml(res,{lang,page,indexable:!params.size});}
  if(knownSpa(page))return sendHtml(res,{lang,page,indexable:false,canonical:SITE+requested});
  return sendHtml(res,{status:404,lang,indexable:false,error:'notFound'});
 }catch(e){console.error('[seo-page]',e.message);return sendHtml(res,{status:503,lang:languagePath(requested).language,indexable:false,error:'unavailable'});}
}
