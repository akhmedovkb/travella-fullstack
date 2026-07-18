// backend/ai/videoOperator/videoOperator.service.js

const { buildVideoOperatorScript } = require("./videoOperator.prompt");
const { createAvatarVideo, getAvatarVideo } = require("./heygen.client");
const { createAiJob, updateAiJob, getAiJob, listAiJobs } = require("../core/aiJobStore");

function buildTitle(input = {}) {
  const code = input.code ? ` ${String(input.code).trim()}` : "";
  const destination = input.destination ? ` — ${String(input.destination).trim()}` : "";
  return `Travella отказной тур${code}${destination}`.slice(0, 120);
}

async function prepareVideoOperatorScript(input = {}) {
  const output = buildVideoOperatorScript(input);
  const job = createAiJob({
    employeeId: "video_operator",
    type: "script_preview",
    status: "completed",
    input,
    output,
  });
  return { job, output };
}

async function createVideoOperatorVideo(input = {}) {
  const prepared = buildVideoOperatorScript(input);
  const job = createAiJob({
    employeeId: "video_operator",
    type: "heygen_video",
    status: "creating",
    provider: "heygen",
    input,
    output: prepared,
  });

  try {
    const heygenResponse = await createAvatarVideo({
      script: prepared.script,
      motionPrompt: prepared.motionPrompt,
      title: buildTitle(input),
      aspectRatio: input.aspectRatio || prepared.style.aspectRatio,
      resolution: input.resolution,
      engine: input.engine,
      idempotencyKey: `travella:${job.id}`,
    });

    const videoId = heygenResponse?.data?.video_id || heygenResponse?.video_id || null;
    const status = heygenResponse?.data?.status || heygenResponse?.status || "submitted";

    const updated = updateAiJob(job.id, {
      status,
      output: {
        ...prepared,
        heygen: heygenResponse,
        videoId,
      },
    });

    return { job: updated, output: updated.output };
  } catch (error) {
    const failed = updateAiJob(job.id, {
      status: "failed",
      error: {
        message: error.message,
        status: error.status || 500,
        data: error.data || null,
      },
    });
    return { job: failed, error: failed.error };
  }
}

async function refreshVideoOperatorJob(jobId) {
  const job = getAiJob(jobId);
  if (!job) return null;

  const videoId = job.output?.videoId;
  if (!videoId) return job;

  const heygenStatus = await getAvatarVideo(videoId);
  const status = heygenStatus?.data?.status || heygenStatus?.status || job.status;

  return updateAiJob(job.id, {
    status,
    output: {
      ...job.output,
      heygenStatus,
      videoUrl: heygenStatus?.data?.video_url || heygenStatus?.video_url || job.output?.videoUrl || null,
    },
  });
}

module.exports = {
  prepareVideoOperatorScript,
  createVideoOperatorVideo,
  refreshVideoOperatorJob,
  listVideoOperatorJobs: (limit = 25) => listAiJobs({ employeeId: "video_operator", limit }),
};
