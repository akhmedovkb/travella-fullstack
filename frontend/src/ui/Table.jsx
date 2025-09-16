export function Table({children}){ return <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-white">{children}</div>; }
export function THead({children}){ return <div className="grid grid-cols-3 bg-gray-50 text-xs uppercase tracking-wide text-gray-600 px-4 py-2">{children}</div>; }
export function TRow({children}){ return <div className="grid grid-cols-3 px-4 py-3 border-t border-[var(--line)] items-center">{children}</div>; }
export function TCell({children, className=''}){ return <div className={className}>{children}</div>; }
