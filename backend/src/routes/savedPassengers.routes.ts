import { Router } from "express";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { requireAuth } from "../middleware/auth.middleware";
import { syncAuth0User } from "../middleware/syncUser.middleware";
import { env } from "../config/env";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });
export const savedPassengersRouter = Router();
savedPassengersRouter.use(requireAuth, syncAuth0User);
const inputSchema = z.object({
  label: z.string().trim().max(100).optional().default(""),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
});
const normalize = (value: string | null | undefined) => (value || "").trim().toLowerCase();

savedPassengersRouter.get("/", async (req, res, next) => {
  try {
    const data = await prisma.savedPassenger.findMany({ where: { userId: req.dbUser!.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
    res.json({ data });
  } catch (error) { next(error); }
});

async function savePassenger(userId: string, body: unknown, id?: string) {
  const input = inputSchema.parse(body);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`passengers:${userId}`}))`;
    const contacts = await tx.savedPassenger.findMany({ where: { userId } });
    const existing = id ? contacts.find(contact => contact.id === id) : undefined;
    if (id && !existing) throw Object.assign(new Error("Passeggero non trovato"), { status: 404 });
    const duplicate = contacts.find(contact => contact.id !== id && normalize(contact.firstName) === normalize(input.firstName)
      && normalize(contact.lastName) === normalize(input.lastName) && normalize(contact.email) === normalize(input.email));
    if (duplicate) throw Object.assign(new Error("Questo passeggero è già presente nella rubrica"), { status: 409 });
    const position = existing?.position || Math.max(0, ...contacts.map(contact => contact.position)) + 1;
    const data = { label: input.label || existing?.label || `Passeggero ${position}`, firstName: input.firstName,
      lastName: input.lastName, email: normalize(input.email) || null, phone: input.phone || null };
    return existing
      ? tx.savedPassenger.update({ where: { id: existing.id }, data })
      : tx.savedPassenger.create({ data: { ...data, userId, position } });
  });
}

savedPassengersRouter.post("/", async (req, res, next) => {
  try { res.status(201).json({ data: await savePassenger(req.dbUser!.id, req.body) }); }
  catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Dati passeggero non validi" });
    next(error);
  }
});
savedPassengersRouter.patch("/:id", async (req, res, next) => {
  try { res.json({ data: await savePassenger(req.dbUser!.id, req.body, String(req.params.id)) }); }
  catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Dati passeggero non validi" });
    next(error);
  }
});
savedPassengersRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await prisma.savedPassenger.deleteMany({ where: { id: String(req.params.id), userId: req.dbUser!.id } });
    if (!deleted.count) return res.status(404).json({ error: "Passeggero non trovato." });
    res.status(204).end();
  } catch (error) { next(error); }
});
