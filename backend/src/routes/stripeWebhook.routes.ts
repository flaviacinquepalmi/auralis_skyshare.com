import { sendPaymentConfirmedEmail, sendOperatorBookingNotification } from "../services/email.service";
import { Router } from "express";
import express from "express";
import Stripe from "stripe";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "../config/env";
import { logger } from "../utils/logger";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
const prisma = new PrismaClient({ adapter });
const stripe = new Stripe(env.stripeSecretKey);

export const stripeWebhookRouter = Router();

async function confirmBookingAndNotify(bookingId: string) {
  const updatedBooking = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "CONFIRMED" },
    include: {
      emptyLeg: {
        include: { operator: true },
      },
    },
  });

  logger.info({ bookingId }, "Booking confermato (tutte le quote pagate)");

  await sendPaymentConfirmedEmail({
    to: updatedBooking.bookerEmail,
    bookerFirstName: updatedBooking.bookerFirstName,
    fromAirport: updatedBooking.emptyLeg.fromAirport,
    toAirport: updatedBooking.emptyLeg.toAirport,
  });

  await sendOperatorBookingNotification({
    to: updatedBooking.emptyLeg.operator.contactEmail,
    fromAirport: updatedBooking.emptyLeg.fromAirport,
    toAirport: updatedBooking.emptyLeg.toAirport,
    bookerFirstName: updatedBooking.bookerFirstName,
    bookerLastName: updatedBooking.bookerLastName,
  });
}

stripeWebhookRouter.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature as string,
        env.stripeWebhookSecret
      );
    } catch (err: any) {
      logger.error({ err }, "Webhook signature non valida");
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    logger.info({ type: event.type }, "Evento Stripe ricevuto");

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const bookingId = session.metadata?.bookingId;
      const bookingPaymentId = session.metadata?.bookingPaymentId;

      if (!bookingId) {
        logger.error("Nessun bookingId nei metadata della sessione Stripe");
        return res.status(400).json({ error: "bookingId mancante" });
      }

      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
      });

      if (!booking) {
        logger.error({ bookingId }, "Booking non trovato per il webhook");
        return res.status(404).json({ error: "Booking non trovato" });
      }

      // ===================== SPLIT: una quota pagata tra tante =====================
      if (bookingPaymentId) {
        const payment = await prisma.bookingPayment.findUnique({
          where: { id: bookingPaymentId },
        });

        if (!payment) {
          logger.error({ bookingPaymentId }, "BookingPayment non trovato per il webhook");
          return res.status(404).json({ error: "Quota di pagamento non trovata" });
        }

        // Idempotenza: se questa quota è già segnata pagata, non rifare nulla
        if (payment.status === "PAID") {
          logger.info({ bookingPaymentId }, "Quota già segnata pagata, evento ignorato");
          return res.json({ received: true });
        }

        await prisma.bookingPayment.update({
          where: { id: bookingPaymentId },
          data: {
            status: "PAID",
            stripePaymentIntentId: session.payment_intent as string,
          },
        });

        logger.info({ bookingId, bookingPaymentId }, "Quota split pagata");

        // Se il booking è già CONFIRMED (raro, doppio evento), non toccare nulla
        if (booking.status === "CONFIRMED") {
          return res.json({ received: true });
        }

        const remaining = await prisma.bookingPayment.count({
          where: { bookingId, status: { not: "PAID" } },
        });

        if (remaining === 0) {
          // Tutte le quote sono pagate: la prenotazione è confermata
          await confirmBookingAndNotify(bookingId);
        } else if (booking.status === "PENDING_PAYMENT") {
          // Almeno una quota pagata, altre ancora in sospeso
          await prisma.booking.update({
            where: { id: bookingId },
            data: { status: "PAID" },
          });
        }

        return res.json({ received: true });
      }

      // ===================== FULL: comportamento invariato =====================
      // Idempotenza: se è già stato marcato, non rifare nulla
      if (booking.status === "PAID" || booking.status === "CONFIRMED") {
        logger.info({ bookingId }, "Booking già confermato, evento ignorato");
        return res.json({ received: true });
      }

      await prisma.booking.update({
        where: { id: bookingId },
        data: { stripePaymentIntentId: session.payment_intent as string },
      });

      await confirmBookingAndNotify(bookingId);
    }

    res.json({ received: true });
  }
);