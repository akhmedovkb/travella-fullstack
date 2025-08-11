export default function WishHeart({ active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Wishlist"
      title={active ? "Убрать из избранного" : "В избранное"}
      className={`p-2 rounded-full hover:bg-gray-100 ${active ? "text-red-500" : "text-gray-400"}`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor">
        <path d="M20.8 4.6a5 5 0 0 0-7.1 0L12 6.3l-1.7-1.7a5 5 0 1 0-7.1 7.1l1.7 1.7L12 21l7.1-7.6 1.7-1.7a5 5 0 0 0 0-7.1Z"/>
      </svg>
    </button>
  );
}
