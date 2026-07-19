const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const axios = require("axios");
const { downloadVideoBuffer, saveRenderedVideoArtifact } = require("./videoArtifactStore");

function optionalRequire(name, fallback = null) {
  try {
    return require(name);
  } catch {
    return fallback;
  }
}

function getFfmpegPath() {
  return process.env.FFMPEG_PATH || optionalRequire("ffmpeg-static", "");
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeEffect(effect = {}, index = 0) {
  return {
    assetId: String(effect.assetId || "soft_whoosh_01").trim(),
    label: String(effect.label || effect.assetId || `SFX ${index + 1}`).trim(),
    time: Math.max(0, safeNumber(effect.time, 0)),
    volume: Math.max(0, Math.min(0.8, safeNumber(effect.volume, 0.2))),
    enabled: effect.enabled === false ? false : true,
  };
}

function clampNumber(value, min, max, fallback) {
  return Math.max(min, Math.min(max, safeNumber(value, fallback)));
}

function normalizeTextOverlay(item = {}, index = 0) {
  return {
    id: String(item.id || `text_${index}`).trim(),
    label: String(item.label || item.text || `Text ${index + 1}`).trim(),
    text: String(item.text || item.label || "").trim(),
    time: Math.max(0, safeNumber(item.time, 0)),
    duration: clampNumber(item.duration, 0.1, 120, 3),
    x: clampNumber(item.x, 0, 100, 50),
    y: clampNumber(item.y, 0, 100, 78),
    fontSize: clampNumber(item.fontSize, 10, 96, 22),
    scale: clampNumber(item.scale, 0.2, 4, 1),
    enabled: item.enabled === false ? false : true,
  };
}

function normalizeImageOverlay(item = {}, index = 0) {
  return {
    id: String(item.id || `image_${index}`).trim(),
    label: String(item.label || `Sticker ${index + 1}`).trim(),
    url: String(item.url || "").trim(),
    time: Math.max(0, safeNumber(item.time, 0)),
    duration: clampNumber(item.duration, 0.1, 120, 4),
    x: clampNumber(item.x, 0, 100, 50),
    y: clampNumber(item.y, 0, 100, 72),
    width: clampNumber(item.width, 4, 95, 34),
    scale: clampNumber(item.scale, 0.2, 4, 1),
    enabled: item.enabled === false ? false : true,
  };
}

function escapeDrawtext(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\n/g, "\\n");
}

function getToneForEffect(assetId = "") {
  const id = String(assetId || "").toLowerCase();
  if (id.includes("sparkle") || id.includes("chime")) return { frequency: 1320, duration: 0.34 };
  if (id.includes("cash")) return { frequency: 1180, duration: 0.12 };
  if (id.includes("pop") || id.includes("deal")) return { frequency: 860, duration: 0.16 };
  if (id.includes("riser") || id.includes("countdown")) return { frequency: 410, duration: 0.42 };
  if (id.includes("impact") || id.includes("price")) return { frequency: 150, duration: 0.26 };
  if (id.includes("click") || id.includes("tap")) return { frequency: 980, duration: 0.08 };
  if (id.includes("urgency")) return { frequency: 520, duration: 0.24 };
  return { frequency: 720, duration: 0.18 };
}

function buildFfmpegArgs({ inputPath, outputPath, soundPlan = {}, imageInputs = [] }) {
  const musicVolume = Math.max(0, Math.min(0.5, safeNumber(soundPlan.music?.volume, 0.1) * 1.4));
  const effects = (Array.isArray(soundPlan.effects) ? soundPlan.effects : [])
    .slice(0, 8)
    .map(normalizeEffect)
    .filter((effect) => effect.enabled !== false && effect.volume > 0);
  const textOverlays = (Array.isArray(soundPlan.textOverlays) ? soundPlan.textOverlays : [])
    .slice(0, 12)
    .map(normalizeTextOverlay)
    .filter((item) => item.enabled !== false && item.text);
  const stickerLabels = (Array.isArray(soundPlan.imageOverlays) ? soundPlan.imageOverlays : [])
    .slice(0, 12)
    .map(normalizeImageOverlay)
    .filter((item) => item.enabled !== false && !item.url && item.label);
  const args = ["-y", "-i", inputPath];
  const filterParts = [];
  const audioLabels = ["[0:a]"];
  let nextInputIndex = 1;

  if (musicVolume > 0) {
    args.push("-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.16:sample_rate=44100");
    const inputIndex = nextInputIndex;
    nextInputIndex += 1;
    filterParts.push(`[${inputIndex}:a]volume=${musicVolume},highpass=f=120,lowpass=f=4200[music]`);
    audioLabels.push("[music]");
  }

  effects.forEach((effect, index) => {
    const tone = getToneForEffect(effect.assetId);
    const inputIndex = nextInputIndex;
    nextInputIndex += 1;
    args.push("-f", "lavfi", "-i", `sine=frequency=${tone.frequency}:duration=${tone.duration}:sample_rate=44100`);
    const delay = Math.round(effect.time * 1000);
    const volume = Math.max(0, Math.min(1.2, effect.volume * 2.8));
    const label = `sfx${index}`;
    filterParts.push(`[${inputIndex}:a]volume=${volume},afade=t=in:st=0:d=0.02,afade=t=out:st=${Math.max(0.01, tone.duration - 0.08)}:d=0.08,adelay=${delay}|${delay}[${label}]`);
    audioLabels.push(`[${label}]`);
  });

  imageInputs.forEach((item) => {
    item.inputIndex = nextInputIndex;
    nextInputIndex += 1;
    args.push("-loop", "1", "-i", item.path);
  });

  let videoLabel = "[0:v]";
  let hasVideoFilters = false;

  textOverlays.forEach((item, index) => {
    const out = `[vtext${index}]`;
    const enable = `between(t\\,${item.time}\\,${item.time + item.duration})`;
    const fontSize = Math.round(item.fontSize * item.scale);
    filterParts.push(`${videoLabel}drawtext=text='${escapeDrawtext(item.text)}':x=(w-text_w)*${item.x / 100}:y=(h-text_h)*${item.y / 100}:fontsize=${fontSize}:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=14:enable='${enable}'${out}`);
    videoLabel = out;
    hasVideoFilters = true;
  });

  stickerLabels.forEach((item, index) => {
    const boxOut = `[vstickerbox${index}]`;
    const textOut = `[vsticker${index}]`;
    const enable = `between(t\\,${item.time}\\,${item.time + item.duration})`;
    const boxW = Math.round(item.width * item.scale);
    const boxH = Math.max(8, Math.round(boxW * 0.32));
    filterParts.push(`${videoLabel}drawbox=x=w*${item.x / 100}-w*${boxW / 200}:y=h*${item.y / 100}-h*${boxH / 200}:w=w*${boxW / 100}:h=h*${boxH / 100}:color=purple@0.75:t=fill:enable='${enable}'${boxOut}`);
    filterParts.push(`${boxOut}drawtext=text='${escapeDrawtext(item.label)}':x=(w-text_w)*${item.x / 100}:y=(h-text_h)*${item.y / 100}:fontsize=28:fontcolor=white:enable='${enable}'${textOut}`);
    videoLabel = textOut;
    hasVideoFilters = true;
  });

  imageInputs.forEach((item, index) => {
    const normalized = normalizeImageOverlay(item.overlay, index);
    const scaled = `[img${index}]`;
    const out = `[vimg${index}]`;
    const targetWidth = Math.round(360 * (normalized.width / 34) * normalized.scale);
    const enable = `between(t\\,${normalized.time}\\,${normalized.time + normalized.duration})`;
    filterParts.push(`[${item.inputIndex}:v]scale=${targetWidth}:-1${scaled}`);
    filterParts.push(`${videoLabel}${scaled}overlay=x=(main_w-overlay_w)*${normalized.x / 100}:y=(main_h-overlay_h)*${normalized.y / 100}:enable='${enable}'${out}`);
    videoLabel = out;
    hasVideoFilters = true;
  });

  const inputCount = audioLabels.length;
  filterParts.push(`${audioLabels.join("")}amix=inputs=${inputCount}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`);
  args.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    hasVideoFilters ? videoLabel : "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    hasVideoFilters ? "libx264" : "copy",
    ...(hasVideoFilters ? ["-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "22"] : []),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath
  );
  return args;
}

function runFfmpeg(args, timeoutMs = 180000) {
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath) {
    const err = new Error("ffmpeg_not_configured");
    err.code = "ffmpeg_not_configured";
    throw err;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const err = new Error("ffmpeg_render_timeout");
      err.code = "ffmpeg_render_timeout";
      err.stderr = stderr.slice(-2000);
      reject(err);
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stderr });
      const err = new Error(`ffmpeg_failed_${code}`);
      err.code = "ffmpeg_failed";
      err.stderr = stderr.slice(-4000);
      reject(err);
    });
  });
}

async function prepareImageInputs(soundPlan = {}, tempDir) {
  const overlays = (Array.isArray(soundPlan.imageOverlays) ? soundPlan.imageOverlays : [])
    .slice(0, 12)
    .map(normalizeImageOverlay)
    .filter((item) => item.enabled !== false && item.url);
  const inputs = [];

  for (let index = 0; index < overlays.length; index += 1) {
    const overlay = overlays[index];
    try {
      const response = await axios.get(overlay.url, {
        responseType: "arraybuffer",
        timeout: 30000,
        maxContentLength: 20 * 1024 * 1024,
        maxBodyLength: 20 * 1024 * 1024,
      });
      const contentType = String(response.headers?.["content-type"] || "").toLowerCase();
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const filePath = path.join(tempDir, `overlay-${index}.${ext}`);
      await fs.writeFile(filePath, Buffer.from(response.data));
      inputs.push({ path: filePath, overlay });
    } catch {
      // If an external sticker cannot be fetched, render worker keeps the video renderable.
    }
  }

  return inputs;
}

async function renderSoundPlanToArtifact({ job, output = {} }) {
  const heygen = output.heygen || {};
  const sourceUrl = heygen.artifact?.url || heygen.videoUrl || "";
  if (!sourceUrl) {
    const err = new Error("active_video_required");
    err.code = "active_video_required";
    throw err;
  }
  if (!output.soundPlan?.effects?.length && !output.soundPlan?.music) {
    const err = new Error("sound_plan_required");
    err.code = "sound_plan_required";
    throw err;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "travella-sound-"));
  const inputPath = path.join(tempDir, "input.mp4");
  const outputPath = path.join(tempDir, "output.mp4");
  try {
    const downloaded = await downloadVideoBuffer(sourceUrl);
    await fs.writeFile(inputPath, downloaded.buffer);
    const imageInputs = await prepareImageInputs(output.soundPlan, tempDir);
    const args = buildFfmpegArgs({ inputPath, outputPath, soundPlan: output.soundPlan, imageInputs });
    await runFfmpeg(args);
    const renderedBuffer = await fs.readFile(outputPath);
    return saveRenderedVideoArtifact({
      jobId: job.id,
      videoId: heygen.videoId || job.id,
      buffer: renderedBuffer,
      serviceCode: output.service?.code || output.service?.videoContext?.code || "",
      suffix: `sound-v${heygen.version || 1}`,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  buildFfmpegArgs,
  renderSoundPlanToArtifact,
};
