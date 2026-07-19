const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
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
  };
}

function getToneForEffect(assetId = "") {
  const id = String(assetId || "").toLowerCase();
  if (id.includes("sparkle") || id.includes("chime")) return { frequency: 1320, duration: 0.34 };
  if (id.includes("impact") || id.includes("price")) return { frequency: 150, duration: 0.26 };
  if (id.includes("click") || id.includes("tap")) return { frequency: 980, duration: 0.08 };
  if (id.includes("urgency")) return { frequency: 520, duration: 0.24 };
  return { frequency: 720, duration: 0.18 };
}

function buildFfmpegArgs({ inputPath, outputPath, soundPlan = {} }) {
  const musicVolume = Math.max(0, Math.min(0.35, safeNumber(soundPlan.music?.volume, 0.1)));
  const effects = (Array.isArray(soundPlan.effects) ? soundPlan.effects : []).slice(0, 8).map(normalizeEffect);
  const args = ["-y", "-i", inputPath];
  const filterParts = [];
  const audioLabels = ["[0:a]"];

  if (musicVolume > 0) {
    args.push("-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.16:sample_rate=44100");
    filterParts.push(`[1:a]volume=${musicVolume},highpass=f=120,lowpass=f=4200[music]`);
    audioLabels.push("[music]");
  }

  effects.forEach((effect, index) => {
    const tone = getToneForEffect(effect.assetId);
    const inputIndex = args.filter((item) => item === "-i").length;
    args.push("-f", "lavfi", "-i", `sine=frequency=${tone.frequency}:duration=${tone.duration}:sample_rate=44100`);
    const delay = Math.round(effect.time * 1000);
    const volume = Math.max(0, Math.min(0.8, effect.volume));
    const label = `sfx${index}`;
    filterParts.push(`[${inputIndex}:a]volume=${volume},adelay=${delay}|${delay}[${label}]`);
    audioLabels.push(`[${label}]`);
  });

  const inputCount = audioLabels.length;
  filterParts.push(`${audioLabels.join("")}amix=inputs=${inputCount}:duration=first:dropout_transition=0,volume=1.0[aout]`);
  args.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
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
    const args = buildFfmpegArgs({ inputPath, outputPath, soundPlan: output.soundPlan });
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
