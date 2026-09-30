import { Router } from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth.middleware";
import { syncAuth0User } from "../middleware/syncUser.middleware";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });

export const myBookingsRouter = Router();

myBookingsRouter.get("/", requireAuth, syncAuth0User, async (req, res, next) => {
  try {
    const dbUser = req.dbUser!;

    const bookings = await prisma.booking.findMany({
      where: {
        customerUserId: dbUser.id,
      },
      orderBy: { createdAt: "desc" },
      include: {
        emptyLeg: {
          select: {
            fromAirport: true,
            toAirport: true,
            departureAt: true,
          },
        },
        payments: { select: { status: true } },
        passengers: { select: { id: true } },
      },
    });

    res.json({ data: bookings });
  } catch (err) {
    next(err);
  }
});

myBookingsRouter.get("/:id", requireAuth, syncAuth0User, async (req, res, next) => {
  try {
    const dbUser = req.dbUser!;

    const booking = await prisma.booking.findFirst({
      where: {
        id: String(req.params.id),
        customerUserId: dbUser.id,
      },
      include: {
        emptyLeg: {
          select: {
            fromAirport: true,
            toAirport: true,
            departureAt: true,
            aircraft: { select: { manufacturer: true, model: true } },
          },
        },
        passengers: true,
        payments: { select: { id: true, status: true, amount: true, currency: true } },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: "Prenotazione non trovata" });
    }

    res.json(booking);
  } catch (err) {
    next(err);
  }
});