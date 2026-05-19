//backend/routes/hotelInspectionRoutes.js

const router =
  require("express").Router();

const authenticateToken =
  require(
    "../middleware/authenticateToken"
  );

const {
  upload,

  createInspection,

  listInspections,

  likeInspection,

} = require(
  "../controllers/hotelInspectionController"
);

function tryAuth(
  req,
  res,
  next
) {
  const hdr =
    req.headers
      ?.authorization;

  if (!hdr)
    return next();

  authenticateToken(
    req,
    res,
    next
  );
}

router.get(
  "/hotel/:hotelId",

  listInspections
);

router.post(
  "/hotel/:hotelId",

  tryAuth,

  upload.array(
    "files",
    80
  ),

  createInspection
);

router.post(
  "/:inspectionId/like",

  tryAuth,

  likeInspection
);

module.exports =
  router;
