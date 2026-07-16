const crypto = require("crypto");

const API_BASE = (
  process.env.AI_PLATFORM_SMOKE_API_BASE ||
  process.env.API_PUBLIC_URL ||
  process.env.API_BASE_URL ||
  process.env.BACKEND_URL ||
  "https://travella-fullstack-production.up.railway.app"
).replace(/\/+$/, "");

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required for production AI Platform smoke");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function authToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    id: "ai-platform-smoke",
    role: "admin",
    roles: ["admin"],
    is_admin: true,
    smoke: true,
    iat: now,
    exp: now + 600,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function request(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { res, data };
}

async function main() {
  const token = authToken();

  const status = await request("/api/admin/ai-platform/status", { token });
  assert(status.res.ok, `status failed: HTTP ${status.res.status}`);
  assert(status.data?.success === true, "status response is not success");
  assert(status.data?.video?.enabled === false, "AI_VIDEO_ENABLED must be false for this smoke");
  assert(status.data?.publishing?.telegramReady === true, "Telegram publish env should be ready");
  assert(status.data?.publishing?.schedulerEnabled === false, "Scheduler must stay disabled");
  assert(
    status.data?.publishing?.schedulerReadyReason === "disabled_by_env",
    `Unexpected scheduler reason: ${status.data?.publishing?.schedulerReadyReason}`
  );

  const code = `PROD-SMOKE-${Date.now()}`;
  const script = await request("/api/admin/ai-platform/video-operator/script", {
    method: "POST",
    token,
    body: {
      code,
      title: "Production safe smoke",
      category: "Отказной тур",
      fromCity: "Ташкент",
      destination: "TEST",
      dates: "smoke only",
      hotel: "Smoke Hotel",
      meal: "BB",
      people: "2 adults",
      price: "1",
      currency: "USD",
      urgency: "production smoke only, do not publish",
    },
  });
  assert(script.res.ok, `script failed: HTTP ${script.res.status}`);
  assert(script.data?.success === true, "script response is not success");
  assert(script.data?.job?.id, "script job id missing");
  assert(script.data?.job?.status === "script_ready", `unexpected job status: ${script.data?.job?.status}`);
  assert(script.data?.output?.hook, "hook missing");
  assert(script.data?.output?.script, "script missing");

  const jobId = script.data.job.id;
  const heygen = await request(`/api/admin/ai-platform/video-operator/jobs/${encodeURIComponent(jobId)}/heygen/start`, {
    method: "POST",
    token,
  });
  assert(!heygen.res.ok, "HeyGen start unexpectedly succeeded while AI_VIDEO_ENABLED=false");
  const message = heygen.data?.error?.message || heygen.data?.message || "";
  assert(/disabled/i.test(message), `Unexpected HeyGen safety message: ${message}`);

  const jobs = await request("/api/admin/ai-platform/video-operator/jobs?limit=5", { token });
  assert(jobs.res.ok, `jobs failed: HTTP ${jobs.res.status}`);
  assert(Array.isArray(jobs.data?.jobs), "jobs list missing");
  assert(jobs.data.jobs.some((job) => job.id === jobId), "created smoke job not visible in jobs list");

  console.log("Production AI Platform safe smoke passed.");
  console.log(`API: ${API_BASE}`);
  console.log(`Job: ${jobId}`);
  console.log(`Scheduler: ${status.data.publishing.schedulerReadyReason}`);
  console.log(`HeyGen safety: ${message}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
