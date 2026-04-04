//backend/routes/passportRoutes.js

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");
const { parse } = require("mrz");

const router = express.Router();

const upload = multer({
  dest: "backend/uploads/",
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post("/parse", upload.array("files", 100), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    const results = [];

    for (const file of files) {
      let processedPaths = [];
      let debugOcr = [];

      try {
        const variants = await buildMrzVariants(file.path);
        processedPaths = variants.map((v) => v.path);

        let mrzLines = null;
        let matchedVariant = null;

        for (const variant of variants) {
          const ocrText = await readMrzText(variant.path);
          debugOcr.push({
            variant: variant.label,
            text: ocrText.slice(0, 500),
          });

          const found = extractMrzLines(ocrText);

          if (found) {
            mrzLines = found;
            matchedVariant = variant.label;
            break;
          }
        }

        if (!mrzLines) {
          results.push({
            fileName: file.originalname,
            success: false,
            message: "MRZ not detected",
            debug: debugOcr,
          });
          cleanupProcessed(processedPaths);
          safeUnlink(file.path);
          continue;
        }

        const parsed = parse(mrzLines);

        if (!parsed || !parsed.valid || !parsed.fields) {
          results.push({
            fileName: file.originalname,
            success: false,
            message: "MRZ parsed but not valid",
            rawMrz: mrzLines,
            variant: matchedVariant || null,
            debug: debugOcr,
          });
          cleanupProcessed(processedPaths);
          safeUnlink(file.path);
          continue;
        }

        const row = formatForYourTable(parsed.fields, file.originalname, mrzLines);

        results.push({
          fileName: file.originalname,
          success: true,
          source: "MRZ",
          variant: matchedVariant || null,
          row,
        });

        cleanupProcessed(processedPaths);
        safeUnlink(file.path);
      } catch (err) {
        results.push({
          fileName: file.originalname,
          success: false,
          message: err.message || "Failed to process file",
          debug: debugOcr,
        });
        cleanupProcessed(processedPaths);
        safeUnlink(file.path);
      }
    }

    return res.json({ success: true, data: results });
  } catch (err) {
    console.error("[passport/parse] error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

async function buildMrzVariants(filePath) {
  const meta = await sharp(filePath).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;

  if (!width || !height) {
    throw new Error("Cannot read image metadata");
  }

  const cropSpecs = [
    { label: "bottom_45", topRatio: 0.55, heightRatio: 0.45 },
    { label: "bottom_40", topRatio: 0.60, heightRatio: 0.40 },
    { label: "bottom_35", topRatio: 0.65, heightRatio: 0.35 },
    { label: "bottom_30", topRatio: 0.70, heightRatio: 0.30 },
  ];

  const rotations = [-7, -4, 0, 4, 7];
  const out = [];

  for (const cropSpec of cropSpecs) {
    const top = Math.max(0, Math.floor(height * cropSpec.topRatio));
    const cropHeight = Math.min(height - top, Math.floor(height * cropSpec.heightRatio));

    if (cropHeight < 60) continue;

    for (const angle of rotations) {
      const outPath = `${filePath}-${cropSpec.label}-rot${String(angle).replace("-", "m")}.png`;

      await sharp(filePath)
        .extract({
          left: 0,
          top,
          width,
          height: cropHeight,
        })
        .rotate(angle, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .resize({ width: Math.max(width * 2, 1200) })
        .grayscale()
        .normalize()
        .sharpen()
        .threshold(170)
        .toFile(outPath);

      out.push({
        label: `${cropSpec.label}_rot_${angle}`,
        path: outPath,
      });
    }
  }

  return out;
}

async function readMrzText(filePath) {
  const { data } = await Tesseract.recognize(filePath, "eng", {
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
    preserve_interword_spaces: "1",
  });

  return (data?.text || "").toUpperCase();
}

function extractMrzLines(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, "").trim())
    .filter(Boolean);

  const mrzCandidates = lines.filter(
    (line) =>
      line.length >= 25 &&
      /^[A-Z0-9<]+$/.test(line) &&
      (line.startsWith("P<") || line.includes("<<"))
  );

  if (mrzCandidates.length >= 2) {
    return mrzCandidates.slice(-2).map(normalizeMrzLineTD3);
  }

  if (mrzCandidates.length === 1) {
    const single = mrzCandidates[0];
    const firstP = single.indexOf("P<");

    if (firstP > 0) {
      const maybeLine2 = single.slice(0, firstP);
      const maybeLine1 = single.slice(firstP);

      if (maybeLine1.length >= 25 && maybeLine2.length >= 25) {
        return [normalizeMrzLineTD3(maybeLine1), normalizeMrzLineTD3(maybeLine2)];
      }
    }
  }

  return null;
}

function normalizeMrzLineTD3(line) {
  if (line.length > 44) return line.slice(0, 44);
  if (line.length < 44) return line.padEnd(44, "<");
  return line;
}

function formatForYourTable(fields, fileName, rawMrz) {
  const sex = normalizeSex(fields.sex);
  const birthDate = formatMrzDate(fields.birthDate);
  const expiryDate = formatMrzDate(fields.expirationDate);

  return {
    TYPE: "Adult",
    TITLE: sex === "Female" ? "MRS" : "MR",
    FIRST_NAME: cleanName(fields.givenNames),
    LAST_NAME: cleanName(fields.surname),
    DOB: birthDate,
    GENDER: sex,
    CITIZENSHIP: fields.nationality || "TJ",
    DOCUMENT_TYPE: "Passport no",
    DOCUMENT_NUMBER: fields.documentNumber || "",
    DOCUMENT_ISSUE_COUNTRY: fields.issuingState || "TJ",
    NATIONALITY: fields.nationality || "TJ",
    ISSUE_DATE: "",
    EXPIRY_DATE: expiryDate,
    _meta: {
      fileName,
      rawMrz,
    },
  };
}

function cleanName(value) {
  return String(value || "")
    .replace(/</g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSex(value) {
  if (value === "F") return "Female";
  if (value === "M") return "Male";
  return "";
}

function formatMrzDate(value) {
  const v = String(value || "").trim();
  if (!/^\d{6}$/.test(v)) return "";

  const yy = Number(v.slice(0, 2));
  const mm = v.slice(2, 4);
  const dd = v.slice(4, 6);

  const currentYY = Number(new Date().getFullYear().toString().slice(-2));
  const fullYear = yy <= currentYY + 10 ? 2000 + yy : 1900 + yy;

  return `${dd}.${mm}.${fullYear}`;
}

function cleanupProcessed(paths) {
  for (const p of paths || []) {
    safeUnlink(p);
  }
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.warn("[passport/parse] failed to delete temp file:", e.message);
  }
}

module.exports = router;
