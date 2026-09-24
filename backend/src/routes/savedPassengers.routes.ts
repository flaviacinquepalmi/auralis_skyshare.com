import { Router } from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { requireAuth } from "../middleware/auth.middleware";
import { syncAuth0User } from "../middleware/syncUser.middleware";
import { env } from "../config/env";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });
export const savedPassengersRouter = Router();
savedPassengersRouter.use(requireAuth, syncAuth0User);

function clean(body: any) {
  return {
    label: String(body?.label || "").trim(),
    firstName: String(body?.firstName || "").trim(),
    lastName: String(body?.lastName || "").trim(),
    email: String(body?.email || "").trim() || null,
    phone: String(body?.phone || "").trim() || null,
  };
}

savedPassengersRouter.get("/", async (req, res, next) => {
  try {
    const data = await prisma.savedPassenger.findMany({
      where: { userId: req.dbUser!.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    res.json({ data });
  } catch (error) { next(error); }
});

savedPassengersRouter.post("/", async (req, res, next) => {
  try {
    const input = clean(req.body);
    if (!input.firstName || !input.lastName) return res.status(400).json({ error: "Nome e cognome sono obbligatori." });
    const last = await prisma.savedPassenger.findFirst({ where: { userId: req.dbUser!.id }, orderBy: { position: "desc" } });
    const position = (last?.position || 0) + 1;
    const data = await prisma.savedPassenger.create({
      data: { userId: req.dbUser!.id, position, label: input.label || `Passeggero ${position}`, firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone },
    });
    res.status(201).json({ data });
  } catch (error) { next(error); }
});

savedPassengersRouter.patch("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.savedPassenger.findFirst({ where: { id: req.params.id, userId: req.dbUser!.id } });
    if (!existing) return res.status(404).json({ error: "Passeggero non trovato." });
    const input = clean(req.body);
    if (!input.firstName || !input.lastName) return res.status(400).json({ error: "Nome e cognome sono obbligatori." });
    const data = await prisma.savedPassenger.update({
      where: { id: existing.id },
      data: { label: input.label || existing.label, firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone },
    });
    res.json({ data });
  } catch (error) { next(error); }
});

savedPassengersRouter.delete("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.savedPassenger.findFirst({ where: { id: req.params.id, userId: req.dbUser!.id } });
    if (!existing) return res.status(404).json({ error: "Passeggero non trovato." });
    await prisma.savedPassenger.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (error) { next(error); }
});
