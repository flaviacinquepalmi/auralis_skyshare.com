import {
  sendPaymentConfirmedEmail,
  sendOperatorBookingNotification,
  sendRefundIssuedEmail,
} from "../services/email.service";
import { refundBookingPayments, expirePendingCheckoutSessions } from "../services/payments.service";
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

async function markBookingPaidAndNotify(bookingId: string) {
  // Idempotenza anche in caso di webhook concorrenti: solo una richiesta puo'
  // effettuare la transizione PENDING_PAYMENT -> PAID e inviare le notifiche.
  const transitioned = await prisma.booking.updateMany({
    where: { id: bookingId, status: "PENDING_PAYMENT" },
    data: { status: "PAID" },
  });

  if (transitioned.count === 0) return false;

  const updatedBooking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      emptyLeg: { include: { operator: true } },
    },
  });
  if (!updatedBooking) throw new Error(`Booking ${bookingId} non trovato dopo il pagamento`);

  logger.info({ bookingId }, "Booking pagato: attende conferma operativa");

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

  return true;
}

async function refundLateCompletedSession(session: Stripe.Checkout.Session, bookingId: string, bookingPaymentId?: string) {
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
  if (!paymentIntentId) return;

  try {
    await stripe.refunds.create({
      payment_intent: paymentIntentId,
      metadata: { bookingId, bookingPaymentId: bookingPaymentId || "", context: "late_payment_after_terminal_booking" },
    });
  } catch (err: any) {
    if (!/already been refunded|fully refunded/i.test(String(err?.message || ""))) throw err;
  }

  if (bookingPaymentId) {
    await prisma.bookingPayment.update({
      where: { id: bookingPaymentId },
      data: {
        status: "REFUNDED",
        stripePaymentIntentId: paymentIntentId,
        refundedAt: new Date(),
      },
    });
  }
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

    try {
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        const session = event.data.object as Stripe.Checkout.Session;
        const bookingId = session.metadata?.bookingId;
        const bookingPaymentId = session.metadata?.bookingPaymentId;

        if (!bookingId) {
          logger.error("Nessun bookingId nei metadata della sessione Stripe");
          return res.status(400).json({ error: "bookingId mancante" });
        }

        // checkout.session.completed puo' arrivare prima dell'effettivo incasso
        // per metodi di pagamento asincroni. In quel caso aspettiamo
        // checkout.session.async_payment_succeeded prima di segnare il booking come pagato.
        if (event.type === "checkout.session.completed" && session.payment_status === "unpaid") {
          logger.info({ bookingId }, "Checkout completato ma pagamento ancora pendente");
          return res.json({ received: true });
        }

        const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking) return res.status(404).json({ error: "Booking non trovato" });

        // Se il booking è già terminale, un pagamento tardivo non deve riattivarlo:
        // viene rimborsato immediatamente.
        if (booking.status === "CANCELLED" || booking.status === "EXPIRED") {
          await refundLateCompletedSession(session, bookingId, bookingPaymentId);
          return res.json({ received: true });
        }

        // SPLIT: una quota tra tante.
        if (bookingPaymentId) {
          const payment = await prisma.bookingPayment.findUnique({
            where: { id: bookingPaymentId },
          });
          if (!payment) return res.status(404).json({ error: "Quota di pagamento non trovata" });

          if (payment.status === "PAID" || payment.status === "REFUNDED") {
            return res.json({ received: true });
          }

          await prisma.bookingPayment.update({
            where: { id: bookingPaymentId },
            data: {
              status: "PAID",
              stripePaymentIntentId: session.payment_intent as string,
            },
          });

          const remaining = await prisma.bookingPayment.count({
            where: { bookingId, status: { not: "PAID" } },
          });

          if (remaining === 0 && booking.status !== "CONFIRMED") {
            await markBookingPaidAndNotify(bookingId);
          }

          return res.json({ received: true });
        }

        // FULL: pagamento completo del booking, ma conferma operativa separata.
        if (booking.status === "PAID" || booking.status === "CONFIRMED") {
          return res.json({ received: true });
        }

        await prisma.booking.update({
          where: { id: bookingId },
          data: { stripePaymentIntentId: session.payment_intent as string },
        });
        await markBookingPaidAndNotify(bookingId);
        return res.json({ received: true });
      }

      if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const bookingId = session.metadata?.bookingId;
        const bookingPaymentId = session.metadata?.bookingPaymentId;
        if (!bookingId) return res.json({ received: true });

        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          include: { emptyLeg: true },
        });
        if (!booking || booking.status === "CONFIRMED" || booking.status === "CANCELLED" || booking.status === "EXPIRED") {
          return res.json({ received: true });
        }

        if (bookingPaymentId) {
          const payment = await prisma.bookingPayment.findUnique({ where: { id: bookingPaymentId } });
          if (payment?.status === "PENDING") {
            await prisma.bookingPayment.update({
              where: { id: bookingPaymentId },
              data: { status: "EXPIRED" },
            });
          }
        }

        await expirePendingCheckoutSessions(bookingId);
        const refunded = await refundBookingPayments(bookingId, "checkout_session_expired");
        await prisma.booking.update({ where: { id: bookingId }, data: { status: "EXPIRED" } });

        for (const email of refunded.refundedEmails) {
          await sendRefundIssuedEmail({
            to: email,
            fromAirport: booking.emptyLeg.fromAirport,
            toAirport: booking.emptyLeg.toAirport,
          });
        }

        return res.json({ received: true });
      }

      return res.json({ received: true });
    } catch (err) {
      logger.error({ err, type: event.type }, "Errore gestione webhook Stripe");
      return res.status(500).json({ error: "Errore gestione webhook" });
    }
  }
);
