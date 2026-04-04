//backend/routes/passportRoutes.js

const express = require("express");
const router = express.Router();
const multer = require("multer");
const Tesseract = require("tesseract.js");
const { parse } = require("mrz");
const vision = require("@google-cloud/vision");

const upload = multer({ dest: "uploads/" });
const client = new vision.ImageAnnotatorClient();

router.post("/parse", upload.array("files"), async (req, res) => {
  try {
    const results = [];

    for (const file of req.files) {
      let parsed = null;

      // =========================
      // 1. MRZ (БЫСТРО + БЕСПЛАТНО)
      // =========================
      try {
        const { data: { text } } = await Tesseract.recognize(
          file.path,
          "ocrb",
          {
            tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
          }
        );

        const mrzText = extractMRZ(text);

        if (mrzText) {
          const result = parse(mrzText);

          if (result.valid) {
            parsed = formatMRZ(result.fields);
          }
        }
      } catch (e) {
        console.log("MRZ fail:", e.message);
      }

      // =========================
      // 2. FALLBACK → GOOGLE VISION
      // =========================
      if (!parsed) {
        try {
          const [result] = await client.textDetection(file.path);
          const text = result.fullTextAnnotation?.text || "";

          parsed = formatVision(text);
        } catch (e) {
          console.log("Vision fail:", e.message);
        }
      }

      results.push(parsed || { error: "Cannot parse passport" });
    }

    res.json({ success: true, data: results });

  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false });
  }
});

// =========================
// MRZ FUNCTIONS
// =========================

function extractMRZ(text) {
  const lines = text.split("\n").map(l => l.trim());

  const mrzLines = lines.filter(l => l.includes("<<") && l.length > 30);

  if (mrzLines.length >= 2) {
    return mrzLines.slice(-2);
  }

  return null;
}

function formatMRZ(f) {
  return {
    TYPE: "Adult",
    TITLE: f.sex === "M" ? "MR" : "MRS",
    FIRST_NAME: f.givenNames,
    LAST_NAME: f.surname,
    DOB: formatDate(f.birthDate),
    GENDER: f.sex === "M" ? "Male" : "Female",
    CITIZENSHIP: "TJ",
    DOCUMENT_TYPE: "Passport no",
    DOCUMENT_NUMBER: f.documentNumber,
    DOCUMENT_ISSUE_COUNTRY: "TJ",
    NATIONALITY: "TJ",
    ISSUE_DATE: "",
    EXPIRY_DATE: formatDate(f.expirationDate),
    SOURCE: "MRZ"
  };
}

// =========================
// GOOGLE VISION PARSER
// =========================

function formatVision(text) {
  const nameMatch = text.match(/Surname[:\s]+([A-Z]+)/i);
  const firstMatch = text.match(/Given Names[:\s]+([A-Z]+)/i);

  const passport = text.match(/[A-Z]{2}\d{6,7}/)?.[0] || "";
  const dates = text.match(/\d{2}\.\d{2}\.\d{4}/g) || [];

  return {
    TYPE: "Adult",
    TITLE: "MR",
    FIRST_NAME: firstMatch?.[1] || "",
    LAST_NAME: nameMatch?.[1] || "",
    DOB: dates[0] || "",
    GENDER: text.includes("F") ? "Female" : "Male",
    CITIZENSHIP: "TJ",
    DOCUMENT_TYPE: "Passport no",
    DOCUMENT_NUMBER: passport,
    DOCUMENT_ISSUE_COUNTRY: "TJ",
    NATIONALITY: "TJ",
    ISSUE_DATE: dates[1] || "",
    EXPIRY_DATE: dates[2] || "",
    SOURCE: "VISION"
  };
}

// =========================

function formatDate(dateStr) {
  if (!dateStr) return "";

  const year = "20" + dateStr.slice(0, 2);
  const month = dateStr.slice(2, 4);
  const day = dateStr.slice(4, 6);

  return `${day}.${month}.${year}`;
}

module.exports = router;
