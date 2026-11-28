import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../../api';
import './DonasKnowledge.css';

const statuses = { draft: 'Draft', rd: 'R&D', approved: 'Approved' };
const base = '/admin/donas-dosas';
const date = value => new Date(value).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' });
const copy = value => JSON.parse(JSON.stringify(value));

function StatusSelect({ value, onChange, label, disabled }) {
  return <label className="dk-field">{label}<select aria-label={label} value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
    {Object.entries(statuses).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
  </select></label>;
}

// Small, safe reader for the stored text format. It never interprets HTML.
function Inline({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part);
}
function Content({ text }) {
  const lines = text.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith('|')) {
      const table = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!/^\|[\s:|\-]+$/.test(lines[i])) table.push(lines[i].split('|').slice(1, -1).map(c => c.trim()));
        i++;
      }
      i--;
      blocks.push(<div className="dk-table" key={i}><table><thead><tr>{table[0]?.map((c,j) => <th key={j}><Inline text={c} /></th>)}</tr></thead>
        <tbody>{table.slice(1).map((row,j) => <tr key={j}>{row.map((c,k) => <td key={k}><Inline text={c} /></td>)}</tr>)}</tbody></table></div>);
    } else if (/^#{1,6} /.test(line)) {
      blocks.push(<h3 key={i}><Inline text={line.replace(/^#+ /, '')} /></h3>);
    } else if (line !== '---') {
      blocks.push(<p key={i}><Inline text={line} /></p>);
    }
  }
  return <div className="dk-content">{blocks}</div>;
}

export default function DonasKnowledge({ kind }) {
  const [document, setDocument] = useState(null);
  const [form, setForm] = useState(null);
  const [history, setHistory] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [selected, setSelected] = useState(0);
  const [past, setPast] = useState(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  const endpoint = `/api/admin/donas/knowledge/${kind}`;
  const label = kind === 'business-concept' ? 'Business Concept' : 'Product Bible';

  function accept(doc) {
    setDocument(doc); setForm({ ...copy(doc), change_note: '' });
    setSelected(i => Math.min(i, doc.sections.length - 1));
    setPast(null); setDirty(false); setEditing(false); setMissing(false);
  }
  async function load() {
    setBusy(true); setError('');
    try {
      const [current, versions] = await Promise.all([apiGet(endpoint, 'admin'), apiGet(`${endpoint}/history`, 'admin')]);
      if (!alive.current) return;
      accept(current.document); setHistory(versions.items); setNextBefore(versions.nextBefore);
    } catch (e) {
      if (!alive.current) return;
      setMissing(e.status === 404); setError(e.message || 'Не удалось загрузить документ');
    } finally { if (alive.current) setBusy(false); }
  }
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [kind]); // route remounts by kind
  useEffect(() => {
    if (!dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function canLeave() { return !dirty || window.confirm('Есть несохранённые изменения. Продолжить без сохранения?'); }
  function change(values) { setForm(f => ({ ...f, ...values })); setDirty(true); setMessage(''); }
  function changeSection(values) {
    setForm(f => ({ ...f, sections: f.sections.map((s,i) => i === selected ? { ...s, ...values } : s) }));
    setDirty(true); setMessage('');
  }
  async function initialize() {
    setBusy(true); setError('');
    try { await apiPost(`${endpoint}/initialize`, {}, 'admin'); await load(); }
    catch(e) { if (e.status === 409) await load(); else { setError(e.message); setBusy(false); } }
  }
  async function save(asDraft = false) {
    setBusy(true); setError(''); setMessage('');
    const payload = asDraft ? { ...form, status: 'draft', sections: form.sections.map(s => ({ ...s, status: 'draft' })), change_note: 'Новый черновик на основе утверждённого документа' } : form;
    try {
      const result = await apiPost(`${endpoint}/versions`, { ...payload, expectedRevision: document.revision }, 'admin');
      accept(result.document);
      setHistory(h => [{ ...result.document }, ...h]);
      setMessage(`Сохранено: ревизия ${result.document.revision}`);
      if (asDraft) setEditing(true);
    } catch(e) { setError(e.message || 'Не удалось сохранить. Изменения остаются в редакторе.'); }
    finally { setBusy(false); }
  }
  async function openVersion(revision) {
    if (!canLeave()) return;
    setBusy(true); setError('');
    try {
      const result = await apiGet(`${endpoint}?revision=${revision}`, 'admin');
      setPast(result.document); setSelected(0); setEditing(false);
      setForm({ ...copy(document), change_note: '' }); setDirty(false);
    } catch(e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function moreHistory() {
    setBusy(true);
    try {
      const result = await apiGet(`${endpoint}/history?before=${nextBefore}`, 'admin');
      setHistory(h => [...h, ...result.items]); setNextBefore(result.nextBefore);
    } catch(e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const shown = past || form;
  const section = shown?.sections[selected];
  const locked = !!past || document?.status === 'approved';

  return <main className="dk" aria-busy={busy}>
    <header className="dk-header">
      <p className="dk-eyebrow">DONA’S TIKKA · РАЗВИТИЕ КОНЦЕПЦИИ</p>
      <h1>{label}</h1>
      <p>Стратегия и продуктовые стандарты с историей решений.</p>
      <nav aria-label="Разделы Dona’s"><Link to={`${base}/business-concept`} onClick={e => { if (!canLeave()) e.preventDefault(); }} aria-current={kind === 'business-concept' ? 'page' : undefined}>Business Concept</Link>
        <Link to={`${base}/product-bible`} onClick={e => { if (!canLeave()) e.preventDefault(); }} aria-current={kind === 'product-bible' ? 'page' : undefined}>Product Bible</Link>
        <Link to={`${base}/menu/ingredients`} onClick={e => { if (!canLeave()) e.preventDefault(); }}>Ingredients / Recipes</Link>
        <Link to={`${base}/inventory`} onClick={e => { if (!canLeave()) e.preventDefault(); }}>Inventory</Link>
        <Link to={`${base}/finance`} onClick={e => { if (!canLeave()) e.preventDefault(); }}>Finance</Link></nav>
    </header>
    <p className="dk-notice">Материалы из обсуждения — гипотезы для проверки. Цены, выход и сроки хранения требуют подтверждения. Утверждение документа не запускает производство и не изменяет рецепты или расчёты.</p>
    {error ? <div role="alert" className="dk-error">{error} {!missing && <button disabled={busy} onClick={() => { if (canLeave()) load(); }}>Загрузить актуальную версию</button>}</div> : null}
    {message ? <p role="status" className="dk-success">{message}</p> : null}
    {busy && !shown ? <p role="status">Загрузка документа…</p> : null}
    {missing ? <section className="dk-card"><h2>Начальное содержание готово</h2><p>Создайте документ из обсуждения: {label} {kind === 'business-concept' ? '2.0 · Draft' : '1.0 · R&D'}. Существующие данные сохраняются.</p><button className="dk-primary" disabled={busy} onClick={initialize}>Создать документ из обсуждения</button></section> : null}
    {shown ? <div className="dk-grid">
      <aside className="dk-card dk-sidebar"><h2>Содержание</h2><nav aria-label="Разделы документа">{shown.sections.map((s,i) => <button key={s.key} disabled={busy} aria-current={selected === i ? 'true' : undefined} onClick={() => setSelected(i)}><span>{String(i+1).padStart(2,'0')} · {s.title}</span><small>{statuses[s.status]}</small></button>)}</nav>
        {editing && !locked ? <button disabled={busy || shown.sections.length >= 40} onClick={() => {
          const key = `section-${Date.now()}`;
          change({ sections: [...form.sections, { key, title: 'Новый раздел', content: 'Добавьте содержание раздела.', status: 'draft' }] });
          setSelected(form.sections.length);
        }}>+ Добавить раздел</button> : null}
      </aside>
      <div className="dk-main">
        <section className="dk-card">
          <div className="dk-meta"><span className={`dk-badge dk-${shown.status}`}>{statuses[shown.status]}</span><span>Версия {shown.edition} · ревизия {shown.revision}</span><span>{date(shown.created_at)} · автор {shown.actor_id}</span></div>
          {past ? <div className="dk-notice">Просмотр истории. <button disabled={busy} onClick={() => { setPast(null); setSelected(0); }}>Вернуться к текущей версии</button></div> : null}
          {editing && !locked ? <div className="dk-fields">
            <label className="dk-field">Название документа<input maxLength={200} value={form.title} disabled={busy} onChange={e => change({ title: e.target.value })} /></label>
            <label className="dk-field">Версия<input maxLength={40} value={form.edition} disabled={busy} onChange={e => change({ edition: e.target.value })} /></label>
            <StatusSelect label="Статус документа" value={form.status} disabled={busy} onChange={status => change({ status })} />
          </div> : <h2>{shown.title}</h2>}
          {!past ? <div className="dk-actions">
            {locked ? <button className="dk-primary" disabled={busy} onClick={() => save(true)}>Создать новый черновик</button> : <button disabled={busy} onClick={() => setEditing(v => !v)}>{editing ? 'Предпросмотр' : 'Редактировать'}</button>}
            <span>{dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}</span>
          </div> : null}
        </section>
        {section ? <section className="dk-card">
          {editing && !locked ? <>
            <label className="dk-field">Название раздела<input maxLength={200} value={section.title} disabled={busy} onChange={e => changeSection({ title: e.target.value })} /></label>
            <StatusSelect label="Статус раздела" value={section.status} disabled={busy} onChange={status => changeSection({ status })} />
            <label className="dk-field">Содержание (текст, заголовки и таблицы Markdown)<textarea rows={18} maxLength={30000} value={section.content} disabled={busy} onChange={e => changeSection({ content: e.target.value })} /></label>
          </> : <><div className="dk-meta"><span className={`dk-badge dk-${section.status}`}>{statuses[section.status]}</span></div><h2>{section.title}</h2><Content text={section.content} /></>}
        </section> : null}
        {!past && !locked && dirty ? <section className="dk-card dk-save"><label className="dk-field">Что изменилось?<input maxLength={1000} value={form.change_note} disabled={busy} onChange={e => change({ change_note: e.target.value })} placeholder="Кратко опишите решение для истории версий" /></label>
          {form.status === 'approved' && form.sections.some(s => s.status !== 'approved') ? <p>Для утверждения документа сначала утвердите каждый раздел.</p> : null}
          <button className="dk-primary" disabled={busy || !form.change_note.trim() || (form.status === 'approved' && form.sections.some(s => s.status !== 'approved'))} onClick={() => save()}>Сохранить новую ревизию</button>
        </section> : null}
        <section className="dk-card"><h2>История версий</h2><p>Каждое сохранение создаёт неизменяемую ревизию. Время указано для Ташкента.</p><ol className="dk-history">{history.map(v => <li key={v.revision}><button disabled={busy} onClick={() => openVersion(v.revision)}>Версия {v.edition} · ревизия {v.revision} · {statuses[v.status]}</button><p>{v.change_note}</p><small>{date(v.created_at)} · автор {v.actor_id}</small></li>)}</ol>{nextBefore ? <button disabled={busy} onClick={moreHistory}>Загрузить более ранние</button> : null}</section>
      </div>
    </div> : null}
  </main>;
}
