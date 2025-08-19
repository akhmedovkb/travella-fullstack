//frontend/src/components/WishHeart.jsx

import React from "react";

export default function WishHeart({
  active,
  onClick,
  size = 36,
  className = "",
  titleAdd = "Добавить в избранное",
  titleRemove = "Удалить из избранного",
}) {
  const px = Math.round(size * 0.56);

  return (
    <button
      type="button"
      aria-pressed={!!active}
      title={active ? titleRemove : titleAdd}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.(e);
      }}
      className={[
        "relative inline-flex items-center justify-center rounded-full",
        "transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        "shadow-md",
        className,
      ].join(" ")}
      style={{
        width: size,
        height: size,
        // очень похоже на твой референс
        background:
          "radial-gradient(140% 140% at 35% 28%, rgba(255,255,255,.75) 0%, rgba(255,255,255,.35) 40%, rgba(0,0,0,.16) 85%)",
        boxShadow:
          "0 2px 6px rgba(0,0,0,.25), inset 0 1px 2px rgba(255,255,255,.65), inset 0 -3px 10px rgba(0,0,0,.18)",
      }}
    >
      {/* тонкое кольцо по краю */}
      <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-black/10" />

      {/* само сердце */}
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        className={active ? "text-red-500" : "text-gray-500"}
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M12 21s-6.716-4.35-9.192-7.2C.818 11.48 1.04 8.72 2.88 7.2a5 5 0 0 1 6.573.33L12 9.08l2.547-1.55a5 5 0 0 1 6.573.33c1.84 1.52 2.062 4.28.072 6.6C18.716 16.65 12 21 12 21Z" />
      </svg>
    </button>
  );
}
