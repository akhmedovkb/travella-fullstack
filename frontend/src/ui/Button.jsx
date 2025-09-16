import { cx } from './cx';

export default function Button({
  variant='primary', size='md', className='', ...props
}){
  const base = 'inline-flex items-center justify-center font-semibold rounded-[var(--radius)] transition focus:outline-none focus:ring-2 focus:ring-offset-2';
  const variants = {
    primary: 'bg-[var(--brand)] text-white hover:bg-[var(--brand-600)] focus:ring-[var(--brand)]',
    secondary:'bg-white text-[var(--fg)] border border-[var(--line)] hover:bg-gray-50 focus:ring-gray-300',
    ghost:   'bg-transparent text-[var(--fg)] hover:bg-gray-100 focus:ring-gray-300',
    danger:  'bg-[var(--danger)] text-white hover:bg-red-600 focus:ring-[var(--danger)]',
  };
  const sizes = { sm:'h-9 px-3 text-sm', md:'h-10 px-4', lg:'h-11 px-5 text-[15px]' };
  return <button className={cx(base, variants[variant], sizes[size], className)} {...props} />;
}
