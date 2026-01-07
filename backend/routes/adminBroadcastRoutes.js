// backend/routes/adminBroadcastRoutes.js
// Массовая рассылка (админ) через Bot Otkaznyx Turov (TELEGRAM_CLIENT_BOT_TOKEN)

const express = require("express");
const router = express.Router();

const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const { tgSend } = require("../utils/telegram");

const CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";

// in-memory runners (1 node process)
const runners = new Map();

function toSafeText(v) {
  return String(v || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function isIntId(x) {
  const n = Number(x);
  return Number.isInteger(n) && n > 0;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeAudience(a) {
  const v = String(a || "").trim().toLowerCase();
  if (v === "clients" || v === "client") return "clients";
  if (v === "providers" || v === "provider") return "providers";
  if (v === "all" || v === "both") return "all";
  return "all";
}

async function ensureClientBotEnabled() {
  if (!CLIENT_TOKEN) {
    const err = new Error("TELEGRAM_CLIENT_BOT_TOKEN is missing");
    err.code = "NO_CLIENT_BOT";
    throw err;
  }
}

async function createRecipients(broadcastId, audience) {
  // только реально привязанные к отказному боту:
  // providers.telegram_refused_chat_id
  // clients.telegram_chat_id

  const inserts = [];
  const params = [];
  let p = 1;

  const pushRow = (role, chatId) => {
    inserts.push(`($${p++}, $${p++}, $${p++}, 'pending')`);
    params.push(broadcastId, role, String(chatId));
  };

  if (audience === "providers" || audience === "all") {
    const q = await pool.query(
      `SELECT telegram_refused_chat_id AS chat_id
         FROM providers
        WHERE telegram_refused_chat_id IS NOT NULL
          AND TRIM(telegram_refused_chat_id::text) <> ''`
    );
    for (const r of q.rows) {
      if (r.chat_id) pushRow("provider", r.chat_id);
    }
  }

  if (audience === "clients" || audience === "all") {
    const q = await pool.query(
      `SELECT telegram_chat_id AS chat_id
         FROM clients
        WHERE telegram_chat_id IS NOT NULL
          AND TRIM(telegram_chat_id::text) <> ''`
    );
    for (const r of q.rows) {
      if (r.chat_id) pushRow("client", r.chat_id);
    }
  }

  if (!inserts.length) return 0;

  await pool.query(
    `INSERT INTO broadcast_recipients (broadcast_id, role, chat_id, status)
     VALUES ${inserts.join(",")}`,
    params
  );

  return inserts.length;
}

async function getBroadcast(broadcastId) {
  const q = await pool.query(`SELECT * FROM broadcasts WHERE id = $1`, [broadcastId]);
  return q.rows[0] || null;
}

async function updateCounters(broadcastId) {
  const q = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'sent')    AS sent,
        COUNT(*) FILTER (WHERE status = 'failed')  AS failed,
        COUNT(*)                                  AS total
     FROM broadcast_recipients
     WHERE broadcast_id = $1`,
    [broadcastId]
  );
  const s = q.rows[0] || {};
  await pool.query(
    `UPDATE broadcasts
        SET total = $2,
            sent = $3,
            failed = $4,
            updated_at = NOW()
      WHERE id = $1`,
    [broadcastId, Number(s.total || 0), Number(s.sent || 0), Number(s.failed || 0)]
  );
  return {
    total: Number(s.total || 0),
    pending: Number(s.pending || 0),
    sent: Number(s.sent || 0),
    failed: Number(s.failed || 0),
  };
}

async function markBroadcastStatus(broadcastId, status) {
  const st = String(status || "");
  if (st === "running") {
    await pool.query(
      `UPDATE broadcasts
          SET status = 'running',
              started_at = COALESCE(started_at, NOW()),
              updated_at = NOW()
        WHERE id = $1`,
      [broadcastId]
    );
    return;
  }
  if (st === "paused") {
    await pool.query(
      `UPDATE broadcasts
          SET status = 'paused',
              updated_at = NOW()
        WHERE id = $1`,
      [broadcastId]
    );
    return;
  }
  if (st === "done") {
    await pool.query(
      `UPDATE broadcasts
          SET status = 'done',
              finished_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [broadcastId]
    );
    return;
  }
  if (st === "failed") {
    await pool.query(
      `UPDATE broadcasts
          SET status = 'failed',
              finished_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [broadcastId]
    );
    return;
  }
}

async function takeBatch(broadcastId, limit = 25) {
  // SKIP LOCKED — чтобы в будущем можно было масштабировать на несколько воркеров
  const q = await pool.query(
    `WITH cte AS (
       SELECT id
         FROM broadcast_recipients
        WHERE broadcast_id = $1
          AND status = 'pending'
        ORDER BY id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
     )
     UPDATE broadcast_recipients br
        SET status = 'sending',
            updated_at = NOW()
       FROM cte
      WHERE br.id = cte.id
     RETURNING br.id, br.role, br.chat_id`,
    [broadcastId, limit]
  );
  return q.rows || [];
}

async function markRecipient(broadcastRecipientId, status, error = "") {
  const st = String(status || "");
  if (st === "sent") {
    await pool.query(
      `UPDATE broadcast_recipients
          SET status = 'sent',
              error = NULL,
              sent_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [broadcastRecipientId]
    );
    return;
  }
  if (st === "failed") {
    await pool.query(
      `UPDATE broadcast_recipients
          SET status = 'failed',
              error = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [broadcastRecipientId, String(error || "")]
    );
    return;
  }
  // вернуть в pending (на случай паузы)
  if (st === "pending") {
    await pool.query(
      `UPDATE broadcast_recipients
          SET status = 'pending',
              updated_at = NOW()
        WHERE id = $1`,
      [broadcastRecipientId]
    );
  }
}

function isRateLimitError(err) {
  const data = err?.response?.data;
  const code = Number(data?.error_code || 0);
  const desc = String(data?.description || "");
  return code === 429 || /too many requests/i.test(desc);
}

function extractRetryAfterSeconds(err) {
  const data = err?.response?.data;
  const ra = Number(data?.parameters?.retry_after || 0);
  if (Number.isFinite(ra) && ra > 0) return ra;
  return 0;
}

async function runBroadcast(broadcastId) {
  // single runner per broadcast id
  if (runners.has(broadcastId)) return runners.get(broadcastId);

  const state = {
    id: broadcastId,
    stop: false,
    paused: false,
    startedAt: nowIso(),
    lastTickAt: nowIso(),
  };

  const task = (async () => {
    try {
      await ensureClientBotEnabled();
      await markBroadcastStatus(broadcastId, "running");

      // throttling: базовая задержка
      let delayMs = 55; // ~18 msg/sec (безопасно)
      const batchSize = 25;

      while (!state.stop) {
        state.lastTickAt = nowIso();

        // check DB status (pause/stop from UI)
        const b = await getBroadcast(broadcastId);
        if (!b) break;
        if (b.status === "paused") {
          await sleep(400);
          continue;
        }
        if (b.status !== "running") {
          // если админ руками поставит done/failed
          break;
        }

        const batch = await takeBatch(broadcastId, batchSize);
        if (!batch.length) {
          // всё отправлено
          await updateCounters(broadcastId);
          await markBroadcastStatus(broadcastId, "done");
          break;
        }

        for (const r of batch) {
          if (state.stop) break;

          // повторная проверка паузы между сообщениями
          const b2 = await getBroadcast(broadcastId);
          if (!b2 || b2.status !== "running") {
            // вернуть в pending всё, что в sending
            await markRecipient(r.id, "pending");
            continue;
          }

          try {
            const ok = await tgSend(
              r.chat_id,
              String(b2.text || ""),
              {},
              CLIENT_TOKEN,
              true // throwOnError
            );

            if (ok) {
              await markRecipient(r.id, "sent");
            } else {
              await markRecipient(r.id, "failed", "tgSend: not ok");
            }
          } catch (e) {
            // 429: backoff
            if (isRateLimitError(e)) {
              const ra = extractRetryAfterSeconds(e);
              const backoffMs = Math.max(1000, ra ? ra * 1000 : 2500);
              delayMs = Math.min(500, delayMs + 25);
              await markRecipient(r.id, "pending"); // вернём в очередь
              await sleep(backoffMs);
              continue;
            }

            const data = e?.response?.data;
            const code = data?.error_code ? `#${data.error_code}` : "";
            const desc = data?.description || e?.message || "tg error";
            await markRecipient(r.id, "failed", `${code} ${desc}`.trim());
          }

          await sleep(delayMs);
        }

        // обновляем счётчики пачками
        await updateCounters(broadcastId);
      }
    } catch (e) {
      console.error("[broadcast runner] failed:", e?.message || e);
      try {
        await updateCounters(broadcastId);
        await markBroadcastStatus(broadcastId, "failed");
      } catch {
        /* ignore */
      }
    } finally {
      runners.delete(broadcastId);
    }
  })();

  runners.set(broadcastId, { state, task });
  return runners.get(broadcastId);
}

/* ===================== ROUTES ===================== */

// create draft broadcast + recipients
router.post("/create", authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureClientBotEnabled();

    const text = toSafeText(req.body?.text);
    if (!text) return res.status(400).json({ message: "Text is required" });

    const audience = normalizeAudience(req.body?.audience);
    const adminId = req.user?.id || null;

    const ins = await pool.query(
      `INSERT INTO broadcasts (created_by, audience, text, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'draft', NOW(), NOW())
       RETURNING id, status, audience, created_at`,
      [adminId, audience, text]
    );
    const broadcast = ins.rows[0];

    const total = await createRecipients(broadcast.id, audience);
    await pool.query(
      `UPDATE broadcasts SET total=$2, updated_at = NOW() WHERE id=$1`,
      [broadcast.id, total]
    );

    res.json({ ok: true, broadcastId: broadcast.id, total });
  } catch (e) {
    res.status(500).json({ message: e?.message || "Failed to create broadcast" });
  }
});

// start
router.post("/:id(\\d+)/start", authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureClientBotEnabled();
    const id = Number(req.params.id);
    if (!isIntId(id)) return res.status(400).json({ message: "Bad id" });

    const b = await getBroadcast(id);
    if (!b) return res.status(404).json({ message: "Not found" });
    if (!b.total || Number(b.total) <= 0) {
      return res.status(400).json({ message: "No recipients" });
    }

    // allow restart if draft/paused
    await pool.query(
      `UPDATE broadcasts
          SET status = 'running',
              started_at = COALESCE(started_at, NOW()),
              updated_at = NOW()
        WHERE id = $1`,
      [id]
    );

    await runBroadcast(id);
    const counters = await updateCounters(id);
    res.json({ ok: true, status: "running", ...counters });
  } catch (e) {
    res.status(500).json({ message: e?.message || "Failed to start broadcast" });
  }
});

// pause
router.post("/:id(\\d+)/pause", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!isIntId(id)) return res.status(400).json({ message: "Bad id" });
    const b = await getBroadcast(id);
    if (!b) return res.status(404).json({ message: "Not found" });

    await markBroadcastStatus(id, "paused");
    const counters = await updateCounters(id);
    res.json({ ok: true, status: "paused", ...counters });
  } catch (e) {
    res.status(500).json({ message: e?.message || "Failed to pause broadcast" });
  }
});

// status
router.get("/:id(\\d+)/status", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!isIntId(id)) return res.status(400).json({ message: "Bad id" });
    const b = await getBroadcast(id);
    if (!b) return res.status(404).json({ message: "Not found" });

    const counters = await updateCounters(id);
    const errors = await pool.query(
      `SELECT id, role, chat_id, error, updated_at
         FROM broadcast_recipients
        WHERE broadcast_id = $1
          AND status = 'failed'
        ORDER BY updated_at DESC
        LIMIT 15`,
      [id]
    );

    res.json({
      ok: true,
      broadcast: {
        id: b.id,
        status: b.status,
        audience: b.audience,
        text: b.text,
        created_at: b.created_at,
        started_at: b.started_at,
        finished_at: b.finished_at,
      },
      ...counters,
      lastErrors: errors.rows || [],
    });
  } catch (e) {
    res.status(500).json({ message: e?.message || "Failed to get status" });
  }
});

// send test message (default -> first ADMIN chat id from ENV, or explicit chatId)
router.post("/test", authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureClientBotEnabled();
    const text = toSafeText(req.body?.text);
    if (!text) return res.status(400).json({ message: "Text is required" });

    const chatId = toSafeText(req.body?.chatId);
    let target = chatId;

    if (!target) {
      const ADMIN_CHAT_IDS =
        (process.env.ADMIN_TG_CHAT_IDS ||
          process.env.ADMIN_TG_CHAT ||
          process.env.TELEGRAM_ADMIN_CHAT_IDS ||
          process.env.TELEGRAM_ADMIN_CHAT ||
          "")
          .split(/[,\s]+/)
          .map((x) => x.trim())
          .filter(Boolean);
      target = ADMIN_CHAT_IDS[0] || "";
    }

    if (!target) {
      return res
        .status(400)
        .json({ message: "No chatId provided and no ADMIN_TG_CHAT_IDS in env" });
    }

    await tgSend(target, text, {}, CLIENT_TOKEN, true);
    res.json({ ok: true, chatId: target });
  } catch (e) {
    res.status(500).json({ message: e?.message || "Failed to send test" });
  }
});

module.exports = router;
