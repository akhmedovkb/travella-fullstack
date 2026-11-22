const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function rows(text){const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/),header=lines.shift().split('^');return lines.filter(Boolean).map(line=>Object.fromEntries(line.split('^').map((v,i)=>[header[i],v])));}
function current(r,from,to,envelope,asOf){return !r[envelope]&&(!r[from]||/^\d{4}-\d{2}-\d{2}$/.test(r[from])&&r[from]<=asOf)&&(!r[to]||/^\d{4}-\d{2}-\d{2}$/.test(r[to])&&r[to]>=asOf);}
function russian(section){const variants=String(section||'').split('=').map(s=>s.split('|')).filter(([lang,name,flags])=>lang==='ru'&&name&&!/h/.test(flags||''));return (variants.find(v=>(v[2]||'').includes('p'))||variants[0])?.[1]||'';}
function unique(entries){const groups=new Map();for(const [code,name]of entries){if(!name)continue;if(!groups.has(code))groups.set(code,new Set());groups.get(code).add(name);}const values={},ambiguous=[];for(const [code,names]of groups){if(names.size===1)values[code]=[...names][0];else ambiguous.push(code);}return {values:Object.fromEntries(Object.entries(values).sort()),ambiguous:ambiguous.sort()};}
function buildDirectory(porText,airlineText,{asOf,revision}){
 const por=rows(porText).filter(r=>/^[A-Z]{3}$/.test(r.iata_code)&&current(r,'date_from','date_until','envelope_id',asOf));
 const cityRows=por.filter(r=>['C','CA'].includes(r.location_type));
 const cityNames=unique(cityRows.map(r=>[r.iata_code,russian(r.alt_name_section)||r.name]));
 const airportRows=por.filter(r=>['A','CA'].includes(r.location_type));
 const airports=unique(airportRows.map(r=>[r.iata_code,russian(r.alt_name_section)||r.name]));
 const airportCities=unique(airportRows.map(r=>[r.iata_code,(r.city_code_list||'').split('=').map(code=>cityNames.values[code]).filter(Boolean).join(' / ')||(r.city_name_list||'').split('=').filter(Boolean).join(' / ')||airports.values[r.iata_code]]));
 const cities={...airportCities.values,...cityNames.values};
 for(const code of cityNames.ambiguous)delete cities[code];
 const activeAirlines=rows(airlineText).filter(r=>current(r,'validity_from','validity_to','env_id',asOf));
 const passengerCodes=new Set(activeAirlines.filter(r=>!/^C/.test(r.type||'')).map(r=>r['2char_code']));
 const iata=unique(activeAirlines.filter(r=>!/^C/.test(r.type||'')||!passengerCodes.has(r['2char_code'])).filter(r=>/^[A-Z0-9]{2}$/.test(r['2char_code'])).map(r=>[r['2char_code'],r.name]));
 const icao=unique(activeAirlines.filter(r=>/^[A-Z]{3}$/.test(r['3char_code'])).map(r=>[r['3char_code'],r.name]));
 const airportsIcao=unique(airportRows.filter(r=>/^[A-Z0-9]{4}$/.test(r.icao_code)).map(r=>[r.icao_code,russian(r.alt_name_section)||r.name]));
 const citiesIcao=unique(airportRows.filter(r=>/^[A-Z0-9]{4}$/.test(r.icao_code)).map(r=>[r.icao_code,cities[r.iata_code]]));
 return {source:{name:'OpenTravelData',url:'https://github.com/opentraveldata/opentraveldata',license:'CC-BY-4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',revision,asOf,modified:'Filtered current records; extracted Russian names with original-name fallback; omitted ambiguous code assignments.',sha256:{places:crypto.createHash('sha256').update(porText).digest('hex'),airlines:crypto.createHash('sha256').update(airlineText).digest('hex')}},cities:Object.fromEntries(Object.entries(cities).sort()),airports:airports.values,airportsIcao:airportsIcao.values,citiesIcao:citiesIcao.values,airlines:iata.values,airlinesIcao:icao.values,ambiguous:{cities:cityNames.ambiguous,airportCities:airportCities.ambiguous,airports:airports.ambiguous,airlines:iata.ambiguous,airlinesIcao:icao.ambiguous}};
}
async function main(){
 const args=process.argv.slice(2),arg=n=>args[args.indexOf(n)+1],asOf=args.includes('--as-of')?arg('--as-of'):new Date().toISOString().slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw Error('Invalid as-of date');
 let revision,por,air;
 if(args.includes('--source-dir')){const dir=arg('--source-dir');revision=fs.readFileSync(path.join(dir,'aviation-source-commit.txt'),'utf8').trim().replace(/^\uFEFF/,'');por=fs.readFileSync(path.join(dir,'optd_por_public.csv'),'utf8');air=fs.readFileSync(path.join(dir,'optd_airlines.csv'),'utf8');}
 else {const get=async url=>{const r=await fetch(url,{headers:{'User-Agent':'Travella-directory-import'},signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Download failed: '+r.status);return r.text();};revision=JSON.parse(await get('https://api.github.com/repos/opentraveldata/opentraveldata/commits/master')).sha;[por,air]=await Promise.all(['optd_por_public.csv','optd_airlines.csv'].map(name=>get('https://raw.githubusercontent.com/opentraveldata/opentraveldata/'+revision+'/opentraveldata/'+name)));}
 if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Invalid source revision');
 const result=buildDirectory(por,air,{asOf,revision});const counts={cities:Object.keys(result.cities).length,airports:Object.keys(result.airports).length,airlines:Object.keys(result.airlines).length,airlinesIcao:Object.keys(result.airlinesIcao).length};
 if(counts.airports<5000||counts.airlines<300||result.cities.TAS!=='Ташкент'||result.airlines.HY!=='Uzbekistan Airways')throw Error('Directory validation failed');
 const dest=path.join(__dirname,'../data/aviation/directory.json');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest+'.tmp',JSON.stringify(result,null,2)+'\n');fs.renameSync(dest+'.tmp',dest);console.log(JSON.stringify({revision,asOf,...counts,ambiguousAirlines:result.ambiguous.airlines.length}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={buildDirectory,russian,current,unique};
