//backend/routes/donasMenuRoutes.js

import express from "express";
import {
  getMenuItems,
  createMenuItem,
  updateMenuItem,
  archiveMenuItem,
  getMenuItemRecipe,
  replaceMenuItemRecipe,
} from "../controllers/donasMenuController.js";

const router = express.Router();

router.get("/menu-items", getMenuItems);
router.post("/menu-items", createMenuItem);
router.put("/menu-items/:id", updateMenuItem);
router.delete("/menu-items/:id", archiveMenuItem);

router.get("/menu-items/:id/recipe", getMenuItemRecipe);
router.put("/menu-items/:id/recipe", replaceMenuItemRecipe);

export default router;
