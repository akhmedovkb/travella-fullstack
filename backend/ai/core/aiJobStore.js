// backend/ai/core/aiJobStore.js
// Runtime-first job store: synchronous in-memory cache with PostgreSQL persistence.

const pool = require("../../db");

const jobs = [];
let seq = 1;
let initPromise = null;
let tablesReadyPromise = null;
let warnedPersistence = false;

function nowIso() {
  return new Date().toISOString();
}

function persistenceEnabled() {
  if (String(process.env.AI_JOB_STORE_DB_ENABLED || "").toLowerCase() === "false") return false;
  return Boolean(process.env.DATABASE_URL);
}

function makeJobId() {
  return `ai_${Date.now().toString(36)}_${seq++}`;
}

function safeJson(value, fallback = null) {
  return value === undefined ? fallback : value;
}

function warnPersistenceOnce(err) {
  if (warnedPersistence) return;
  warnedPersistence = true;
  console.warn("[ai-jobs] PostgreSQL persistence disabled/failed:", err?.message || err);
}

async function ensureAiJobTables() {
  if (!persistenceEnabled()) return false;
  if (!tablesReadyPromise) {
    tablesReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_jobs (
          id TEXT PRIMARY KEY,
          employee_id TEXT NOT NULL,
          type TEXT,
          command TEXT,
          status TEXT NOT NULL DEFAULT 'created',
          input JSONB NOT NULL DEFAULT '{}'::jsonb,
          output JSONB,
          error JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_job_events (
          id BIGSERIAL PRIMARY KEY,
          job_id TEXT NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
          at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          level TEXT NOT NULL DEFAULT 'info',
          type TEXT NOT NULL DEFAULT 'event',
          step TEXT NOT NULL DEFAULT 'runtime',
          tool TEXT,
          message TEXT NOT NULL DEFAULT '',
          meta JSONB
        )
      `);
      await pool.query("CREATE INDEX IF NOT EXISTS idx_ai_jobs_employee_created ON ai_jobs(employee_id, created_at DESC)");
      await pool.query("CREATE INDEX IF NOT EXISTS idx_ai_job_events_job_at ON ai_job_events(job_id, at ASC, id ASC)");
      return true;
    })().catch((err) => {
      tablesReadyPromise = null;
      warnPersistenceOnce(err);
      return false;
    });
  }
  return tablesReadyPromise;
}

function schedule(task) {
  if (!persistenceEnabled()) return;
  Promise.resolve()
    .then(task)
    .catch(warnPersistenceOnce);
}

async function persistJob(job) {
  if (!(await ensureAiJobTables())) return;
  await pool.query(
    `
      INSERT INTO ai_jobs (id, employee_id, type, command, status, input, output, error, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        employee_id = EXCLUDED.employee_id,
        type = EXCLUDED.type,
        command = EXCLUDED.command,
        status = EXCLUDED.status,
        input = EXCLUDED.input,
        output = EXCLUDED.output,
        error = EXCLUDED.error,
        updated_at = EXCLUDED.updated_at
    `,
    [
      job.id,
      job.employeeId,
      job.type || null,
      job.command || "",
      job.status || "created",
      JSON.stringify(safeJson(job.input, {})),
      JSON.stringify(safeJson(job.output, null)),
      JSON.stringify(safeJson(job.error, null)),
      job.createdAt,
      job.updatedAt,
    ]
  );
}

async function persistEvent(jobId, event) {
  if (!(await ensureAiJobTables())) return;
  await pool.query(
    `
      INSERT INTO ai_job_events (job_id, at, level, type, step, tool, message, meta)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      jobId,
      event.at,
      event.level || "info",
      event.type || "event",
      event.step || "runtime",
      event.tool || null,
      event.message || "",
      JSON.stringify(safeJson(event.meta, null)),
    ]
  );
}

function rowToJob(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    type: row.type,
    command: row.command,
    status: row.status,
    input: row.input || {},
    output: row.output || null,
    error: row.error || null,
    events: [],
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

function rowToEvent(row) {
  return {
    at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
    level: row.level || "info",
    type: row.type || "event",
    step: row.step || "runtime",
    tool: row.tool || null,
    message: row.message || "",
    meta: row.meta || null,
  };
}

async function initAiJobStore({ limit = 100, force = false } = {}) {
  if (!persistenceEnabled()) return { enabled: false, loaded: jobs.length };
  if (initPromise && !force) return initPromise;
  initPromise = (async () => {
    if (!(await ensureAiJobTables())) return { enabled: false, loaded: jobs.length };
    const jobRows = await pool.query(
      `
        SELECT *
        FROM ai_jobs
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [Math.max(1, Math.min(Number(limit) || 100, 500))]
    );

    const loadedJobs = jobRows.rows.map(rowToJob);
    const byId = new Map(loadedJobs.map((job) => [String(job.id), job]));
    const ids = loadedJobs.map((job) => job.id);

    if (ids.length) {
      const eventRows = await pool.query(
        `
          SELECT *
          FROM ai_job_events
          WHERE job_id = ANY($1::text[])
          ORDER BY at ASC, id ASC
        `,
        [ids]
      );
      for (const row of eventRows.rows) {
        const job = byId.get(String(row.job_id));
        if (job) job.events.push(rowToEvent(row));
      }
    }

    const existing = jobs.filter((job) => !byId.has(String(job.id)));
    jobs.splice(0, jobs.length, ...existing, ...loadedJobs);
    seq = Math.max(seq, jobs.length + 1);
    console.log(`[ai-jobs] PostgreSQL history loaded: ${jobs.length} jobs`);
    return { enabled: true, loaded: jobs.length };
  })().catch((err) => {
    initPromise = null;
    warnPersistenceOnce(err);
    return { enabled: false, loaded: jobs.length, error: err?.message || String(err) };
  });
  return initPromise;
}

function createJob({ employeeId, type, command, input = {}, status = "created" }) {
  const job = {
    id: makeJobId(),
    employeeId,
    type,
    command,
    status,
    input,
    output: null,
    error: null,
    events: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  jobs.unshift(job);
  schedule(() => persistJob(job));
  return job;
}

function addEvent(jobId, event) {
  const job = getJob(jobId);
  if (!job) return null;
  const row = {
    at: nowIso(),
    level: event.level || "info",
    type: event.type || "event",
    step: event.step || "runtime",
    tool: event.tool || null,
    message: event.message || "",
    meta: event.meta || null,
  };
  job.events.push(row);
  job.updatedAt = nowIso();
  schedule(async () => {
    await persistJob(job);
    await persistEvent(job.id, row);
  });
  return row;
}

function updateJob(jobId, patch = {}) {
  const job = getJob(jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: nowIso() });
  schedule(() => persistJob(job));
  return job;
}

function getJob(jobId) {
  return jobs.find((x) => String(x.id) === String(jobId)) || null;
}

function listJobs({ employeeId = "", limit = 30 } = {}) {
  let rows = jobs;
  if (employeeId) rows = rows.filter((x) => x.employeeId === employeeId);
  return rows.slice(0, Math.max(1, Math.min(Number(limit) || 30, 100)));
}

module.exports = { createJob, addEvent, updateJob, getJob, listJobs, initAiJobStore, ensureAiJobTables };
