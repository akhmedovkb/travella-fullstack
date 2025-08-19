//frontend/src/components/WishHeart.jsx

import { useTranslation } from "react-i18next";

export default function WishHeart({ active, onClick, size = 20, className = "" }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Wishlist"
      title={active ? t("favorites.remove_from") : t("favorites.add")}
      className={[
        "p-2 rounded-full hover:bg-gray-100",
        active ? "text-red-500" : "text-gray-400",
        className
      ].join(" ")}
    >
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path
          d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1Z"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    </button>
  );
}
