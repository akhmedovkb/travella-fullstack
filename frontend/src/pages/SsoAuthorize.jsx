import {useEffect,useState} from 'react';
import './SsoAuthorize.css';
/** Proposed TRAVELLA page. Existing tokens go only to the same-origin TRAVELLA API. */
export default function SsoAuthorize(){const [details,setDetails]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);const uid=new URLSearchParams(location.search).get('uid')||'';
 useEffect(()=>{if(!/^[a-zA-Z0-9_-]{8,200}$/.test(uid)){setError('Недействительный запрос входа. Начните вход из CITY OS.');return}fetch('/api/sso/interaction/'+encodeURIComponent(uid)+'/details',{credentials:'same-origin',cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Запрос истёк. Начните вход заново из CITY OS.');setDetails(await r.json())}).catch(e=>setError(e.message))},[uid]);
 async function proceed(kind){setBusy(true);setError('');try{const token=kind==='provider'?(localStorage.getItem('token')||localStorage.getItem('providerToken')):localStorage.getItem('clientToken');if(details.prompt==='login'&&!token)throw Error('Сначала войдите в соответствующий аккаунт TRAVELLA, затем повторите вход из CITY OS.');const r=await fetch('/api/sso/interaction/'+encodeURIComponent(uid)+'/continue',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({kind,csrf:details.csrf})});if(!r.ok)throw Error('Вход отклонён. Проверьте выбранный аккаунт или начните заново.');const result=await r.json();const next=new URL(result.redirectTo,location.origin);if(next.origin!==location.origin)throw Error('Некорректное продолжение входа.');location.assign(next.href)}catch(e){setError(e.message);setBusy(false)}}
 return <main className="travella-sso"><section className="travella-sso__card" aria-labelledby="sso-heading">
 <span className="travella-sso__eyebrow">ЭКОСИСТЕМА TRAVELLA · CITY OS</span>
 <h1 id="sso-heading">Один аккаунт.<br/>Больше возможностей.</h1>
 <p className="travella-sso__intro">Войдите в туристический город с вашим аккаунтом TRAVELLA.</p>
 {details?.prompt==='login' && <><h2>Выберите ваш аккаунт</h2><div className="travella-sso__accounts">
 {[['client','Путешественник','Открывайте места и планируйте путешествия.','/client/login'],['provider','Поставщик услуг','Развивайте бизнес и работайте с партнёрами.','/login']].map(([kind,title,description,href])=><div className="travella-sso__account" key={kind}><span className="travella-sso__symbol" aria-hidden="true">{kind==='client'?<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>:<svg viewBox="0 0 24 24"><path d="M4 21V5h16v16M2 21h20M9 21v-5h6v5M8 9h1m6 0h1M8 12h1m6 0h1"/></svg>}</span><h3>{title}</h3><p>{description}</p><button className="travella-sso__primary" disabled={busy} onClick={()=>proceed(kind)}>{busy?'Подождите…':'Продолжить'}<span aria-hidden="true"> →</span></button><a href={href}>Войти в аккаунт TRAVELLA</a></div>)}
 </div></>}
 {details?.prompt==='consent' && <div className="travella-sso__consent"><h2>Разрешить вход в CITY OS?</h2><p>Ваш профиль будет связан с туристическим городом.</p><button className="travella-sso__primary" disabled={busy} onClick={()=>proceed('client')}>{busy?'Подключаем…':'Разрешить и продолжить →'}</button></div>}
 {!details&&!error&&<p role="status">Проверяем запрос входа…</p>}
 <details className="travella-sso__privacy" open={details?.prompt==='consent'}><summary>Какие данные будут переданы?</summary><p>Идентификатор аккаунта, имя, email с признаком подтверждения, тип аккаунта и контактные данные профиля. Пароль и платёжные данные не передаются.</p></details>
 {error&&<p className="travella-sso__error" role="alert">{error}</p>}
 <a className="travella-sso__cancel" href="https://city.travella.uz">← Вернуться в CITY OS</a>
 </section><p className="travella-sso__footer">Люди, места и возможности — вместе с TRAVELLA.</p></main>
}
