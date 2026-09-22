import { optionalAuth, optionalSyncUser } from "../middleware/optionalAuth.middleware";
import Stripe from "stripe";
import { Router } from "express";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { sendSplitPaymentShareEmail } from "../services/email.service";
import { logger } from "../utils/logger";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });
const stripe = new Stripe(env.stripeSecretKey);

export const bookingsRouter = Router();

const passengerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
});

const createBookingSchema = z
  .object({
    emptyLegId: z.string().min(1),
    bookerFirstName: z.string().min(1),
    bookerLastName: z.string().min(1),
    bookerEmail: z.string().email(),
    bookerPhone: z.string().optional(),
    bookingType: z.enum(["FULL", "SPLIT"]),
    passengers: z.array(passengerSchema).min(1),
  })
  .refine(
    (data) => {
      if (data.bookingType !== "SPLIT") return true;
      if (data.passengers.length < 2) return false;
      const emails = data.passengers.map((p) => p.email.toLowerCase());
      return new Set(emails).size === emails.length;
    },
    {
      message:
        "Per una prenotazione condivisa servono almeno 2 passeggeri, ciascuno con un'email diversa (una quota a testa)",
      path: ["passengers"],
    }
  );

// Divide l'importo in centesimi tra N passeggeri senza perdere/aggiungere centesimi:
// i primi `resto` passeggeri pagano un centesimo in più degli altri.
function splitAmountCents(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

bookingsRouter.post("/", optionalAuth, optionalSyncUser, async (req, res, next) => {
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

    // Per le prenotazioni SPLIT: scadenza tra 48h da ora, ma mai oltre il cutoff
    // del volo (partenza -2h, lo stesso usato per il countdown "volo confermato").
    let splitExpiresAt: Date | null = null;
    if (data.bookingType === "SPLIT") {
      const cutoff = new Date(emptyLeg.departureAt.getTime() - 2 * 60 * 60 * 1000);
      const proposed = new Date(Date.now() + 48 * 60 * 60 * 1000);
      splitExpiresAt = proposed < cutoff ? proposed : cutoff;
      if (splitExpiresAt <= new Date()) {
        return res.status(409).json({
          error: "Troppo vicino alla partenza per una prenotazione condivisa: scegli il pagamento intero",
        });
      }
    }

    const booking = await prisma.$transaction(async (tx) => {
      const newBooking = await tx.booking.create({
        data: {
          emptyLegId: emptyLeg.id,
          customerUserId: req.dbUser?.id,
          bookerFirstName: data.bookerFirstName,
          bookerLastName: data.bookerLastName,
          bookerEmail: data.bookerEmail,
          bookerPhone: data.bookerPhone,
          bookingType: data.bookingType,
          status: "PENDING_PAYMENT",
          totalAmount,
          currency: emptyLeg.currency,
          splitExpiresAt,
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

    // ===================== FULL: comportamento invariato =====================
    if (data.bookingType === "FULL") {
      const checkoutSession = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: data.bookerEmail,
        line_items: [
          {
            price_data: {
              currency: emptyLeg.currency.toLowerCase(),
              product_data: {
                name: `Volo ${emptyLeg.fromAirport} → ${emptyLeg.toAirport}`,
                description: `Partenza: ${emptyLeg.departureAt.toISOString()}`,
              },
              unit_amount: Math.round(Number(totalAmount) * 100),
            },
            quantity: 1,
          },
        ],
        success_url: `${env.frontendUrl}/?booking=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.frontendUrl}/booking-cancelled`,
        metadata: {
          bookingId: booking.id,
        },
      });

      await prisma.booking.update({
        where: { id: booking.id },
        data: { stripeCheckoutSessionId: checkoutSession.id },
      });

      return res.status(201).json({
        bookingId: booking.id,
        checkoutUrl: checkoutSession.url,
      });
    }

    // ===================== SPLIT: N sessioni Stripe, una a passeggero =====================
    const createdPassengers = await prisma.passenger.findMany({
      where: { bookingId: booking.id },
      orderBy: { id: "asc" },
    });

    const totalCents = Math.round(Number(totalAmount) * 100);
    const shares = splitAmountCents(totalCents, createdPassengers.length);

    const payments: { passengerEmail: string; amount: string; checkoutUrl: string }[] = [];

    try {
      for (let i = 0; i < createdPassengers.length; i++) {
        const passenger = createdPassengers[i];
        const shareCents = shares[i];
        const shareAmount = (shareCents / 100).toFixed(2);

        const bookingPayment = await prisma.bookingPayment.create({
          data: {
            bookingId: booking.id,
            passengerId: passenger.id,
            payerEmail: passenger.email,
            amount: shareAmount,
            currency: emptyLeg.currency,
            status: "PENDING",
          },
        });

        const checkoutSession = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          customer_email: passenger.email,
          line_items: [
            {
              price_data: {
                currency: emptyLeg.currency.toLowerCase(),
                product_data: {
                  name: `Volo ${emptyLeg.fromAirport} → ${emptyLeg.toAirport} — quota condivisa`,
                  description: `Partenza: ${emptyLeg.departureAt.toISOString()} · Prenotazione di ${data.bookerFirstName} ${data.bookerLastName}`,
                },
                unit_amount: shareCents,
              },
              quantity: 1,
            },
          ],
          success_url: `${env.frontendUrl}/?booking=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${env.frontendUrl}/booking-cancelled`,
          metadata: {
            bookingId: booking.id,
            bookingPaymentId: bookingPayment.id,
          },
          expires_at: splitExpiresAt
            ? Math.min(
                Math.floor(splitExpiresAt.getTime() / 1000),
                Math.floor(Date.now() / 1000) + 23 * 60 * 60 // Stripe: max 24h di validità sessione
              )
            : undefined,
        });

        await prisma.bookingPayment.update({
          where: { id: bookingPayment.id },
          data: { stripeCheckoutSessionId: checkoutSession.id },
        });

        await sendSplitPaymentShareEmail({
          to: passenger.email,
          firstName: passenger.firstName,
          bookerFirstName: data.bookerFirstName,
          fromAirport: emptyLeg.fromAirport,
          toAirport: emptyLeg.toAirport,
          amount: shareAmount,
          currency: emptyLeg.currency,
          checkoutUrl: checkoutSession.url!,
          expiresAt: splitExpiresAt!,
        });

        payments.push({
          passengerEmail: passenger.email,
          amount: shareAmount,
          checkoutUrl: checkoutSession.url!,
        });
      }
    } catch (err) {
      // Una o piu' Checkout Session Stripe potrebbero essere gia' state create
      // prima del fallimento: restano orfane e scadono da sole entro 24h (nessun addebito).
      logger.error({ err, bookingId: booking.id }, "Errore nella creazione delle sessioni split, annullo la prenotazione");
      await prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
      throw err;
    }

    return res.status(201).json({
      bookingId: booking.id,
      split: true,
      expiresAt: splitExpiresAt,
      payments,
    });
  } catch (err) {
    next(err);
  }
});