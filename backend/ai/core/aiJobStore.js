// backend/ai/core/aiJobStore.js

const crypto = require("crypto");

const jobs = new Map();

function nowIso() {
  return new Date().toISOString();
}

function createAiJob({ employeeId, type, input = {}, output = {}, status = "created", provider = null }) {
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  const job = {
    id,
    employeeId,
    type,
    status,
    provider,
    input,
    output,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  jobs.set(id, job);
  return job;
}

function updateAiJob(id, patch = {}) {
  const current = jobs.get(id);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    updatedAt: nowIso(),
  };
  jobs.set(id, next);
  return next;
}

function getAiJob(id) {
  return jobs.get(id) || null;
}

function listAiJobs({ limit = 25, employeeId = null } = {}) {
  const rows = Array.from(jobs.values())
    .filter((job) => (!employeeId ? true : job.employeeId === employeeId))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return rows.slice(0, Math.max(1, Math.min(Number(limit) || 25, 100)));
}

module.exports = {
  createAiJob,
  updateAiJob,
  getAiJob,
  listAiJobs,
};
