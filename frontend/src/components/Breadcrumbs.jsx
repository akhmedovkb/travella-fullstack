import { Link } from "react-router-dom";

export default function Breadcrumbs({ items = [] }) {
  if (!items?.length) return null;
  return (
    <nav className="text-sm text-gray-500 mb-6" aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((it, i) => {
          const isLast = i === items.length - 1 || !it.to;
          return (
            <li key={i} className="flex items-center gap-2">
              {isLast ? (
                <span className="text-gray-900">{it.label}</span>
              ) : (
                <Link to={it.to} className="hover:underline">
                  {it.label}
                </Link>
              )}
              {!isLast && <span className="opacity-50">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
