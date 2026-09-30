import { closeBooking } from "../services/bookingState.service";
import { refundBookingPayments } from "../services/payments.service";
import { requireAuth } from "../middleware/auth.middleware";
import { syncAuth0User } from "../middleware/syncUser.middleware";
import Stripe from "stripe";
import { Router } from "express";
import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { ensureSplitInvitations } from "../services/splitInvitations.service";
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
  .superRefine((data, ctx) => {
    // Il modello di pagamento e' sempre per partecipante: FULL e' ammesso
    // soltanto quando esiste un unico passeggero, che paga quindi la propria
    // quota (100%). Con piu' partecipanti il client deve usare SPLIT.
    if (data.bookingType === "FULL" && data.passengers.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Con piu' partecipanti ogni passeggero deve pagare la propria quota: usa una prenotazione SPLIT",
        path: ["passengers"],
      });
      return;
    }

    if (data.bookingType === "SPLIT") {
      if (data.passengers.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Per una prenotazione condivisa servono almeno 2 passeggeri",
          path: ["passengers"],
        });
        return;
      }
      const emails = data.passengers.map((p) => p.email.toLowerCase());
      if (new Set(emails).size !== emails.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ogni passeggero deve avere un'email diversa per ricevere la propria quota",
          path: ["passengers"],
        });
      }
    }
  });

// Divide l'importo in centesimi tra N passeggeri senza perdere/aggiungere centesimi:
// i primi `resto` passeggeri pagano un centesimo in più degli altri.
function splitAmountCents(totalCents: number, n: number): number[] {
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

bookingsRouter.post("/", requireAuth, syncAuth0User, async (req, res, next) => {
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

    const activeBooking = await prisma.booking.findFirst({
      where: {
        emptyLegId: emptyLeg.id,
        status: { in: ["PENDING_PAYMENT", "PAID", "CONFIRMED"] },
      },
      select: { id: true, status: true },
    });
    if (activeBooking) {
      return res.status(409).json({
        error: "Questo volo è già associato a una prenotazione attiva",
      });
    }

    // Prezzo calcolato lato server, mai fidandosi del frontend
    const totalAmount = emptyLeg.priceTotal;

    // Per le prenotazioni SPLIT: scadenza entro 23h e mai oltre il cutoff del volo
    // (partenza -2h). Stripe richiede expires_at almeno 30 minuti nel futuro;
    // aggiungiamo 2 minuti di margine per evitare che la creazione sequenziale delle
    // sessioni porti l'ultima quota sotto la soglia minima.
    let splitExpiresAt: Date | null = null;
    if (data.bookingType === "SPLIT") {
      const now = Date.now();
      const cutoff = new Date(emptyLeg.departureAt.getTime() - 2 * 60 * 60 * 1000);
      const proposed = new Date(now + 23 * 60 * 60 * 1000);
      splitExpiresAt = proposed < cutoff ? proposed : cutoff;
      const stripeMinimumWindowMs = 32 * 60 * 1000;
      if (splitExpiresAt.getTime() - now < stripeMinimumWindowMs) {
        return res.status(409).json({
          error: "Troppo vicino alla partenza per una prenotazione condivisa: scegli il pagamento intero",
        });
      }
    }

    if (emptyLeg.departureAt.getTime() - Date.now() < 32 * 60 * 1000) {
      return res.status(409).json({ error: "Troppo vicino alla partenza per completare il pagamento" });
    }

    const booking = await prisma.$transaction(async (tx) => {
      // Serializza i tentativi di prenotazione sullo stesso Empty Leg.
      // Il semplice findFirst eseguito prima della transazione non basta contro
      // due richieste concorrenti che arrivano nello stesso istante.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${emptyLeg.id}))`;

      const lockedLeg = await tx.emptyLeg.findUnique({ where: { id: emptyLeg.id } });
      if (!lockedLeg || lockedLeg.status !== 'PUBLISHED' || lockedLeg.departureAt <= new Date()
          || lockedLeg.updatedAt.getTime() !== emptyLeg.updatedAt.getTime()) return null;

      const concurrentActiveBooking = await tx.booking.findFirst({
        where: {
          emptyLegId: emptyLeg.id,
          status: { in: ["PENDING_PAYMENT", "PAID", "CONFIRMED"] },
        },
        select: { id: true },
      });
      if (concurrentActiveBooking) return null;

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

    if (!booking) {
      return res.status(409).json({
        error: "Questo volo è già associato a una prenotazione attiva",
      });
    }

    // ===================== FULL =====================
    if (data.bookingType === "FULL") {
      let checkoutSession: Stripe.Checkout.Session | null = null;
      try {
        checkoutSession = await stripe.checkout.sessions.create({
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
          cancel_url: `${env.frontendUrl}/?booking=cancelled`,
          metadata: {
            bookingId: booking.id,
          },
          expires_at: Math.floor(Date.now() / 1000) + 32 * 60,
        });

        await prisma.booking.update({
          where: { id: booking.id },
          data: { stripeCheckoutSessionId: checkoutSession.id },
        });

        return res.status(201).json({
          bookingId: booking.id,
          checkoutUrl: checkoutSession.url,
        });
      } catch (err) {
        await closeBooking(prisma, booking.id, "CANCELLED");
        if (checkoutSession?.id) {
          try {
            const session = await stripe.checkout.sessions.retrieve(checkoutSession.id);
            if (session.status === "open") await stripe.checkout.sessions.expire(checkoutSession.id);
          } catch (cleanupErr) {
            logger.warn({ cleanupErr, bookingId: booking.id }, "Cleanup Checkout Session full fallito");
          }
        }
        await refundBookingPayments(booking.id, "checkout_setup_failed");
        throw err;
      }
    }

    // ===================== SPLIT: N sessioni Stripe, una a passeggero =====================
    const createdPassengers = await prisma.passenger.findMany({
      where: { bookingId: booking.id },
      orderBy: { id: "asc" },
    });

    const totalCents = Math.round(Number(totalAmount) * 100);
    const shares = splitAmountCents(totalCents, createdPassengers.length);

    const payments: { passengerEmail: string; amount: string; checkoutUrl: string }[] = [];
    const createdCheckoutSessionIds: string[] = [];

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
          cancel_url: `${env.frontendUrl}/?booking=cancelled`,
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

        createdCheckoutSessionIds.push(checkoutSession.id);

        await prisma.bookingPayment.update({
          where: { id: bookingPayment.id },
          data: { stripeCheckoutSessionId: checkoutSession.id },
        });

        payments.push({
          passengerEmail: passenger.email,
          amount: shareAmount,
          checkoutUrl: checkoutSession.url!,
        });
      }

    } catch (err) {
      await closeBooking(prisma, booking.id, "CANCELLED");
      // Se la creazione fallisce a meta', chiudiamo subito le sessioni gia' aperte
      // per evitare link di pagamento orfani o utilizzabili dopo l'annullamento locale.
      await Promise.allSettled(
        createdCheckoutSessionIds.map(async (sessionId) => {
          try {
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
          } catch (cleanupErr) {
            logger.warn({ cleanupErr, sessionId, bookingId: booking.id }, "Cleanup Checkout Session split fallito");
          }
        })
      );
      logger.error({ err, bookingId: booking.id }, "Errore nella creazione delle sessioni split, annullo la prenotazione");
      await refundBookingPayments(booking.id, "checkout_setup_failed");
      throw err;
    }

    let invitationsPending = false;
    try { invitationsPending = (await ensureSplitInvitations(prisma, stripe, booking.id)).failed > 0; }
    catch (_error) { invitationsPending = true; logger.warn({ bookingId: booking.id }, "Inviti quote da riprovare"); }

    return res.status(201).json({
      bookingId: booking.id,
      split: true,
      invitationsPending,
      expiresAt: splitExpiresAt,
      payments,
    });
  } catch (err) {
    next(err);
  }
});