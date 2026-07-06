 import { Router } from "express";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });

export const emptyLegsRouter = Router();

const listQuerySchema = z.object({
  fromAirport: z.string().length(3).optional(),
  toAirport: z.string().length(3).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  pax: z.coerce.number().int().positive().optional(),
});

emptyLegsRouter.get("/", async (req, res, next) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Parametri non validi", details: parsed.error.flatten() });
    }
    const { fromAirport, toAirport, dateFrom, dateTo, maxPrice, pax } = parsed.data;

    const where: any = {
      status: "PUBLISHED",
      departureAt: { gt: new Date() },
    };
    if (fromAirport) where.fromAirport = fromAirport.toUpperCase();
    if (toAirport) where.toAirport = toAirport.toUpperCase();
    if (dateFrom || dateTo) {
      where.departureAt = {
        ...where.departureAt,
        ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
        ...(dateTo ? { lte: new Date(dateTo) } : {}),
      };
    }
    if (maxPrice) where.priceTotal = { lte: maxPrice };
    if (pax) where.availablePax = { gte: pax };

    const legs = await prisma.emptyLeg.findMany({
      where,
      orderBy: { departureAt: "asc" },
      include: {
        aircraft: { select: { manufacturer: true, model: true, maxPax: true } },
        operator: { select: { companyName: true } },
      },
    });

    res.json({ data: legs });
  } catch (err) {
    next(err);
  }
});

emptyLegsRouter.get("/:id", async (req, res, next) => {
  try {
    const leg = await prisma.emptyLeg.findFirst({
      where: {
        id: req.params.id,
        status: "PUBLISHED",
        departureAt: { gt: new Date() },
      },
      include: {
        aircraft: { select: { manufacturer: true, model: true, maxPax: true } },
        operator: { select: { companyName: true } },
      },
    });

    if (!leg) {
      return res.status(404).json({ error: "Volo non trovato" });
    }

    res.json(leg);
  } catch (err) {
    next(err);
  }
});