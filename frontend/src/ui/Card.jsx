export default function Card({className='', children}){
  return <div className={`bg-white rounded-[var(--radius)] shadow-sm border border-[var(--line)] ${className}`} style={{boxShadow:'var(--shadow)'}}>{children}</div>;
}
