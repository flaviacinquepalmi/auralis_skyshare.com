import { Router } from "express";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });

export const bookingsRouter = Router();

const passengerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
});

const createBookingSchema = z.object({
  emptyLegId: z.string().min(1),
  bookerFirstName: z.string().min(1),
  bookerLastName: z.string().min(1),
  bookerEmail: z.string().email(),
  bookerPhone: z.string().optional(),
  bookingType: z.enum(["FULL", "SPLIT"]),
  passengers: z.array(passengerSchema).min(1),
});

bookingsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Dati non validi", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const emptyLeg = await prisma.emptyLeg.findUnique({
      where: { id: data.emptyLegId },
    });

    if (!emptyLeg) {
      return res.status(404).json({ error: "Volo non trovato" });
    }
    if (emptyLeg.status !== "PUBLISHED") {
      return res.status(409).json({ error: "Questo volo non è più disponibile" });
    }
    if (emptyLeg.departureAt <= new Date()) {
      return res.status(409).json({ error: "Questo volo è già partito" });
    }
    if (data.passengers.length > emptyLeg.availablePax) {
      return res.status(409).json({ error: "Posti disponibili insufficienti" });
    }

    // Prezzo calcolato lato server, mai fidandosi del frontend
    const totalAmount = emptyLeg.priceTotal;

    const booking = await prisma.$transaction(async (tx) => {
      const newBooking = await tx.booking.create({
        data: {
          emptyLegId: emptyLeg.id,
          bookerFirstName: data.bookerFirstName,
          bookerLastName: data.bookerLastName,
          bookerEmail: data.bookerEmail,
          bookerPhone: data.bookerPhone,
          bookingType: data.bookingType,
          status: "PENDING_PAYMENT",
          totalAmount,
          currency: emptyLeg.currency,
        },
      });

      await tx.passenger.createMany({
        data: data.passengers.map((p) => ({
          bookingId: newBooking.id,
          firstName: p.firstName,
          lastName: p.lastName,
          email: p.email,
          phone: p.phone,
        })),
      });

      return newBooking;
    });

    res.status(201).json({
      bookingId: booking.id,
      status: booking.status,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
    });
  } catch (err) {
    next(err);
  }
});