import { Router } from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { requireAuth } from "../middleware/auth.middleware";
import { syncAuth0User } from "../middleware/syncUser.middleware";
import { env } from "../config/env";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });

export const meRouter = Router();

meRouter.get("/", requireAuth, syncAuth0User, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.dbUser!.id } });
    res.json({ user });
  } catch (error) { next(error); }
});

meRouter.patch("/", requireAuth, syncAuth0User, async (req, res, next) => {
  try {
    const firstName = String(req.body?.firstName || "").trim() || null;
    const lastName = String(req.body?.lastName || "").trim() || null;
    const phone = String(req.body?.phone || "").trim() || null;
    const preferredAirport = String(req.body?.preferredAirport || "").trim().toUpperCase() || null;
    const language = ["it", "en", "fr"].includes(req.body?.language) ? req.body.language : "it";

    const user = await prisma.user.update({
      where: { id: req.dbUser!.id },
      data: { firstName, lastName, phone, preferredAirport, language },
    });
    res.json({ user });
  } catch (error) { next(error); }
});
