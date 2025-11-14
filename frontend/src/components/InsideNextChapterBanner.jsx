// frontend/src/components/inside/InsideNextChapterBanner.jsx
import React, { useEffect, useState } from "react";
import { getNextChapter } from "../../api/inside";

function calcCountdown(iso) {
  if (!iso) return { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, target - now);

  const sec = Math.floor(diff / 1000);
  const days = Math.floor(sec / (60 * 60 * 24));
  const hours = Math.floor((sec % (60 * 60 * 24)) / (60 * 60));
  const minutes = Math.floor((sec % (60 * 60)) / 60);
  const seconds = sec % 60;

  return { total: diff, days, hours, minutes, seconds };
}

function formatDateTime(iso) {
  if (!iso) return "дата будет объявлена";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "дата будет объявлена";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function InsideNextChapterBanner({ className = "" }) {
  const [chapter, setChapter] = useState(null);     // ответ /chapters/next
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [timer, setTimer] = useState(() =>
    calcCountdown(null)
  );

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        setLoading(true);
        setErr("");
        const data = await getNextChapter();
        if (!isMounted) return;

        setChapter(data || null);

        if (data?.starts_at) {
          setTimer(calcCountdown(data.starts_at));
        }
      } catch (e) {
        console.error("getNextChapter error", e);
        if (isMounted) {
          setErr("Не удалось загрузить ближайшую главу");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, []);

  // тикер таймера
  useEffect(() => {
    if (!chapter?.starts_at) return;

    const id = setInterval(() => {
      setTimer(calcCountdown(chapter.starts_at));
    }, 1000);

    return () => clearInterval(id);
  }, [chapter?.starts_at]);

  if (loading) {
    return (
      <div
        className={`rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800 ${className}`}
      >
        Загрузка ближайшей главы…
      </div>
    );
  }

  if (err) {
    return (
      <div
        className={`rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800 ${className}`}
      >
        {err}
      </div>
    );
  }

  if (!chapter) {
    // Можно вернуть null, если хочешь полностью скрывать виджет
    return (
      <div
        className={`rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 ${className}`}
      >
        Набор в следующую главу пока не открыт.
      </div>
    );
  }

  const capacity =
    chapter.capacity != null ? Number(chapter.capacity) : null;
  const enrolled = chapter.enrolled_count != null
    ? Number(chapter.enrolled_count)
    : 0;
  const left =
    capacity != null ? Math.max(0, capacity - enrolled) : null;

  const isStarted = timer.total === 0 && !!chapter.starts_at;

  return (
    <div
      className={`flex flex-col gap-3 rounded-3xl border border-orange-100 bg-gradient-to-r from-orange-50 via-amber-50 to-rose-50 px-4 py-4 sm:px-6 sm:py-5 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-orange-800">
          Ближайшая глава India Inside
        </span>
        <span className="text-xs text-orange-700">
          статус: {chapter.status || "scheduled"}
        </span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-lg font-semibold text-gray-900">
            {chapter.title || "Следующая глава"}
          </div>
          <div className="mt-1 text-sm text-gray-700">
            Старт:&nbsp;
            <span className="font-medium">
              {formatDateTime(chapter.starts_at)}
            </span>
          </div>

          {capacity != null && (
            <div className="mt-1 text-sm text-gray-700">
              Осталось мест:&nbsp;
              <span className="font-semibold text-orange-700">
                {left} / {capacity}
              </span>
            </div>
          )}
        </div>

        {/* Таймер */}
        <div className="flex items-center gap-2 text-center">
          {isStarted ? (
            <div className="rounded-2xl bg-white/70 px-4 py-3 text-sm font-semibold text-emerald-700 shadow-sm">
              Набор на эту главу уже начался
            </div>
          ) : (
            <div className="flex gap-2">
              {[
                ["дн", timer.days],
                ["ч", timer.hours],
                ["мин", timer.minutes],
                ["сек", timer.seconds],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="w-14 rounded-2xl bg-white/80 px-2 py-2 text-xs shadow-sm"
                >
                  <div className="text-base font-semibold text-gray-900">
                    {String(value).padStart(2, "0")}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-500">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {left != null && left <= 3 && left > 0 && (
        <div className="text-xs font-medium text-red-600">
          Всего {left} мест — высокая вероятность, что группа закроется
          раньше.
        </div>
      )}

      {left === 0 && (
        <div className="text-xs font-medium text-gray-700">
          Мест не осталось, но вы можете оставить заявку — мы поставим
          вас в лист ожидания или откроем дополнительную группу.
        </div>
      )}
    </div>
  );
}
