// components/RatingStars.jsx
import React from "react";

export default function RatingStars({ value = 0, size = 16, className = "" }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);

  const Star = ({ type }) => (
    <span
      aria-label={`${type} star`}
      className={
        type === "full"
          ? "text-yellow-400"
          : type === "half"
          ? "text-yellow-400"
          : "text-gray-300"
      }
      style={{ fontSize: size, lineHeight: 1 }}
    >
      {type === "half" ? "★" : "★"}
    </span>
  );

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {[...Array(full)].map((_, i) => <Star key={`f${i}`} type="full" />)}
      {half && <Star type="half" />}
      {[...Array(empty)].map((_, i) => <Star key={`e${i}`} type="empty" />)}
    </span>
  );
}
