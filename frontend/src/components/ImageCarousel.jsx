import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function ImageCarousel({ images = [], className = "" }) {
  // поддержим разные форматы: строка, {url}, {src}, {data}
  const list = useMemo(
    () =>
      (images || [])
        .map((x) => (typeof x === "string" ? x : x?.url || x?.src || x?.data))
        .filter(Boolean),
    [images]
  );

  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const haveMany = list.length > 1;

  const prev = useCallback(
    () => setI((p) => (p - 1 + list.length) % list.length),
    [list.length]
  );
  const next = useCallback(
    () => setI((p) => (p + 1) % list.length),
    [list.length]
  );

  // клавиши в лайтбоксе
  useEffect(() => {
    const onKey = (e) => {
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prev, next]);

  // свайпы (мобилки)
  const touch = useRef(null);
  const onTouchStart = (e) => {
    const t = e.touches?.[0];
    if (t) touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!touch.current) return;
    const dx = e.changedTouches?.[0]?.clientX - touch.current.x;
    if (Math.abs(dx) > 40) (dx > 0 ? prev : next)();
    touch.current = null;
  };

  if (!list.length) return null;

  return (
    <div className={["group relative", className].join(" ")}>
      {/* Основное изображение */}
      <div className="relative">
        <img
          src={list[i]}
          alt=""
          className="w-full h-64 md:h-72 object-cover rounded border cursor-zoom-in"
          onClick={() => setOpen(true)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        />

        {haveMany && (
          <>
            <button
              type="button"
              onClick={prev}
              className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white rounded-full p-2 shadow"
              aria-label="Предыдущее"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={next}
              className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-white rounded-full p-2 shadow"
              aria-label="Следующее"
            >
              ›
            </button>
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
              {list.map((_, idx) => (
                <span
                  key={idx}
                  className={`h-1.5 w-1.5 rounded-full ${
                    idx === i ? "bg-white" : "bg-white/60"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Превьюшки */}
      {haveMany && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {list.map((src, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setI(idx)}
              className={`shrink-0 border rounded ${
                idx === i ? "ring-2 ring-orange-500" : ""
              }`}
              aria-label={`К изображению ${idx + 1}`}
            >
              <img src={src} alt="" className="h-14 w-20 object-cover rounded" />
            </button>
          ))}
        </div>
      )}

      {/* Лайтбокс */}
      {open && (
        <div
          className="fixed inset-0 z-[1000] bg-black/80 flex items-center justify-center"
          onClick={() => setOpen(false)}
        >
          <img
            src={list[i]}
            alt=""
            className="max-h-[90vh] max-w-[95vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {haveMany && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  prev();
                }}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-3xl"
                aria-label="Предыдущее"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  next();
                }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-3xl"
                aria-label="Следующее"
              >
                ›
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 bg-white/90 rounded-full px-3 py-1 text-gray-900"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
