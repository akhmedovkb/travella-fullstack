const axios = require("axios");

function optionalRequire(path, fallback) {
  try {
    return require(path);
  } catch {
    return fallback;
  }
}

function getR2Upload() {
  return optionalRequire("../../utils/r2Upload", { hasR2Config: () => false, uploadBufferToR2: null });
}

function getCloudinaryUpload() {
  return optionalRequire("../../utils/cloudinary", { hasCloudinaryConfig: () => false, uploadBufferToCloudinary: null });
}

function safePart(value, fallback = "video") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function getStorageProvider() {
  if (getR2Upload().hasR2Config()) return "r2";
  if (getCloudinaryUpload().hasCloudinaryConfig()) return "cloudinary";
  return "";
}

function getArtifactStorageStatus() {
  return {
    provider: getStorageProvider(),
    r2Ready: getR2Upload().hasR2Config(),
    cloudinaryReady: getCloudinaryUpload().hasCloudinaryConfig(),
  };
}

async function downloadVideoBuffer(videoUrl) {
  if (!videoUrl) {
    const err = new Error("video_url_required");
    err.code = "video_url_required";
    throw err;
  }

  const response = await axios.get(videoUrl, {
    responseType: "arraybuffer",
    timeout: 120000,
    maxContentLength: 300 * 1024 * 1024,
    maxBodyLength: 300 * 1024 * 1024,
  });

  const contentType = String(response.headers?.["content-type"] || "video/mp4").split(";")[0] || "video/mp4";
  return {
    buffer: Buffer.from(response.data),
    contentType,
    bytes: Number(response.headers?.["content-length"] || response.data?.byteLength || 0) || null,
  };
}

async function saveHeygenVideoArtifact({ jobId, videoId, videoUrl, serviceCode = "" }) {
  const provider = getStorageProvider();
  if (!provider) {
    const err = new Error("media_storage_not_configured");
    err.code = "media_storage_not_configured";
    throw err;
  }

  const downloaded = await downloadVideoBuffer(videoUrl);
  const file = {
    buffer: downloaded.buffer,
    mimetype: downloaded.contentType.startsWith("video/") ? downloaded.contentType : "video/mp4",
    originalname: `${safePart(serviceCode || videoId || jobId, "travella-ai")}-${safePart(videoId || jobId, "video")}.mp4`,
  };

  const folder = "travella-ai/video-operator";
  const publicPrefix = safePart(`${serviceCode || "travella"}-${videoId || jobId}`, "travella-video");
  const uploaded =
    provider === "r2"
      ? await getR2Upload().uploadBufferToR2(file, { folder, public_prefix: publicPrefix })
      : await getCloudinaryUpload().uploadBufferToCloudinary(file, { folder, public_prefix: publicPrefix, resource_type: "video" });

  return {
    provider,
    status: "saved",
    url: uploaded.url,
    key: uploaded.key || uploaded.public_id || "",
    publicId: uploaded.public_id || uploaded.key || "",
    mediaType: uploaded.media_type || "video",
    resourceType: uploaded.resource_type || "video",
    thumbnailUrl: uploaded.thumbnail_url || uploaded.url,
    bytes: downloaded.bytes,
    savedAt: new Date().toISOString(),
  };
}

module.exports = {
  getArtifactStorageStatus,
  saveHeygenVideoArtifact,
};
