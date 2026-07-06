import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware";
import { syncAuth0User } from "../middleware/syncUser.middleware";

export const meRouter = Router();

meRouter.get("/", requireAuth, syncAuth0User, (req, res) => {
  res.json({ user: req.dbUser });
});