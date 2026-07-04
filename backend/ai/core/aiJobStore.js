// backend/ai/core/aiJobStore.js
// MVP in-memory store. Later this becomes PostgreSQL ai_jobs / ai_job_events.

const jobs = [];
let seq = 1;

function nowIso() {
  return new Date().toISOString();
}

function createJob({ employeeId, type, command, input = {}, status = "created" }) {
  const job = {
    id: String(seq++),
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
  return job;
}

function addEvent(jobId, event) {
  const job = getJob(jobId);
  if (!job) return null;
  const row = {
    at: nowIso(),
    level: event.level || "info",
    step: event.step || "runtime",
    message: event.message || "",
    meta: event.meta || null,
  };
  job.events.push(row);
  job.updatedAt = nowIso();
  return row;
}

function updateJob(jobId, patch = {}) {
  const job = getJob(jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: nowIso() });
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

module.exports = { createJob, addEvent, updateJob, getJob, listJobs };
