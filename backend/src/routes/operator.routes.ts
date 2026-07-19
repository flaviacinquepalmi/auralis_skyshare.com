import { Router } from "express";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth.middleware";
import { syncAuth0User } from "../middleware/syncUser.middleware";
import { requireRole } from "../middleware/requireRole.middleware";
import { sendAdminNewOperatorNotification } from "../services/email.service";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });

export const operatorRouter = Router();

operatorRouter.use(requireAuth, syncAuth0User);

// --- Profilo operatore ---

const profileSchema = z.object({
  companyName: z.string().min(1),
  vatNumber: z.string().optional(),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
});

operatorRouter.post("/profile", async (req, res, next) => {
  try {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dati non validi", details: parsed.error.flatten() });
    }

    const existing = await prisma.operator.findUnique({
      where: { userId: req.dbUser!.id },
    });

    const operator = existing
      ? await prisma.operator.update({
          where: { userId: req.dbUser!.id },
          data: parsed.data,
        })
      : await prisma.operator.create({
          data: { ...parsed.data, userId: req.dbUser!.id, status: "PENDING" },
        });

    if (!existing) {
      await prisma.user.update({
        where: { id: req.dbUser!.id },
        data: { role: "OPERATOR" },
      });

      await sendAdminNewOperatorNotification({
        companyName: parsed.data.companyName,
        contactEmail: parsed.data.contactEmail,
        userEmail: req.dbUser!.email,
      });
    }

    res.status(existing ? 200 : 201).json(operator);
  } catch (err) {
    next(err);
  }
});

operatorRouter.get("/profile", requireRole("OPERATOR"), async (req, res, next) => {
  try {
    const operator = await prisma.operator.findUnique({
      where: { userId: req.dbUser!.id },
    });
    if (!operator) {
      return res.status(404).json({ error: "Profilo operatore non trovato" });
    }
    res.json(operator);
  } catch (err) {
    next(err);
  }
});

// --- Aircraft ---

const aircraftSchema = z.object({
  manufacturer: z.string().min(1),
  model: z.string().min(1),
  registrationCode: z.string().optional(),
  maxPax: z.coerce.number().int().positive(),
});

async function getOwnOperatorOrFail(userId: string) {
  const operator = await prisma.operator.findUnique({ where: { userId } });
  return operator;
}

operatorRouter.post("/aircraft", requireRole("OPERATOR"), async (req, res, next) => {
  try {
    const operator = await getOwnOperatorOrFail(req.dbUser!.id);
    if (!operator) return res.status(404).json({ error: "Profilo operatore non trovato" });

    const parsed = aircraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dati non validi", details: parsed.error.flatten() });
    }

    const aircraft = await prisma.aircraft.create({
      data: { ...parsed.data, operatorId: operator.id },
    });
    res.status(201).json(aircraft);
  } catch (err) {
    next(err);
  }
});

operatorRouter.get("/aircraft", requireRole("OPERATOR"), async (req, res, next) => {
  try {
    const operator = await getOwnOperatorOrFail(req.dbUser!.id);
    if (!operator) return res.status(404).json({ error: "Profilo operatore non trovato" });

    const aircraft = await prisma.aircraft.findMany({ where: { operatorId: operator.id } });
    res.json({ data: aircraft });
  } catch (err) {
    next(err);
  }
});

operatorRouter.put("/aircraft/:id", requireRole("OPERATOR"), async (req, res, next) => {
  try {
    const operator = await getOwnOperatorOrFail(req.dbUser!.id);
    if (!operator) return res.status(404).json({ error: "Profilo operatore non trovato" });

    const existing = await prisma.aircraft.findFirst({
      where: { id: String(req.params.id), operatorId: operator.id },
    });
    if (!existing) return res.status(404).json({ error: "Aircraft non trovato" });

    const parsed = aircraftSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dati non validi", details: parsed.error.flatten() });
    }

    const updated = await prisma.aircraft.update({
      where: { id: existing.id },
      data: parsed.data,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

operatorRouter.delete("/aircraft/:id", requireRole("OPERATOR"), async (req, res, next) => {
  try {
    const operator = await getOwnOperatorOrFail(req.dbUser!.id);
    if (!operator) return res.status(404).json({ error: "Profilo operatore non trovato" });

    const existing = await prisma.aircraft.findFirst({
      where: { id: String(req.params.id), operatorId: operator.id },
    });
    if (!existing) return res.status(404).json({ error: "Aircraft non trovato" });

    await prisma.aircraft.delete({ where: { id: existing.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// --- Empty-legs ---

const emptyLegSchema = z.object({
  aircraftId: z.string().min(1),
  fromAirport: z.string().length(3),
  toAirport: z.string().length(3),
  fromCity: z.string().min(1).max(60).optional(),
  toCity: z.string().min(1).max(60).optional(),
  departureAt: z.string().datetime(),
  arrivalAt: z.string().datetime().optional(),
  durationMin: z.coerce.number().int().positive(),
  availablePax: z.coerce.number().int().positive(),
  priceTotal: z.coerce.number().positive(),
  currency: z.string().default("EUR"),
  savingPct: z.coerce.number().int().optional(),
  confirmationProbability: z.coerce.number().int().min(10).max(90).optional(),
});

operatorRouter.post("/empty-legs", requireRole("OPERATOR"), async (req, res, next) => {
  try {
    const operator = await getOwnOperatorOrFail(req.dbUser!.id);
    if (!operator) return res.status(404).json({ error: "Profilo operatore non trovato" });

    if (operator.status !== "APPROVED") {
      return res.status(403).json({ error: "Solo operatori approvati possono pubblicare voli" });
    }

    const parsed = emptyLegSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dati non validi", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const aircraft = await prisma.aircraft.findFirst({
      where: { id: data.aircraftId, operatorId: operator.id },
    });
    if (!aircraft) {
      return res.status(404).json({ error: "Aircraft non trovato o non tuo" });
    }

    const emptyLeg = await prisma.emptyLeg.create({
      data: {
        operatorId: operator.id,
        aircraftId: aircraft.id,
        fromAirport: data.fromAirport.toUpperCase(),
        toAirport: data.toAirport.toUpperCase(),
        fromCity: data.fromCity,
        toCity: data.toCity,
        departureAt: new Date(data.departureAt),
        arrivalAt: data.arrivalAt ? new Date(data.arrivalAt) : undefined,
        durationMin: data.durationMin,
        availablePax: data.availablePax,
        priceTotal: data.priceTotal,
        currency: data.currency,
        savingPct: data.savingPct,
        confirmationProbability: data.confirmationProbability,
        status: "PUBLISHED",
      },
    });

    res.status(201).json(emptyLeg);
  } catch (err) {
    next(err);
  }
});

operatorRouter.get("/empty-legs", requireRole("OPERATOR"), async (req, res, next) => {
  try {
    const operator = await getOwnOperatorOrFail(req.dbUser!.id);
    if (!operator) return res.status(404).json({ error: "Profilo operatore non trovato" });

    const legs = await prisma.emptyLeg.findMany({
      where: { operatorId: operator.id },
      orderBy: { departureAt: "desc" },
      include: { aircraft: true },
    });
    res.json({ data: legs });
  } catch (err) {
    next(err);
  }
});

operatorRouter.put("/empty-legs/:id", requireRole("OPERATOR"), async (req, res, next) => {
  try {
    const operator = await getOwnOperatorOrFail(req.dbUser!.id);
    if (!operator) return res.status(404).json({ error: "Profilo operatore non trovato" });

    const existing = await prisma.emptyLeg.findFirst({
      where: { id: String(req.params.id), operatorId: operator.id },
    });
    if (!existing) return res.status(404).json({ error: "Volo non trovato" });

    const parsed = emptyLegSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dati non validi", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const updated = await prisma.emptyLeg.update({
      where: { id: existing.id },
      data: {
        ...data,
        departureAt: data.departureAt ? new Date(data.departureAt) : undefined,
        arrivalAt: data.arrivalAt ? new Date(data.arrivalAt) : undefined,
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE diventa cancellazione "soft": status CANCELLED, non cancellazione fisica
operatorRouter.delete("/empty-legs/:id", requireRole("OPERATOR"), async (req, res, next) => {
  try {
    const operator = await getOwnOperatorOrFail(req.dbUser!.id);
    if (!operator) return res.status(404).json({ error: "Profilo operatore non trovato" });

    const existing = await prisma.emptyLeg.findFirst({
      where: { id: String(req.params.id), operatorId: operator.id },
    });
    if (!existing) return res.status(404).json({ error: "Volo non trovato" });

    const updated = await prisma.emptyLeg.update({
      where: { id: existing.id },
      data: { status: "CANCELLED" },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// --- Bookings sui propri voli ---

operatorRouter.get("/bookings", requireRole("OPERATOR"), async (req, res, next) => {
  try {
    const operator = await getOwnOperatorOrFail(req.dbUser!.id);
    if (!operator) return res.status(404).json({ error: "Profilo operatore non trovato" });

    const bookings = await prisma.booking.findMany({
      where: { emptyLeg: { operatorId: operator.id } },
      orderBy: { createdAt: "desc" },
      include: {
        emptyLeg: { select: { fromAirport: true, toAirport: true, departureAt: true } },
      },
    });
    res.json({ data: bookings });
  } catch (err) {
    next(err);
  }
});

operatorRouter.get("/bookings/:id", requireRole("OPERATOR"), async (req, res, next) => {
  try {
    const operator = await getOwnOperatorOrFail(req.dbUser!.id);
    if (!operator) return res.status(404).json({ error: "Profilo operatore non trovato" });

    const booking = await prisma.booking.findFirst({
      where: {
        id: String(req.params.id),
        emptyLeg: { operatorId: operator.id },
      },
      include: {
        emptyLeg: true,
        passengers: true,
      },
    });
    if (!booking) return res.status(404).json({ error: "Prenotazione non trovata" });

    res.json(booking);
  } catch (err) {
    next(err);
  }
});