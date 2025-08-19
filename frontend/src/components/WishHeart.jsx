//frontend/src/components/WishHeart.jsx

import { useTranslation } from "react-i18next";

export default function WishHeart({
  active = false,
  onClick,
  size = 40,          // диаметр кружка, пиксели
  className = "",
  titleAdd = "",
}) {
  const { t } = useTranslation();

  // единый обработчик — гасим дефолты, пузырение и фокус,
  // чтобы не было скролла кверху и не «прокликивалась» карточка
  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick && onClick(e);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseDown={(e) => e.preventDefault()} // ещё один страховочный приём от скролла
      aria-pressed={active}
      aria-label="Wishlist"
      title={
        (active ? (t("favorites.remove_from") || "Удалить из избранного")
                : (t("favorites.add") || "В избранное")) + (titleAdd ? ` — ${titleAdd}` : "")
      }
      className={[
        "relative grid place-items-center rounded-full ring-1 shadow",
        // стеклянный пузырь с мягким градиентом
        "ring-white/25 shadow-[inset_0_1px_1px_rgba(255,255,255,.35),0_6px_18px_rgba(0,0,0,.18)]",
        "transition-colors",
        active
          ? "bg-[linear-gradient(135deg,rgba(255,255,255,.55),rgba(30,41,59,.68))]"
          : "bg-[linear-gradient(135deg,rgba(255,255,255,.35),rgba(30,41,59,.55))] hover:bg-[linear-gradient(135deg,rgba(255,255,255,.45),rgba(30,41,59,.62))]",
        "backdrop-blur-[4px]",
        className,
      ].join(" ")}
      style={{ width: size, height: size }}
    >
      {/* внутренний мягкий слой, чтобы круг был «ровный» */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[2px] rounded-full bg-white/5"
      />
      <svg
        width={Math.round(size * 0.48)}
        height={Math.round(size * 0.48)}
        viewBox="0 0 24 24"
        className={active ? "text-red-500" : "text-white/85"}
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
      >
        <path d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1Z" />
      </svg>
    </button>
  );
}
