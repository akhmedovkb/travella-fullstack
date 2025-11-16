// backend/controllers/insideController.js
const pool = require("../db");

/** -------- helpers -------- */
const CHAPTERS_ORDER = ["royal", "silence", "modern", "kerala"];
const PROGRESS_TOTAL_DEFAULT = 4;

function ok(data = {}) {
  return { ok: true, ...data };
}
function none() {
  return { status: "none" };
}

async function ensureParticipant(userId) {
  // создаем участника, если его нет
  await pool.query(
    `INSERT INTO inside_participants (user_id)
     SELECT $1
     WHERE NOT EXISTS (SELECT 1 FROM inside_participants WHERE user_id = $1)`,
    [userId]
  );
}

function nextChapterKey(current) {
  const i = CHAPTERS_ORDER.indexOf(String(current || "").toLowerCase());
  if (i < 0) return CHAPTERS_ORDER[0] || null;
  return CHAPTERS_ORDER[i + 1] || CHAPTERS_ORDER[i] || null;
}

/** -------- client/public -------- */

// GET /api/inside/me
async function getInsideMe(req, res) {
  try {
    const userId =
      req.user?.id ??
      req.user?._id ??
      req.user?.client_id ??
      req.user?.user_id ??
      null;
    if (!userId) return res.json(none());

    const { rows } = await pool.query(
      `SELECT
         p.user_id,
         p.program_key,
         p.current_chapter,
         p.progress_current,
         p.progress_total,
         p.curator_telegram,
         p.status,
         c.starts_at      AS chapter_starts_at,
         c.tour_starts_at AS chapter_tour_starts_at,
         c.tour_ends_at   AS chapter_tour_ends_at,
         c.capacity       AS chapter_capacity,
         c.enrolled_count AS chapter_enrolled_count,
         c.status         AS chapter_status
       FROM inside_participants p
       LEFT JOIN inside_chapters c
              ON c.chapter_key = p.current_chapter
       WHERE p.user_id = $1
       LIMIT 1`,
      [userId]
    );

    if (!rows.length) return res.json(none());

    const p = rows[0];
    const capacity = Number(p.chapter_capacity || 0);
    const enrolled = Number(p.chapter_enrolled_count || 0);
    const remaining = Math.max(0, capacity - enrolled);

    return res.json({
      status: p.status || "active",
      progress_current: Number(p.progress_current || 0),
      progress_total: Number(p.progress_total || PROGRESS_TOTAL_DEFAULT),
      current_chapter: p.current_chapter || CHAPTERS_ORDER[0] || "royal",
      curator_telegram: p.curator_telegram || "@akhmedovkb",
      user_id: p.user_id,
      program_key: p.program_key || "india_inside",
      chapter: {
        key: p.current_chapter || CHAPTERS_ORDER[0] || "royal",
        // дата старта набора
        starts_at: p.chapter_starts_at,
        // отдельные даты самого тура (могут быть null)
        tour_starts_at: p.chapter_tour_starts_at,
        tour_ends_at: p.chapter_tour_ends_at,
        capacity,
        enrolled_count: enrolled,
        remaining,
        status: p.chapter_status || "draft",
      },
    });
  } catch (e) {
    console.error("getInsideMe error:", e);
    return res.status(500).json({ error: "Failed to get Inside status" });
  }
}

// GET /api/inside/user/:userId
async function getInsideById(req, res) {
  try {
    const userId = Number(req.params.userId);
    if (!userId) return res.json(none());

    const { rows } = await pool.query(
      `SELECT
         p.user_id,
         p.program_key,
         p.current_chapter,
         p.progress_current,
         p.progress_total,
         p.curator_telegram,
         p.status,
         c.starts_at      AS chapter_starts_at,
         c.tour_starts_at AS chapter_tour_starts_at,
         c.tour_ends_at   AS chapter_tour_ends_at,
         c.capacity       AS chapter_capacity,
         c.enrolled_count AS chapter_enrolled_count,
         c.status         AS chapter_status
       FROM inside_participants p
       LEFT JOIN inside_chapters c
              ON c.chapter_key = p.current_chapter
       WHERE p.user_id = $1
       LIMIT 1`,
      [userId]
    );

    if (!rows.length) return res.json(none());

    const p = rows[0];
    const capacity = Number(p.chapter_capacity || 0);
    const enrolled = Number(p.chapter_enrolled_count || 0);
    const remaining = Math.max(0, capacity - enrolled);

    return res.json({
      status: p.status || "active",
      progress_current: Number(p.progress_current || 0),
      progress_total: Number(p.progress_total || PROGRESS_TOTAL_DEFAULT),
      current_chapter: p.current_chapter || CHAPTERS_ORDER[0] || "royal",
      curator_telegram: p.curator_telegram || "@akhmedovkb",
      user_id: p.user_id,
      program_key: p.program_key || "india_inside",
      chapter: {
        key: p.current_chapter || CHAPTERS_ORDER[0] || "royal",
        // дата старта набора
        starts_at: p.chapter_starts_at,
        // даты тура
        tour_starts_at: p.chapter_tour_starts_at,
        tour_ends_at: p.chapter_tour_ends_at,
        capacity,
        enrolled_count: enrolled,
        remaining,
        status: p.chapter_status || "draft",
      },
    });
  } catch (e) {
    console.error("getInsideById error:", e);
    return res
      .status(500)
      .json({ error: "Failed to get Inside status by id" });
  }
}

// GET /api/inside/
async function getInsideStatus(_req, res) {
  try {
    return res.json(none());
  } catch (e) {
    console.error("getInsideStatus error:", e);
    return res
      .status(500)
      .json({ error: "Failed to get Inside status (public)" });
  }
}

// POST /api/inside/request-completion
async function requestCompletion(req, res) {
  try {
    const userId =
      req.user?.id ??
      req.user?._id ??
      req.user?.client_id ??
      req.user?.user_id ??
      null;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // на всякий случай убеждаемся, что участник существует
    await ensureParticipant(userId);

    // читаем участника и его текущую главу
    const pRes = await pool.query(
      `SELECT user_id, current_chapter, progress_current, progress_total, status
         FROM inside_participants
        WHERE user_id = $1
        LIMIT 1`,
      [userId]
    );

    if (!pRes.rowCount) {
      return res.status(400).json({ error: "participant_not_found" });
    }

    const p = pRes.rows[0];
    const chapterKey = p.current_chapter || CHAPTERS_ORDER[0] || "royal";

    // создаём запрос на завершение ТЕКУЩЕЙ главы
    try {
      const q = `
        INSERT INTO inside_completion_requests (user_id, chapter, status)
        VALUES ($1, $2, 'pending')
        ON CONFLICT ON CONSTRAINT uniq_inside_req_user_chapter_pending
        DO NOTHING
        RETURNING id, user_id, chapter, status, requested_at
      `;
      const { rows } = await pool.query(q, [userId, chapterKey]);

      // если ничего не вернулось — уже есть pending по этой главе
      if (!rows.length) {
        return res.json({ ok: true, already: true });
      }
      return res.json({ ok: true, item: rows[0] });
    } catch (err) {
      // мягкий фолбэк, если уникальный индекс ещё не создан (42704)
      if (err.code === "42704") {
        const chk = await pool.query(
          `SELECT 1 FROM inside_completion_requests
           WHERE user_id = $1 AND chapter = $2 AND status = 'pending'
           LIMIT 1`,
          [userId, chapterKey]
        );
        if (chk.rowCount > 0) {
          return res.json({ ok: true, already: true });
        }

        const ins = await pool.query(
          `INSERT INTO inside_completion_requests (user_id, chapter, status)
           VALUES ($1, $2, 'pending')
           RETURNING id, user_id, chapter, status, requested_at`,
          [userId, chapterKey]
        );
        return res.json({ ok: true, item: ins.rows[0] });
      }

      console.error("requestCompletion error:", err);
      return res.status(500).json({ error: "request_failed" });
    }
  } catch (e) {
    console.error("requestCompletion outer error:", e);
    return res.status(500).json({ error: "request_failed" });
  }
}

// POST /api/inside/join — клиент вручную присоединяется к программе
async function joinInside(req, res) {
  try {
    const userId =
      req.user?.id ??
      req.user?._id ??
      req.user?.client_id ??
      req.user?.user_id ??
      null;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // если уже есть участник — просто вернуть статус
    const exists = await pool.query(
      `SELECT * FROM inside_participants WHERE user_id=$1 LIMIT 1`,
      [userId]
    );
    if (exists.rowCount > 0)
      return res.json(
        ok({ participant: exists.rows[0], message: "already_joined" })
      );

    const { rows } = await pool.query(
      `INSERT INTO inside_participants
         (user_id, program_key, current_chapter, progress_current, progress_total, status, curator_telegram)
       VALUES ($1, 'india_inside', $2, 0, $3, 'active', '@akhmedovkb')
       RETURNING *`,
      [userId, CHAPTERS_ORDER[0] || "royal", PROGRESS_TOTAL_DEFAULT]
    );

    return res.json(ok({ participant: rows[0], message: "joined" }));
  } catch (e) {
    console.error("joinInside error:", e);
    return res.status(500).json({ error: "Failed to join Inside" });
  }
}

// GET /api/inside/my-request  — вернуть последнюю заявку текущего клиента
async function getMyLastRequest(req, res) {
  try {
    const userId =
      req.user?.id ??
      req.user?._id ??
      req.user?.client_id ??
      req.user?.user_id ??
      null;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { rows } = await pool.query(
      `SELECT id, user_id, chapter, status, requested_at, approved_at, rejected_at
         FROM inside_completion_requests
        WHERE user_id = $1
        ORDER BY requested_at DESC
        LIMIT 1`,
      [userId]
    );

    const r = rows[0] || null;
    if (!r) return res.json(null);

    const resolved_at =
      r.status === "approved"
        ? r.approved_at
        : r.status === "rejected"
        ? r.rejected_at
        : null;

    return res.json({ ...r, resolved_at });
  } catch (e) {
    console.error("getMyLastRequest error:", e);
    return res.status(500).json({ error: "Failed to get last request" });
  }
}

/** -------- Ближайшая глава (public) -------- */

// GET /api/inside/chapters/next
async function getNextChapterPublic(_req, res) {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        chapter_key,
        title,
        starts_at,
        tour_starts_at,
        tour_ends_at,
        capacity,
        enrolled_count,
        status
      FROM inside_chapters
      WHERE starts_at IS NOT NULL
        AND (status IS NULL OR status IN ('scheduled','open'))
      ORDER BY starts_at ASC
      LIMIT 1
    `
    );

    if (!rows.length) return res.json(null);

    const r = rows[0];
    const capacity = r.capacity != null ? Number(r.capacity) : null;
    const enrolled = r.enrolled_count != null ? Number(r.enrolled_count) : 0;
    const places_left =
      capacity != null ? Math.max(0, capacity - enrolled) : null;

    return res.json({
      chapter_key: r.chapter_key,
      title: r.title,
      starts_at: r.starts_at,
      tour_starts_at: r.tour_starts_at,
      tour_ends_at: r.tour_ends_at,
      capacity,
      enrolled_count: enrolled,
      places_left,
      status: r.status || "scheduled",
    });
  } catch (e) {
    console.error("getNextChapterPublic error:", e);
    return res.status(500).json({ error: "Failed to get next chapter" });
  }
}

// GET /api/inside/chapters — список всех глав для клиента
async function getChaptersPublic(_req, res) {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        chapter_key,
        title,
        starts_at,
        tour_starts_at,
        tour_ends_at,
        capacity,
        enrolled_count,
        status
      FROM inside_chapters
      ORDER BY starts_at NULLS LAST, chapter_key
      `
    );

    // нормализуем и сортируем по CHAPTERS_ORDER
    const ordered = rows
      .map((r) => {
        const capacity =
          r.capacity !== null && r.capacity !== undefined
            ? Number(r.capacity)
            : null;
        const enrolled =
          r.enrolled_count !== null && r.enrolled_count !== undefined
            ? Number(r.enrolled_count)
            : 0;
        const remaining =
          capacity !== null ? Math.max(0, capacity - enrolled) : null;

        return {
          id: r.id,
          chapter_key: r.chapter_key,
          title: r.title,
          starts_at: r.starts_at,
          tour_starts_at: r.tour_starts_at,
          tour_ends_at: r.tour_ends_at,
          capacity,
          enrolled_count: enrolled,
          remaining,
          status: r.status || "draft",
        };
      })
      .sort((a, b) => {
        const ia = CHAPTERS_ORDER.indexOf(String(a.chapter_key));
        const ib = CHAPTERS_ORDER.indexOf(String(b.chapter_key));
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });

    // фронт уже умеет понимать и { items: [...] }, и просто массив
    return res.json({ items: ordered });
  } catch (e) {
    console.error("getChaptersPublic error:", e);
    return res.status(500).json({ error: "Failed to get chapters" });
  }
}

// GET /api/inside/chapters — публичный список всех глав
async function listChaptersPublic(_req, res) {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        chapter_key,
        title,
        starts_at,
        tour_starts_at,
        tour_ends_at,
        capacity,
        enrolled_count,
        status
      FROM inside_chapters
      ORDER BY starts_at NULLS LAST, chapter_key
      `
    );

    // фронту удобнее работать с items
    return res.json({ items: rows });
  } catch (e) {
    console.error("listChaptersPublic error:", e);
    return res.status(500).json({ error: "Failed to load chapters" });
  }
}

/** -------- admin — заявки -------- */

// GET /api/admin/inside/requests?status=pending|approved|rejected|all&q=...
async function adminListRequests(req, res) {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const offset = Math.max(0, Number(req.query.offset || 0));

    // нормализуем статус
    let status = String(req.query.status || "").trim().toLowerCase();
    if (
      ["wait", "waiting", "expected", "ожидают", "ожидание"].includes(status)
    )
      status = "pending";
    if (!["pending", "approved", "rejected", "all", ""].includes(status))
      status = ""; // неизвестное → не фильтруем

    const q = String(req.query.q || "").trim();
    const chapter = String(req.query.chapter || "").trim();

    const where = [];
    const params = [];

    if (status && status !== "all") {
      params.push(status);
      where.push(`r.status = $${params.length}`);
    }

    if (chapter) {
      params.push(chapter.toLowerCase());
      where.push(`LOWER(r.chapter) = $${params.length}`);
    }

    if (q) {
      // ищем по user_id, имени, телефону, телеграму, главе и статусу
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      where.push(`
        (
          CAST(r.user_id AS TEXT) ILIKE ${p}
          OR COALESCE(u.name,'') ILIKE ${p}
          OR COALESCE(u.phone,'') ILIKE ${p}
          OR COALESCE(u.telegram,'') ILIKE ${p}
          OR COALESCE(r.chapter,'') ILIKE ${p}
          OR COALESCE(r.status,'') ILIKE ${p}
        )
      `);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      SELECT
        r.id,
        r.user_id,
        r.chapter,
        r.status,
        r.requested_at,
        r.approved_at,
        r.rejected_at,
        CASE
          WHEN r.status = 'approved' THEN r.approved_at
          WHEN r.status = 'rejected' THEN r.rejected_at
          ELSE NULL
        END AS resolved_at,
        u.name     AS user_name,
        u.phone    AS user_phone,
        u.telegram AS user_telegram
      FROM inside_completion_requests r
      LEFT JOIN clients u ON u.id = r.user_id
      ${whereSql}
      ORDER BY
        CASE r.status
          WHEN 'pending'  THEN 1
          WHEN 'approved' THEN 2
          WHEN 'rejected' THEN 3
          ELSE 4
        END,
        COALESCE(
          CASE
            WHEN r.status = 'approved' THEN r.approved_at
            WHEN r.status = 'rejected' THEN r.rejected_at
            ELSE NULL
          END,
          r.requested_at
        ) DESC
      LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}
    `;

    const { rows } = await pool.query(sql, params);

    // total для пагинации
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM inside_completion_requests r
      LEFT JOIN clients u ON u.id = r.user_id
      ${whereSql}
    `;
    const { rows: countRows } = await pool.query(
      countSql,
      params.slice(0, params.length - 2)
    );
    res.json({ items: rows, total: countRows[0]?.total ?? rows.length });
  } catch (err) {
    console.error("adminListRequests error:", err);
    res.status(500).json({ error: "admin_list_failed" });
  }
}

// POST /api/admin/inside/requests/:id/approve { next_chapter? }
async function adminApproveRequest(req, res) {
  try {
    if (!req.user?.is_admin && !req.user?.is_moderator) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const id = Number(req.params.id);
    const { next_chapter, curator_id, curator_note } = req.body || {};
    if (!id) return res.status(400).json({ error: "Bad id" });

    // 1. читаем заявку
    const rq = await pool.query(
      `SELECT id, user_id, chapter, status
         FROM inside_completion_requests
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!rq.rowCount) return res.status(404).json({ error: "Not found" });

    const r = rq.rows[0];

    // Не даём повторно approve уже обработанную заявку
    if (r.status !== "pending") {
      return res.status(400).json({ error: "already_resolved" });
    }

    // 2. участник должен существовать
    await ensureParticipant(r.user_id);

    // 3. читаем участника
    const pRes = await pool.query(
      `SELECT user_id, current_chapter, progress_current, progress_total, status
         FROM inside_participants
        WHERE user_id = $1
        LIMIT 1`,
      [r.user_id]
    );

    if (!pRes.rowCount) {
      return res.status(400).json({ error: "participant_not_found" });
    }

    const p = pRes.rows[0];

    const prevProgress = Number(p.progress_current || 0);
    const total = Number(p.progress_total || PROGRESS_TOTAL_DEFAULT);
    const newProgress = Math.min(prevProgress + 1, total);

    let newStatus = p.status || "active";
    if (newProgress >= total) {
      newStatus = "completed";
    }

    let newCurrentChapter =
      p.current_chapter || CHAPTERS_ORDER[0] || "royal";

    // ВАЖНО:
    // НЕ переключаем главу автоматически.
    // Меняем current_chapter ТОЛЬКО если админ ЯВНО выбрал next_chapter.
    if (next_chapter && String(next_chapter).trim()) {
      newCurrentChapter = String(next_chapter).trim();
    }

    // 4. обновляем участника
    const upd = await pool.query(
      `UPDATE inside_participants
          SET progress_current = $1,
              progress_total   = $2,
              current_chapter  = $3,
              status           = $4,
              updated_at       = NOW()
        WHERE user_id = $5
        RETURNING user_id, current_chapter, progress_current, progress_total, status`,
      [newProgress, total, newCurrentChapter, newStatus, r.user_id]
    );

    // 5. закрываем заявку (чиним типы через явный каст)
    const done = await pool.query(
      `
      UPDATE inside_completion_requests
         SET status      = 'approved',
             approved_at = NOW(),
             curator_id  = COALESCE($2::int, curator_id),
             curator_note = COALESCE($3::text, curator_note)
       WHERE id = $1
       RETURNING
         id, user_id, chapter, status, requested_at, approved_at, rejected_at,
         curator_id, curator_note,
         CASE
           WHEN status = 'approved' THEN approved_at
           WHEN status = 'rejected' THEN rejected_at
           ELSE NULL
         END AS resolved_at
      `,
      [id, curator_id || null, curator_note || null]
    );

    return res.json(ok({ request: done.rows[0], participant: upd.rows[0] }));
  } catch (e) {
    console.error("adminApproveRequest error:", e);
    return res.status(500).json({ error: "Failed to approve request" });
  }
}

// POST /api/admin/inside/requests/:id/reject { reason? }
async function adminRejectRequest(req, res) {
  const { id } = req.params;
  const { curator_id, curator_note } = req.body || {};
  try {
    const q = `
      UPDATE inside_completion_requests
      SET status = 'rejected',
          rejected_at = NOW(),
          curator_id = COALESCE($2, curator_id),
          curator_note = COALESCE($3, curator_note)
      WHERE id = $1
      RETURNING
        id, user_id, chapter, status, requested_at, approved_at, rejected_at,
        curator_id, curator_note,
        CASE
          WHEN status = 'approved' THEN approved_at
          WHEN status = 'rejected' THEN rejected_at
          ELSE NULL
        END AS resolved_at
    `;
    const { rows } = await pool.query(q, [
      id,
      curator_id || null,
      curator_note || null,
    ]);
    return res.json(rows[0] || {});
  } catch (err) {
    console.error("adminRejectRequest error:", err);
    return res.status(500).json({ error: "admin_reject_failed" });
  }
}

/** -------- admin — участники -------- */

// GET /api/inside/admin/participants
async function adminListParticipants(req, res) {
  try {
    // только админ / модератор
    if (!req.user?.is_admin && !req.user?.is_moderator) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { rows } = await pool.query(`
      SELECT
        p.user_id,
        p.program_key,
        p.current_chapter,
        p.progress_current,
        p.progress_total,
        p.curator_telegram,
        p.status,
        p.started_at,
        p.updated_at,
        COALESCE(c.name, 'user_id: ' || p.user_id::text) AS user_name,
        c.telegram AS user_telegram
      FROM inside_participants p
      LEFT JOIN clients c ON c.id = p.user_id
      ORDER BY p.started_at DESC NULLS LAST, p.user_id
    `);

    return res.json(rows);
  } catch (e) {
    console.error("adminListParticipants error:", e);
    return res
      .status(500)
      .json({ error: "Failed to list participants" });
  }
}


// POST /api/inside/admin/participants/:userId/expel
async function adminExpelParticipant(req, res) {
  try {
    if (!req.user?.is_admin && !req.user?.is_moderator) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const userId = Number(req.params.userId);
    const { reason } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: "Bad userId" });
    }

    // 1. Обновляем статус участника
    const { rows: partRows } = await pool.query(
      `
      UPDATE inside_participants
         SET status = 'expelled',
             updated_at = NOW()
       WHERE user_id = $1
       RETURNING *
      `,
      [userId]
    );

    if (!partRows.length) {
      return res.status(404).json({ error: "participant_not_found" });
    }

    // 2. Приклеиваем причину к последней заявке (если есть)
    if (reason && String(reason).trim()) {
      const note = String(reason).trim();

      try {
        await pool.query(
          `
          UPDATE inside_completion_requests
             SET curator_note = COALESCE(curator_note, '') || E'\n[expel] ' || $2
           WHERE id = (
             SELECT id
               FROM inside_completion_requests
              WHERE user_id = $1
              ORDER BY requested_at DESC
              LIMIT 1
           )
          `,
          [userId, note]
        );
      } catch (e2) {
        console.error(
          "adminExpelParticipant: failed to attach reason to request",
          e2
        );
        // не роняем основной ответ
      }
    }

    return res.json(ok({ participant: partRows[0] }));
  } catch (e) {
    console.error("adminExpelParticipant error:", e);
    return res
      .status(500)
      .json({ error: "Failed to expel participant" });
  }
}

/** -------- admin главы (расписание) -------- */

// GET /api/inside/admin/chapters
async function adminListChapters(req, res) {
  try {
    // доступ только админу / модератору
    if (!req.user?.is_admin && !req.user?.is_moderator) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { rows } = await pool.query(
      `
      SELECT id, chapter_key, title,
             starts_at, tour_starts_at, tour_ends_at,
             capacity, enrolled_count, status,
             created_at, updated_at
      FROM inside_chapters
      ORDER BY starts_at NULLS LAST, chapter_key
    `
    );

    // жёстко отключаем кэширование этого ответа
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, max-age=0"
    );
    res.set("Pragma", "no-cache");

    return res.json(rows);
  } catch (e) {
    console.error("adminListChapters error:", e);
    return res.status(500).json({ error: "Failed to list chapters" });
  }
}

// POST /api/inside/admin/chapters  (upsert по chapter_key)
async function adminUpsertChapter(req, res) {
  try {
    // доступ только админу / модератору
    if (!req.user?.is_admin && !req.user?.is_moderator) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const {
      chapter_key,
      title,
      starts_at,
      tour_starts_at,
      tour_ends_at,
      capacity,
      enrolled_count,
      status,
    } = req.body || {};

    if (!chapter_key) {
      return res.status(400).json({ error: "chapter_key_required" });
    }

    // --- Валидация дат ---
    const now = new Date();

    const parseIso = (value, field) => {
      if (!value) return null;
      const s = String(value).trim();
      if (!s) return null;
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) {
        throw {
          httpCode: 400,
          error: "invalid_date",
          field,
          message: `Некорректное значение даты в поле ${field}`,
        };
      }
      return d;
    };

    let startsAtDate, tourStartsDate, tourEndsDate;
    try {
      startsAtDate = parseIso(starts_at, "starts_at");
      tourStartsDate = parseIso(tour_starts_at, "tour_starts_at");
      tourEndsDate = parseIso(tour_ends_at, "tour_ends_at");
    } catch (e) {
      if (e && e.httpCode) {
        return res
          .status(e.httpCode)
          .json({ error: e.error, field: e.field, message: e.message });
      }
      throw e;
    }

    // Запрещаем прошедшие даты (все три поля)
    if (startsAtDate && startsAtDate < now) {
      return res.status(400).json({
        error: "starts_at_in_past",
        field: "starts_at",
        message: "Дата старта набора не может быть в прошлом",
      });
    }

    if (tourStartsDate && tourStartsDate < now) {
      return res.status(400).json({
        error: "tour_starts_at_in_past",
        field: "tour_starts_at",
        message: "Дата начала тура не может быть в прошлом",
      });
    }

    if (tourEndsDate && tourEndsDate < now) {
      return res.status(400).json({
        error: "tour_ends_at_in_past",
        field: "tour_ends_at",
        message: "Дата окончания тура не может быть в прошлом",
      });
    }

    // Окончание тура должно быть позже начала
    if (tourStartsDate && tourEndsDate && tourEndsDate <= tourStartsDate) {
      return res.status(400).json({
        error: "tour_ends_before_start",
        field: "tour_ends_at",
        message: "Дата окончания тура должна быть позже даты начала",
      });
    }

    // Приводим к ISO-строке для записи в базу
    const startsAtIso = startsAtDate ? startsAtDate.toISOString() : null;
    const tourStartsIso = tourStartsDate ? tourStartsDate.toISOString() : null;
    const tourEndsIso = tourEndsDate ? tourEndsDate.toISOString() : null;

    const sql = `
      INSERT INTO inside_chapters (
        chapter_key, title,
        starts_at, tour_starts_at, tour_ends_at,
        capacity, enrolled_count, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (chapter_key)
      DO UPDATE SET
        title          = COALESCE(EXCLUDED.title, inside_chapters.title),
        starts_at      = COALESCE(EXCLUDED.starts_at, inside_chapters.starts_at),
        tour_starts_at = COALESCE(EXCLUDED.tour_starts_at, inside_chapters.tour_starts_at),
        tour_ends_at   = COALESCE(EXCLUDED.tour_ends_at, inside_chapters.tour_ends_at),
        capacity       = COALESCE(EXCLUDED.capacity, inside_chapters.capacity),
        enrolled_count = COALESCE(EXCLUDED.enrolled_count, inside_chapters.enrolled_count),
        status         = COALESCE(EXCLUDED.status, inside_chapters.status),
        updated_at     = NOW()
      RETURNING *
    `;

    const { rows } = await pool.query(sql, [
      chapter_key,
      title || null,
      startsAtIso,
      tourStartsIso,
      tourEndsIso,
      capacity != null ? Number(capacity) : null,
      enrolled_count != null ? Number(enrolled_count) : null,
      status || null,
    ]);

    return res.json(ok({ chapter: rows[0] }));
  } catch (e) {
    console.error("adminUpsertChapter error:", e);
    return res.status(500).json({ error: "Failed to save chapter" });
  }
}

module.exports = {
  // client/public
  getInsideMe,
  getInsideById,
  getInsideStatus,
  requestCompletion,
  joinInside,
  getMyLastRequest,
  getNextChapterPublic,
  getChaptersPublic,
  // admin
  adminListRequests,
  adminApproveRequest,
  adminRejectRequest,
  adminListParticipants,
  adminExpelParticipant,
  adminListChapters,
  adminUpsertChapter,
};
