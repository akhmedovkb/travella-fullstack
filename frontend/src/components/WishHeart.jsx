import { useTranslation } from "react-i18next";

export default function WishHeart({
  active,
  onClick,
  size = 36,   // диаметр кружка
  icon = 18,   // размер иконки сердца
  className = "",
}) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      aria-label={t("favorites.add") || "Избранное"}
      title={active ? (t("favorites.remove_from") || "Удалить из избранного")
                    : (t("favorites.add") || "Добавить в избранное")}
      className={[
        // ИДЕАЛЬНЫЙ КРУГ
        "inline-flex items-center justify-center rounded-full shrink-0",
        // фиксируем размеры кружка -> круг
        // (можно поменять через prop `size`)
        "ring-1 ring-white/20 backdrop-blur-md shadow",
        // фон как на карточках
        "bg-black/35 hover:bg-black/45",
        className,
      ].join(" ")}
      style={{
  width: size, height: size,
  background: "radial-gradient(120% 120% at 30% 30%, rgba(255,255,255,.25), rgba(0,0,0,.35))"
}}
    >
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        className={active ? "text-red-500" : "text-white"}
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1Z" />
      </svg>
    </button>
  );
}
