// backend/routes/socialRoutes.js
const express = require("express");
const multer = require("multer");
const authenticateToken = require("../middleware/authenticateToken");
const social = require("../controllers/socialController");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 80 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mt = String(file.mimetype || "").toLowerCase();
    if (mt.startsWith("image/") || mt.startsWith("video/")) return cb(null, true);
    return cb(new Error("unsupported_media_type"));
  },
});

function tryAuth(req, res, next) {
  const hdr = req.headers?.authorization || "";
  if (!hdr) return next();
  authenticateToken(req, res, () => next());
}

router.get("/feed", tryAuth, social.listFeed);
router.get("/providers/:providerId/posts", tryAuth, social.listProviderPosts);
router.post("/posts", authenticateToken, upload.array("files", 10), social.createPost);
router.delete("/posts/:id", authenticateToken, social.deletePost);
router.post("/posts/:id/like", authenticateToken, social.toggleLike);
router.get("/posts/:id/comments", tryAuth, social.listComments);
router.post("/posts/:id/comments", authenticateToken, social.createComment);
router.get("/providers/:providerId/follow", authenticateToken, social.followStatus);
router.post("/providers/:providerId/follow", authenticateToken, social.toggleFollow);

module.exports = router;
