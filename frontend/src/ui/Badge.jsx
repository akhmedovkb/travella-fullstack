import { cx } from './cx';
export default function Badge({variant='muted', children, className=''}) {
  const map = {
    muted:'bg-gray-100 text-gray-700',
    success:'bg-emerald-100 text-emerald-700',
    warning:'bg-amber-100 text-amber-800',
    danger:'bg-rose-100 text-rose-700',
  };
  return <span className={cx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', map[variant], className)}>{children}</span>;
}
