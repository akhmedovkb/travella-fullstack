// backend/utils/r2Upload.js
/* eslint-disable no-console */

const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

let r2Client = null;

function cleanSlash(v = "") {
  return String(v || "").replace(/\/+$/, "");
}

function hasR2Config() {
  return !!(
    process.env.R2_BUCKET &&
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
  );
}

function getR2Client() {
  if (!hasR2Config()) {
    const err = new Error("r2_not_configured");
    err.code = "r2_not_configured";
    throw err;
  }

  if (r2Client) return r2Client;

  r2Client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  return r2Client;
}

function safePublicPart(name = "file") {
  const base = path.basename(String(name || "file"), path.extname(String(name || "")));
  return base
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "file";
}

function safeExt(file = {}) {
  const ext = path.extname(String(file.originalname || "")).toLowerCase();
  if (ext && ext.length <= 12 && /^[.a-z0-9]+$/.test(ext)) return ext;

  const mimetype = String(file.mimetype || "").toLowerCase();
  if (mimetype === "image/jpeg") return ".jpg";
  if (mimetype === "image/png") return ".png";
  if (mimetype === "image/webp") return ".webp";
  if (mimetype === "image/gif") return ".gif";
  if (mimetype === "video/mp4") return ".mp4";
  if (mimetype === "video/quicktime") return ".mov";
  return "";
}

function inferMediaType(file = {}) {
  const mimetype = String(file.mimetype || "").toLowerCase();
  if (mimetype.startsWith("video/")) return "video";
  return "photo";
}

function getBackendPublicBase() {
  return cleanSlash(
    process.env.SITE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.BACKEND_URL ||
    process.env.TG_IMAGE_BASE ||
    process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` ||
    ""
  );
}

function buildPublicUrl(key) {
  const encodedKey = encodeURIComponent(key);
  const r2Public = cleanSlash(process.env.R2_PUBLIC_URL || "");

  if (r2Public) return `${r2Public}/${key}`;

  const backendBase = getBackendPublicBase();
  if (backendBase) return `${backendBase}/api/hotels/media/${encodedKey}`;

  // Last-resort relative URL. Works when frontend and backend share the same origin/proxy.
  return `/api/hotels/media/${encodedKey}`;
}

function buildKey(file, options = {}) {
  const sectionPrefix = String(options.public_prefix || "hotel-review").replace(/[^a-zA-Z0-9/_-]+/g, "-");
  const folder = String(options.folder || process.env.R2_HOTEL_REVIEWS_FOLDER || "hotel-passport/reviews").replace(/^\/+|\/+$/g, "");
  const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  return `${folder}/${sectionPrefix}/${unique}-${safePublicPart(file?.originalname || "media")}${safeExt(file)}`;
}

async function uploadBufferToR2(file, options = {}) {
  const client = getR2Client();
  if (!file?.buffer?.length) {
    const err = new Error("empty_upload_file");
    err.code = "empty_upload_file";
    throw err;
  }

  const key = options.key || buildKey(file, options);
  const contentType = file.mimetype || "application/octet-stream";

  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: file.buffer,
    ContentType: contentType,
  }));

  const mediaType = inferMediaType(file);
  const url = buildPublicUrl(key);

  return {
    url,
    key,
    public_id: key,
    resource_type: mediaType === "video" ? "video" : "image",
    media_type: mediaType,
    width: null,
    height: null,
    duration_seconds: null,
    thumbnail_url: mediaType === "video" ? url : url,
  };
}

async function getR2ObjectStream(key) {
  const client = getR2Client();
  const cleanKey = decodeURIComponent(String(key || "")).replace(/^\/+/, "");
  if (!cleanKey || cleanKey.includes("..")) {
    const err = new Error("bad_r2_key");
    err.code = "bad_r2_key";
    throw err;
  }

  return client.send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: cleanKey,
  }));
}

module.exports = {
  hasR2Config,
  uploadBufferToR2,
  getR2ObjectStream,
};
