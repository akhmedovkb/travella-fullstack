// backend/utils/cloudinary.js
/* eslint-disable no-console */

const path = require("path");
const { Readable } = require("stream");

let cloudinary = null;

function hasCloudinaryConfig() {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function getCloudinary() {
  if (!hasCloudinaryConfig()) return null;
  if (cloudinary) return cloudinary;

  // Lazy require: backend can still boot if package was not installed yet,
  // but upload endpoint will return a clear config/dependency error.
  try {
    cloudinary = require("cloudinary").v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    return cloudinary;
  } catch (e) {
    console.error("[cloudinary] package/config error:", e?.message || e);
    return null;
  }
}

function getResourceType(mimetype = "") {
  const m = String(mimetype || "").toLowerCase();
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  return "auto";
}

function safePublicPart(name = "file") {
  const base = path.basename(String(name || "file"), path.extname(String(name || "")));
  return base
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "file";
}

function uploadBufferToCloudinary(file, options = {}) {
  const cld = getCloudinary();
  if (!cld) {
    const err = new Error("cloudinary_not_configured");
    err.code = "cloudinary_not_configured";
    throw err;
  }

  const folder = options.folder || process.env.CLOUDINARY_HOTEL_REVIEWS_FOLDER || "travella/hotel-reviews";
  const resourceType = options.resource_type || getResourceType(file?.mimetype);
  const publicPrefix = options.public_prefix || safePublicPart(file?.originalname || "review-media");

  return new Promise((resolve, reject) => {
    const stream = cld.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        public_id: `${publicPrefix}-${Date.now()}`,
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          url: result.secure_url || result.url,
          public_id: result.public_id,
          resource_type: result.resource_type || resourceType,
          width: result.width || null,
          height: result.height || null,
          duration_seconds: result.duration || null,
          thumbnail_url:
            result.resource_type === "video"
              ? cld.url(result.public_id, {
                  resource_type: "video",
                  format: "jpg",
                  secure: true,
                  transformation: [{ width: 800, crop: "limit" }],
                })
              : (result.secure_url || result.url),
        });
      }
    );

    Readable.from(file.buffer).pipe(stream);
  });
}

module.exports = {
  hasCloudinaryConfig,
  uploadBufferToCloudinary,
};
