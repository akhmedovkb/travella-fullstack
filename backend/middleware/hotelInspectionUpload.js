const multer = require("multer");

module.exports = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 13,
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (req, file, callback) => {
    const mimetype = String(file.mimetype || "").toLowerCase();
    if (mimetype.startsWith("image/") || mimetype.startsWith("video/")) {
      return callback(null, true);
    }
    return callback(new Error("unsupported_media_type"));
  },
}).array("files", 13);
