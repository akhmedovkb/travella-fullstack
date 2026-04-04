//backend/routes/passportRoutes.js

const express = require("express");
const multer = require("multer");
const fs = require("fs");
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
      try {
        const ocrText = await readMrzText(file.path);
        const mrzLines = extractMrzLines(ocrText);

        if (!mrzLines) {
          results.push({
            fileName: file.originalname,
            success: false,
            message: "MRZ not detected",
          });
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
          });
          safeUnlink(file.path);
          continue;
        }

        const row = formatForYourTable(parsed.fields, file.originalname, mrzLines);

        results.push({
          fileName: file.originalname,
          success: true,
          source: "MRZ",
          row,
        });

        safeUnlink(file.path);
      } catch (err) {
        results.push({
          fileName: file.originalname,
          success: false,
          message: err.message || "Failed to process file",
        });
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
      line.length >= 40 &&
      /^[A-Z0-9<]+$/.test(line) &&
      (line.startsWith("P<") || line.includes("<<"))
  );

  if (mrzCandidates.length >= 2) {
    const lastTwo = mrzCandidates.slice(-2).map(normalizeMrzLineTD3);
    return lastTwo;
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
