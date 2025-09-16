import { cx } from './cx';
export default function Tabs({value, onChange, items}){
  return (
    <div className="inline-flex gap-2">
      {items.map(it=>(
        <button
          key={it.value}
          onClick={()=>onChange(it.value)}
          className={cx(
            'h-8 px-3 rounded-full text-sm border',
            value===it.value
              ? 'bg-[var(--brand)] text-white border-transparent'
              : 'bg-white text-[var(--fg)] border-[var(--line)] hover:bg-gray-50'
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
