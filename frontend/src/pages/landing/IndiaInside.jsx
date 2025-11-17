// --- MyInsideCard: карточка статуса India Inside (запрос на участие в главах)
function MyInsideCard({ inside, loading, t, onJoined, now }) {
  // хуки ВСЕГДА в начале
  const [lastReq, setLastReq] = useState(null);   // последняя заявка (на участие)
  const [loadingReq, setLoadingReq] = useState(true);

  const [nextChapter, setNextChapter] = useState(null);  // ближайшая глава (для invite)
  const [loadingNext, setLoadingNext] = useState(true);

  // текущая глава и статус программы
  const currentChapterKey = inside?.current_chapter || "royal";
  const programStatus = inside?.status || "active";

  // выбранная в верхнем ряду глава (по умолчанию — текущая)
  const [selectedKey, setSelectedKey] = useState(currentChapterKey);

  // если сервер поменял current_chapter — синхронизируем выбор
  useEffect(() => {
    if (inside?.current_chapter) {
      setSelectedKey(inside.current_chapter);
    }
  }, [inside?.current_chapter]);

  // заголовки глав по ключам
  const chapterTitle = (key) => {
    const map = {
      royal:   t("landing.inside.chapters.royal.title",   { defaultValue: "Золотой Треугольник" }),
      silence: t("landing.inside.chapters.silence.title", { defaultValue: "Приключения в Раджастане" }),
      modern:  t("landing.inside.chapters.modern.title",  { defaultValue: "Мумбаи + Гоа — лучшие воспоминания" }),
      kerala:  t("landing.inside.chapters.kerala.title",  { defaultValue: "Керала: Рай на Земле" }),
    };
    return map[key] || key || "Глава";
  };

  // мини-«база» программ по дням (royal расписал, остальные — заглушки, можно дописать позже)
  const programDaysMap = {
    royal: [
      t("inside.program.royal.day1", { defaultValue: "Дели: прилёт, трансфер, вечерний брифинг" }),
      t("inside.program.royal.day2", { defaultValue: "Агра: Тадж-Махал на рассвете, форт Агры" }),
      t("inside.program.royal.day3", { defaultValue: "Джайпур: Амбер-форт, Дворец ветров" }),
      t("inside.program.royal.day4", { defaultValue: "Джайпур: тур по городу, ремёсла" }),
      t("inside.program.royal.day5", { defaultValue: "Дели: современная Индия — арт/мода/гастро" }),
      t("inside.program.royal.day6", { defaultValue: "Свободный день / доп. опции" }),
      t("inside.program.royal.day7", { defaultValue: "Вылет" }),
    ],
    silence: [
      t("inside.program.silence.day1", { defaultValue: "День 1" }),
      t("inside.program.silence.day2", { defaultValue: "День 2" }),
      t("inside.program.silence.day3", { defaultValue: "День 3" }),
      t("inside.program.silence.day4", { defaultValue: "День 4" }),
      t("inside.program.silence.day5", { defaultValue: "День 5" }),
      t("inside.program.silence.day6", { defaultValue: "День 6" }),
      t("inside.program.silence.day7", { defaultValue: "День 7" }),
    ],
    modern: [
      t("inside.program.modern.day1", { defaultValue: "День 1" }),
      t("inside.program.modern.day2", { defaultValue: "День 2" }),
      t("inside.program.modern.day3", { defaultValue: "День 3" }),
      t("inside.program.modern.day4", { defaultValue: "День 4" }),
      t("inside.program.modern.day5", { defaultValue: "День 5" }),
      t("inside.program.modern.day6", { defaultValue: "День 6" }),
      t("inside.program.modern.day7", { defaultValue: "День 7" }),
    ],
    kerala: [
      t("inside.program.kerala.day1", { defaultValue: "День 1" }),
      t("inside.program.kerala.day2", { defaultValue: "День 2" }),
      t("inside.program.kerala.day3", { defaultValue: "День 3" }),
      t("inside.program.kerala.day4", { defaultValue: "День 4" }),
      t("inside.program.kerala.day5", { defaultValue: "День 5" }),
      t("inside.program.kerala.day6", { defaultValue: "День 6" }),
      t("inside.program.kerala.day7", { defaultValue: "День 7" }),
    ],
  };

  // хэлпер: пилюля статуса программы (справа сверху)
  const renderProgramStatusPill = (st) => {
    const map = {
      active:    t("inside.status_active",    { defaultValue: "Активна" }),
      completed: t("inside.status_completed", { defaultValue: "Завершена" }),
      expelled:  t("inside.status_expelled",  { defaultValue: "Отчислен" }),
    };
    let cls = "border-slate-200 bg-slate-50 text-slate-700";
    if (st === "active")    cls = "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (st === "completed") cls = "border-blue-200 bg-blue-50 text-blue-700";
    if (st === "expelled")  cls = "border-rose-200 bg-rose-50 text-rose-700";
    return (
      <span className={`text-xs px-3 py-1 rounded-full border ${cls}`}>
        {map[st] ?? st ?? t("inside.status", { defaultValue: "Статус" })}
      </span>
    );
  };

  // баннер ближайшей главы (для тех, кто ещё НЕ в программе)
  const NextChapterBanner = () => {
    if (!nextChapter) return null;

    const startsAt = nextChapter.starts_at ? new Date(nextChapter.starts_at) : null;
    const nowMs = typeof now === "number" ? now : Date.now();
    const diffMs = startsAt ? startsAt.getTime() - nowMs : null;

    const capacityRaw = nextChapter.capacity ?? nextChapter.chapter_capacity;
    const enrolledRaw = nextChapter.enrolled_count ?? nextChapter.chapter_enrolled;
    let placesLeft;
    if (capacityRaw != null) {
      const cap = Number(capacityRaw) || 0;
      const enrolled = Number(enrolledRaw ?? 0) || 0;
      placesLeft = Math.max(0, cap - enrolled);
    } else {
      placesLeft = Number(nextChapter.places_left ?? 0);
    }

    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {t("inside.next_chapter.label", { defaultValue: "Ближайшая глава" })}
            </div>
            <div className="font-medium">
              {nextChapter.title || chapterTitle(nextChapter.chapter_key)}
            </div>
            {startsAt && (
              <div className="text-xs text-slate-500">
                {t("inside.next_chapter.starts_at", { defaultValue: "Старт:" })}{" "}
                {startsAt.toLocaleString()}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            {diffMs != null && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-mono ${
                  diffMs > 0 ? "bg-black text-white" : "bg-emerald-600 text-white"
                }`}
              >
                {diffMs > 0
                  ? t("inside.next_chapter.countdown", { defaultValue: "До начала" })
                  : t("inside.next_chapter.enrollment_open", { defaultValue: "Набор идёт" })}
                {diffMs > 0 && <span>{formatLeft(diffMs)}</span>}
              </span>
            )}
            <span className="text-xs text-slate-700">
              {t("inside.next_chapter.places_left", {
                defaultValue: "Свободных мест: {{count}}",
                count: placesLeft,
              })}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // загрузка последней заявки
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!inside) {
        setLastReq(null);
        setLoadingReq(false);
        return;
      }
      try {
        setLoadingReq(true);
        const r = await apiGet("/api/inside/my-request");
        if (!cancel) setLastReq(r || null);
      } catch {
        if (!cancel) setLastReq(null);
      } finally {
        if (!cancel) setLoadingReq(false);
      }
    })();
    return () => { cancel = true; };
  }, [inside]);

  // ближайшая глава (для invite-блока)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingNext(true);
        const res = await apiGet("/api/inside/chapters/next");
        if (!cancelled) setNextChapter(res || null);
      } catch {
        if (!cancelled) setNextChapter(null);
      } finally {
        if (!cancelled) setLoadingNext(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ======== состояния загрузки ========
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow p-6 border animate-pulse">
        <div className="h-5 w-48 bg-gray-200 rounded" />
        <div className="mt-4 h-4 w-80 bg-gray-200 rounded" />
        <div className="mt-6 h-3 w-full bg-gray-200 rounded" />
      </div>
    );
  }

  // ======== 1. Пользователь ещё НЕ участвует в программе ========
  if (!inside) {
    async function handleJoinProgram() {
      try {
        const res = await apiPost("/api/inside/join");
        if (res && (res.ok || res.status === "ok" || res.joined)) {
          const me = await apiGet("/api/inside/me");
          onJoined?.(me?.data ?? me ?? null);
          tSuccess(t("inside.toast.joined") || "Вы присоединились к India Inside!", { autoClose: 1600 });
          return;
        }
        const me = await apiGet("/api/inside/me");
        if (me && (me.status && me.status !== "none")) {
          onJoined?.(me);
          tSuccess(t("inside.toast.joined") || "Вы присоединились к India Inside!", { autoClose: 1600 });
          return;
        }
        tError(t("inside.toast.join_failed") || "Не удалось присоединиться");
      } catch {
        window.open("/landing/india-inside", "_blank", "noreferrer");
      }
    }

    return (
      <div className="bg-white rounded-xl shadow p-6 border">
        <div className="text-xl font-semibold">
          {t("inside.invite.title", { defaultValue: "Присоединиться к India Inside" })}
        </div>
        <p className="mt-2 text-gray-600">
          {t("inside.invite.sub", { defaultValue: "Личный куратор, главы и статус Guru после 4 глав." })}
        </p>
        {!loadingNext && <NextChapterBanner />}
        <div className="mt-4 flex gap-2">
          <button
            onClick={handleJoinProgram}
            className="inline-flex items-center rounded-lg bg-orange-500 px-4 py-2 text-white font-semibold"
          >
            {t("inside.invite.join_now", { defaultValue: "Присоединиться" })}
          </button>
          <a
            href="/landing/india-inside"
            className="inline-flex items-center rounded-lg border px-4 py-2 font-medium hover:bg-gray-50"
            target="_blank"
            rel="noreferrer"
          >
            {t("inside.invite.cta", { defaultValue: "Узнать больше" })}
          </a>
        </div>
      </div>
    );
  }

  // ======== 2. Пользователь уже в программе ========
  const cur = Number(inside.progress_current ?? 0);
  const total = Number(inside.progress_total ?? 4);
  const pct = Math.max(0, Math.min(100, Math.round((cur / (total || 1)) * 100)));
  const curator = inside.curator_telegram || "@akhmedovkb";

  const chapterMeta = inside.chapter || {};

  const chaptersFromBackend =
    (Array.isArray(inside?.chapters) && inside.chapters) ||
    (Array.isArray(inside?.chapters_list) && inside.chapters_list) ||
    (inside?.chapters_map && Object.values(inside.chapters_map)) ||
    null;

  const getChapterMeta = (key) => {
    if (chaptersFromBackend) {
      const found =
        chaptersFromBackend.find((c) => c.chapter_key === key || c.key === key) || null;
      if (found) return found;
    }
    if (
      (chapterMeta.chapter_key && chapterMeta.chapter_key === key) ||
      (chapterMeta.key && chapterMeta.key === key)
    ) {
      return chapterMeta;
    }
    return chapterMeta;
  };

  const selectedMeta = getChapterMeta(selectedKey);
  const selectedTitle = chapterTitle(selectedKey);
  const programDays = (programDaysMap[selectedKey] || []).filter(
    (x) => x && String(x).trim() !== ""
  );

  // даты туров по выбранной главе
  const toursByChapter = (() => {
    const all = []
      .concat(inside?.chapter_runs || [])
      .concat(inside?.runs || [])
      .concat(inside?.slots || [])
      .concat(inside?.tours || [])
      .concat(inside?.schedules || [])
      .concat(selectedMeta?.runs || [])
      .concat(selectedMeta?.slots || [])
      .concat(selectedMeta?.tours || []);

    return all
      .filter((r) => {
        const k = r.chapter_key || r.chapter || r.key;
        return !k || String(k) === String(selectedKey);
      })
      .map((r) => {
        const dateRaw =
          r.start_date || r.date || r.starts_at || r.departure_date || r.start_at || r.day;
        const capRaw =
          r.capacity ?? r.places_total ?? r.total_places ?? r.seats_total;
        const enrolledRaw =
          r.enrolled_count ?? r.booked_count ?? r.places_used ?? r.seats_taken;
        const capacity = Number(capRaw ?? 0) || 0;
        const enrolled = Number(enrolledRaw ?? 0) || 0;
        const left = Math.max(0, capacity - enrolled);

        return {
          id: r.id || `${dateRaw || "date"}_${capacity}_${enrolled}`,
          date: dateRaw,
          capacity,
          left,
        };
      })
      .filter((x) => x.date);
  })();

  const nowTs = now ?? Date.now();
  const nearestTour = toursByChapter.length
    ? [...toursByChapter].sort((a, b) => {
        const ta = Date.parse(a.date) || 0;
        const tb = Date.parse(b.date) || 0;
        const da = ta >= nowTs ? ta - nowTs : Number.MAX_SAFE_INTEGER;
        const db = tb >= nowTs ? tb - nowTs : Number.MAX_SAFE_INTEGER;
        return da - db;
      })[0]
    : null;

  const startsAtRaw =
    (nearestTour && nearestTour.date) ||
    selectedMeta?.starts_at ||
    selectedMeta?.start_date ||
    chapterMeta.starts_at ||
    inside.chapter_starts_at ||
    null;

  let countdown = null;
  if (startsAtRaw) {
    const ts = Date.parse(startsAtRaw);
    if (!Number.isNaN(ts)) {
      const diff = ts - nowTs;
      if (diff > 0) countdown = formatLeft(diff);
    }
  }

  const hasRequestForSelected =
    lastReq &&
    (lastReq.chapter === selectedKey ||
      lastReq.chapter_key === selectedKey ||
      lastReq.chapterKey === selectedKey);

  const isPendingForSelected  = hasRequestForSelected && lastReq.status === "pending";
  const isApprovedForSelected = hasRequestForSelected && lastReq.status === "approved";
  const enrollButtonDisabled  = isPendingForSelected || isApprovedForSelected;

  async function requestJoinChapter() {
    if (enrollButtonDisabled) return;

    const payload = { chapter: selectedKey };
    let lastError = null;
    let res = null;

    const endpoints = [
      "/api/inside/request-join",
      "/api/inside/request-enroll",
      "/api/inside/request-completion", // fallback
    ];

    for (const url of endpoints) {
      try {
        res = await apiPost(url, payload);
        if (res) break;
      } catch (e) {
        lastError = e;
      }
    }

    if (!res && lastError) {
      const msg = (lastError?.response?.data?.error || lastError?.message || "")
        .toString()
        .toLowerCase();
      if (
        lastError?.response?.status === 401 ||
        lastError?.response?.status === 403 ||
        msg.includes("unauthorized")
      ) {
        tError(t("auth.login_required") || "Войдите заново и повторите попытку", { autoClose: 2200 });
      } else {
        tError(
          t("inside.errors.request_failed") || "Не удалось отправить запрос на участие",
          { autoClose: 2200 }
        );
      }
      return;
    }

    const item = res?.item || res?.data || res.request || res;
    if (item) setLastReq(item);

    tSuccess(
      t("inside.toast.request_joined") || "Запрос на участие отправлен",
      { autoClose: 1600 }
    );
  }

  const chaptersOrder = [
    { key: "royal",   order: 1 },
    { key: "silence", order: 2 },
    { key: "modern",  order: 3 },
    { key: "kerala",  order: 4 },
  ];

  return (
    <section className="bg-white rounded-xl shadow p-6 border">
      {/* шапка */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">India Inside</div>
          <h2 className="text-xl font-semibold">
            {t("inside.my.title", { defaultValue: "Моя программа" })}
          </h2>
        </div>
        {renderProgramStatusPill(programStatus)}
      </div>

      {/* ВЕРХ: список глав */}
      <div className="mt-4 rounded-2xl bg-orange-50 border border-orange-100 p-4">
        <div className="flex flex-wrap gap-3">
          {chaptersOrder.map(({ key, order }) => {
            const isSelected = selectedKey === key;
            const isCurrent  = currentChapterKey === key;
            const base =
              "flex-1 min-w-[180px] cursor-pointer rounded-2xl border px-4 py-3 text-left transition-all";
            const colorSelected =
              "border-orange-400 bg-white shadow-sm ring-2 ring-orange-200";
            const colorCurrent =
              "border-emerald-500 bg-white shadow-sm";
            const colorDefault =
              "border-emerald-300 bg-white/80 hover:bg-white";
            const cls = isSelected ? colorSelected : isCurrent ? colorCurrent : colorDefault;

            return (
              <button
                key={key}
                type="button"
                className={`${base} ${cls}`}
                onClick={() => setSelectedKey(key)}
              >
                <div className="text-[11px] uppercase tracking-wide text-emerald-700">
                  {t("inside.chapter_label", {
                    defaultValue: "Глава {{n}}",
                    n: order,
                  })}
                </div>
                <div className="mt-0.5 text-sm font-medium text-slate-900 leading-snug">
                  {chapterTitle(key)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* НИЗ: три карточки */}
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {/* 1. Выбранная глава + программа по дням */}
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex flex-col">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {t("inside.selected_chapter", { defaultValue: "Выбранная глава" })}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {selectedTitle}
            </div>

            <div className="mt-3 text-sm font-medium text-slate-700">
              {t("inside.program_by_days", { defaultValue: "Программа по дням:" })}
            </div>

            {programDays.length ? (
              <ol className="mt-2 space-y-1.5 text-sm text-slate-800">
                {programDays.map((txt, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-orange-500 text-xs font-semibold text-white">
                      {idx + 1}
                    </span>
                    <span className="leading-snug">{txt}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-2 text-xs text-slate-500">
                {t("inside.program_empty", {
                  defaultValue: "Программа по дням будет опубликована позже.",
                })}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-200">
            <div className="text-xs text-gray-500 mb-1">
              {t("inside.progress", { defaultValue: "Прогресс" })}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="h-2 bg-orange-500 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {cur} / {total} ({pct}%)
            </div>
          </div>
        </div>

        {/* 2. Даты туров + оставшиеся места */}
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex flex-col">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {t("inside.dates_block.title", { defaultValue: "Даты туров" })}
          </div>

          {toursByChapter.length ? (
            <div className="mt-2 space-y-1.5 text-sm text-slate-800">
              {toursByChapter.map((r) => (
                <div key={r.id} className="flex items-baseline justify-between gap-3">
                  <div>
                    <span className="font-medium">
                      {new Date(r.date).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 text-right">
                    {t("inside.dates_block.capacity", {
                      defaultValue: "Мест всего: {{total}}",
                      total: r.capacity,
                    })}
                    {r.capacity > 0 && (
                      <>
                        <br />
                        {t("inside.dates_block.left", {
                          defaultValue: "Свободно: {{left}}",
                          left: r.left,
                        })}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-xs text-slate-500">
              {t("inside.dates_block.empty", {
                defaultValue: "Даты туров по этой главе появятся здесь.",
              })}
            </div>
          )}

          {(startsAtRaw || countdown) && (
            <div className="mt-4 pt-3 border-t border-slate-200 text-sm text-slate-800">
              {startsAtRaw && (
                <div>
                  <span className="text-xs text-slate-500">
                    {t("inside.chapter_start_at", { defaultValue: "Ближайший старт:" })}{" "}
                  </span>
                  <span className="font-medium">
                    {new Date(startsAtRaw).toLocaleString()}
                  </span>
                </div>
              )}
              {countdown && (
                <div className="mt-1">
                  <span className="text-xs text-slate-500">
                    {t("inside.chapter_countdown", { defaultValue: "До старта осталось:" })}{" "}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-black text-white text-xs font-mono">
                    {countdown}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2">
            <a
              href={`/india/inside?chapter=${encodeURIComponent(selectedKey)}#chapters`}
              className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 text-center"
              target="_blank"
              rel="noreferrer"
            >
              {t("inside.actions.view_program", { defaultValue: "Смотреть программу" })}
            </a>
            <a
              href={`https://t.me/${curator.replace(/^@/, "")}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 text-center"
            >
              {t("inside.actions.contact_curator", { defaultValue: "Связаться с куратором" })}
            </a>
          </div>
        </div>

        {/* 3. Запрос на участие */}
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 flex flex-col">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {t("inside.enroll_block.title", { defaultValue: "Запрос на участие" })}
          </div>
          <div className="mt-2 text-xs text-slate-600">
            {t("inside.enroll_block.desc", {
              defaultValue:
                "После одобрения заявки администратором ваша глава появится в прогрессе участия.",
            })}
          </div>

          <div className="mt-4">
            <button
              onClick={requestJoinChapter}
              disabled={enrollButtonDisabled}
              className={`w-full rounded-lg px-4 py-2 text-sm text-white ${
                enrollButtonDisabled ? "bg-gray-400 cursor-not-allowed" : "bg-black hover:bg-black/90"
              }`}
            >
              {isPendingForSelected
                ? t("inside.actions.request_sent", { defaultValue: "Заявка отправлена" })
                : isApprovedForSelected
                ? t("inside.actions.request_approved", { defaultValue: "Участие одобрено" })
                : t("inside.actions.request_join", { defaultValue: "Запросить участие" })}
            </button>
          </div>

          {hasRequestForSelected && (
            <div className="mt-2 text-xs text-slate-500">
              {lastReq?.status === "pending" &&
                t("inside.enroll_block.pending", {
                  defaultValue: "Заявка по этой главе ожидает одобрения.",
                })}
              {lastReq?.status === "approved" &&
                t("inside.enroll_block.approved", {
                  defaultValue: "Участие по этой главе подтверждено.",
                })}
              {lastReq?.status === "rejected" &&
                t("inside.enroll_block.rejected", {
                  defaultValue: "Заявка по этой главе была отклонена. Свяжитесь с куратором.",
                })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
