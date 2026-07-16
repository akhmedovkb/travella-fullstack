// backend/ai/videoOperator/heygen.client.js

const axios = require("axios");
const { getAiConfig } = require("../core/aiConfig");

function getHeaders(apiKey, idempotencyKey = null) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

function normalizeHeygenError(error) {
  const status = error?.response?.status || 500;
  const data = error?.response?.data || null;
  const message =
    data?.message ||
    data?.error ||
    data?.data?.message ||
    error?.message ||
    "HeyGen request failed";

  const err = new Error(message);
  err.status = status;
  err.data = data;
  return err;
}

async function createAvatarVideo({ script, title, aspectRatio, resolution, engine, idempotencyKey }) {
  const config = getAiConfig();
  const heygen = config.video.heygen;

  if (!config.video.enabled) {
    const err = new Error("AI video generation is disabled. Set AI_VIDEO_ENABLED=true.");
    err.code = "AI_VIDEO_DISABLED";
    err.status = 400;
    throw err;
  }

  if (!heygen.ready) {
    const err = new Error("HeyGen is not configured. Check HEYGEN_API_KEY, HEYGEN_AVATAR_ID, HEYGEN_VOICE_ID.");
    err.code = "HEYGEN_NOT_CONFIGURED";
    err.status = 400;
    throw err;
  }

  const payload = {
    type: "avatar",
    avatar_id: heygen.avatarId,
    script: String(script || "").trim(),
    voice_id: heygen.voiceId,
    title: String(title || "Travella Video Operator").slice(0, 120),
    resolution: resolution || heygen.defaultResolution || "1080p",
    aspect_ratio: aspectRatio || heygen.defaultAspectRatio || "9:16",
    output_format: "mp4",
  };

  const engineType = engine || heygen.defaultEngine;
  if (engineType && engineType !== "avatar_iv") {
    payload.engine = { type: engineType };
  }

  try {
    const res = await axios.post(`${heygen.baseUrl}/v3/videos`, payload, {
      headers: getHeaders(heygen.apiKey, idempotencyKey),
      timeout: 30000,
    });
    return res.data;
  } catch (error) {
    throw normalizeHeygenError(error);
  }
}

async function getAvatarVideo(videoId) {
  const config = getAiConfig();
  const heygen = config.video.heygen;

  if (!heygen.ready) {
    const err = new Error("HeyGen is not configured.");
    err.status = 400;
    throw err;
  }

  try {
    const res = await axios.get(`${heygen.baseUrl}/v3/videos/${encodeURIComponent(videoId)}`, {
      headers: getHeaders(heygen.apiKey),
      timeout: 20000,
    });
    return res.data;
  } catch (error) {
    throw normalizeHeygenError(error);
  }
}

module.exports = {
  createAvatarVideo,
  getAvatarVideo,
};
